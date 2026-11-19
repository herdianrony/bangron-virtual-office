import { WebSocketServer, WebSocket } from 'ws';
import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import { connectionManager } from './connection-manager.js';
import { securityConfig } from '../config/index.js';
import { getDatabase } from '../database/connection.js';
import logger from '../utils/logger.js';

const AUTH_TIMEOUT_MS = 5000;

export function createWebSocketServer(httpServer, sessionStore) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const heartbeatInterval = setInterval(() => {
    connectionManager.pruneDeadConnections();
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  wss.on('connection', (ws, req) => {
    let settled = false;
    const authTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close(4401, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);

    const reject = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(authTimeout);
      logger.warn({ reason }, 'Rejected unauthenticated WebSocket connection');
      ws.close(4401, 'Authentication required');
    };

    const cookiesHeader = req.headers.cookie;
    const signedSessionCookie = cookiesHeader
      ? cookie.parse(cookiesHeader)[securityConfig.sessionCookieName]
      : null;
    const sessionId = signedSessionCookie
      ? cookieParser.signedCookie(signedSessionCookie, securityConfig.sessionSecret)
      : null;

    if (!sessionId || !sessionStore || typeof sessionStore.get !== 'function') {
      reject('missing_or_invalid_session_cookie');
      return;
    }

    sessionStore.get(sessionId, (sessionError, sess) => {
      if (settled) return;
      if (sessionError || !sess?.userId) {
        reject(sessionError ? 'session_lookup_failed' : 'session_not_found');
        return;
      }

      try {
        const db = getDatabase();
        const user = db.prepare(
          'SELECT id, name, role, is_active FROM users WHERE id = ?'
        ).get(sess.userId);

        if (!user || !user.is_active) {
          reject('inactive_or_missing_user');
          return;
        }

        settled = true;
        clearTimeout(authTimeout);
        connectionManager.addClient(ws, { userId: user.id, userName: user.name, role: user.role });

        ws.on('pong', () => connectionManager.markAlive(ws));
        ws.on('message', (messageRaw) => {
          try {
            const msg = JSON.parse(messageRaw.toString());
            if (msg.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
              return;
            }
            if (msg.type === 'request_snapshot') sendInitialSnapshot(ws);
          } catch (err) {
            logger.debug({ err }, 'Malformed client WS message');
          }
        });

        ws.on('close', () => connectionManager.removeClient(ws));
        ws.on('error', (err) => {
          logger.error({ err, userId: user.id }, 'WebSocket client error');
          connectionManager.removeClient(ws);
        });

        sendInitialSnapshot(ws);
      } catch (err) {
        logger.error({ err }, 'WebSocket authentication failed');
        reject('authentication_error');
      }
    });
  });

  function sendInitialSnapshot(ws) {
    try {
      if (ws.readyState !== WebSocket.OPEN) return;
      const db = getDatabase();
      const rooms = db.prepare('SELECT * FROM office_rooms WHERE is_active = 1').all();
      const workstations = db.prepare(`
        SELECT w.*, r.name as room_name, ai.id as occupied_by_agent_id, ai.display_name as occupied_by_agent_name
        FROM office_workstations w
        JOIN office_rooms r ON w.room_id = r.id
        LEFT JOIN agent_instances ai ON ai.current_workstation_id = w.id
      `).all();
      const agents = db.prepare(`
        SELECT ai.*, ap.name as profile_name, ap.department, ap.system_role,
          op.position_x, op.position_y, op.direction,
          (SELECT title FROM agent_tasks WHERE assigned_agent_id = ai.id AND status IN ('running', 'assigned', 'waiting') LIMIT 1) as active_task_title
        FROM agent_instances ai
        JOIN agent_profiles ap ON ai.profile_id = ap.id
        LEFT JOIN office_positions op ON ai.id = op.agent_instance_id
      `).all();
      const activeTasks = db.prepare(`
        SELECT t.*, p.name as project_name, ai.display_name as assigned_agent_name
        FROM agent_tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN agent_instances ai ON t.assigned_agent_id = ai.id
        WHERE t.status IN ('running', 'assigned', 'waiting')
        ORDER BY t.created_at DESC
      `).all();
      const pendingApprovalsCount = db.prepare(
        "SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'"
      ).get().count;

      ws.send(JSON.stringify({
        type: 'office.state.snapshot',
        timestamp: new Date().toISOString(),
        data: { rooms, workstations, agents, activeTasks, pendingApprovalsCount }
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to construct or send initial office snapshot');
    }
  }

  return wss;
}

export default createWebSocketServer;
