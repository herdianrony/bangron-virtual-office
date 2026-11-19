import { WebSocketServer } from 'ws';
import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import { connectionManager } from './connection-manager.js';
import { securityConfig } from '../config/index.js';
import { getDatabase } from '../database/connection.js';
import logger from '../utils/logger.js';

export function createWebSocketServer(httpServer, sessionStore) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    connectionManager.pruneDeadConnections();
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws, req) => {
    let userId = null;
    let userName = 'Director';

    try {
      const cookiesHeader = req.headers.cookie;
      if (cookiesHeader) {
        const parsedCookies = cookie.parse(cookiesHeader);
        const signedSessionCookie = parsedCookies[securityConfig.sessionCookieName];
        if (signedSessionCookie) {
          const unsigned = cookieParser.signedCookie(signedSessionCookie, securityConfig.sessionSecret);
          if (unsigned && sessionStore) {
            sessionStore.get(unsigned, (err, sess) => {
              if (sess && sess.userId) {
                userId = sess.userId;
              }
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Error parsing session in WebSocket connection');
    }

    connectionManager.addClient(ws, { userId, userName });

    ws.on('pong', () => {
      connectionManager.markAlive(ws);
    });

    ws.on('message', (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          return;
        }

        if (msg.type === 'request_snapshot') {
          sendInitialSnapshot(ws);
          return;
        }
      } catch (err) {
        logger.debug({ err }, 'Malformed client WS message');
      }
    });

    ws.on('close', () => {
      connectionManager.removeClient(ws);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket client error');
      connectionManager.removeClient(ws);
    });

    // Send initial snapshot on successful connection
    sendInitialSnapshot(ws);
  });

  function sendInitialSnapshot(ws) {
    try {
      const db = getDatabase();
      const rooms = db.prepare('SELECT * FROM office_rooms WHERE is_active = 1').all();
      const workstations = db.prepare(`
        SELECT w.*, r.name as room_name, ai.id as occupied_by_agent_id, ai.display_name as occupied_by_agent_name
        FROM office_workstations w
        JOIN office_rooms r ON w.room_id = r.id
        LEFT JOIN agent_instances ai ON ai.current_workstation_id = w.id
      `).all();

      const agents = db.prepare(`
        SELECT 
          ai.*,
          ap.name as profile_name,
          ap.department,
          ap.system_role,
          op.position_x,
          op.position_y,
          op.direction,
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

      const snapshot = {
        type: 'office.state.snapshot',
        timestamp: new Date().toISOString(),
        data: {
          rooms,
          workstations,
          agents,
          activeTasks,
          pendingApprovalsCount
        }
      };

      if (ws.readyState === 1) {
        ws.send(JSON.stringify(snapshot));
      }
    } catch (err) {
      logger.error({ err }, 'Failed to construct or send initial office snapshot');
    }
  }

  return wss;
}

export default createWebSocketServer;
