import http from 'http';
import { createApp } from './app.js';
import { appConfig } from './config/index.js';
import { getDatabase, closeDatabase } from './database/connection.js';
import { runMigrations } from './database/migrations/runner.js';
import { createWebSocketServer } from './realtime/websocket-server.js';
import { demoEngine } from './modules/demo/demo-engine.js';
import { HermesAdapter } from './integrations/hermes/adapter.js';
import { AgentRepository } from './database/repositories/agent.repository.js';
import { eventPublisher } from './realtime/event-publisher.js';
import logger from './utils/logger.js';

const RUNTIME_CHECK_INTERVAL_MS = 30000;

async function startServer() {
  try {
    const db = getDatabase();
    runMigrations(db);

    const { app, sessionStore } = createApp(db);
    const server = http.createServer(app);

    // Attach WebSocket Server
    const wss = createWebSocketServer(server, sessionStore);

    server.listen(appConfig.port, appConfig.host, () => {
      logger.info(
        `Bangron Virtual Office running on http://${appConfig.host}:${appConfig.port} in ${appConfig.env} mode`
      );

      // Start the DEMO auto-play director unless explicitly disabled.
      if (process.env.DEMO_AUTOPLAY !== 'false') {
        demoEngine.start();
      }

      // PHASE 3: Runtime health watchdog — when Hermes is unreachable, mark all
      // agents offline (avatar: Offline) so the UI never shows stale activity.
      const hermesAdapter = new HermesAdapter();
      const agentRepo = new AgentRepository(db);
      setInterval(async () => {
        try {
          const runtime = await hermesAdapter.getRuntimeStatus();
          if (!runtime.connected) {
            const instances = agentRepo.getAllInstances();
            for (const inst of instances) {
              if (inst.status !== 'offline') {
                agentRepo.updateInstanceStatus(inst.id, 'offline');
                eventPublisher.publishAgentStatus(inst.id, 'offline', { reason: 'runtime_unavailable' });
              }
            }
          }
        } catch (err) {
          logger.debug({ err }, 'Runtime health check tick skipped');
        }
      }, RUNTIME_CHECK_INTERVAL_MS).unref();
    });

    // Graceful shutdown
    const handleShutdown = (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);

      if (sessionStore && sessionStore.stopCleanup) {
        sessionStore.stopCleanup();
      }

      demoEngine.stop();

      wss.close(() => {
        logger.info('WebSocket server closed.');
      });

      server.close(() => {
        logger.info('HTTP server closed.');
        closeDatabase();
        process.exit(0);
      });

      // Force exit after 5s if hanging
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 5000).unref();
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();
