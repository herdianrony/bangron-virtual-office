import logger from '../utils/logger.js';

export class ConnectionManager {
  constructor() {
    this.clients = new Map(); // ws -> { userId, connectedAt, lastPing }
  }

  addClient(ws, meta = {}) {
    if (!meta.userId) throw new Error('Authenticated userId is required for WebSocket clients');
    this.clients.set(ws, {
      userId: meta.userId || null,
      userName: meta.userName || 'Anonymous',
      connectedAt: Date.now(),
      isAlive: true
    });
    logger.info({ clientCount: this.clients.size, userId: meta.userId }, 'WebSocket client connected');
  }

  removeClient(ws) {
    if (this.clients.has(ws)) {
      this.clients.delete(ws);
      logger.info({ clientCount: this.clients.size }, 'WebSocket client disconnected');
    }
  }

  markAlive(ws) {
    const meta = this.clients.get(ws);
    if (meta) {
      meta.isAlive = true;
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  broadcast(messageObj) {
    const payload = typeof messageObj === 'string' ? messageObj : JSON.stringify(messageObj);
    for (const [ws, meta] of this.clients.entries()) {
      if (meta.userId && ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(payload);
        } catch (err) {
          logger.error({ err }, 'Failed to send message to client');
        }
      }
    }
  }

  pruneDeadConnections() {
    for (const [ws, meta] of this.clients.entries()) {
      if (!meta.isAlive) {
        logger.debug('Terminating inactive WebSocket client');
        ws.terminate();
        this.clients.delete(ws);
      } else {
        meta.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
          this.clients.delete(ws);
        }
      }
    }
  }
}

export const connectionManager = new ConnectionManager();
export default connectionManager;
