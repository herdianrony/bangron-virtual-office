import http from 'http';
import { pathToFileURL } from 'url';
import { createApp } from './app.js';
import { appConfig } from './config/index.js';
import { getDatabase, closeDatabase } from './database/connection.js';
import { runMigrations } from './database/migrations/runner.js';
import { createWebSocketServer } from './realtime/websocket-server.js';
import { demoEngine } from './modules/demo/demo-engine.js';
import { HermesAdapter } from './integrations/hermes/adapter.js';
import { AgentRepository } from './database/repositories/agent.repository.js';
import { hermesEventBridge } from './integrations/hermes/event-bridge.js';
import { recoverActiveHermesRuns } from './integrations/hermes/startup-recovery.js';
import { eventPublisher } from './realtime/event-publisher.js';
import logger from './utils/logger.js';

// Backwards-compatible re-export: konsumen lama boleh mengimpor dari server.js.
export { recoverActiveHermesRuns } from './integrations/hermes/startup-recovery.js';

const RUNTIME_CHECK_INTERVAL_MS = 30000;

async function startServer() {
  try {
    const db = getDatabase();
    runMigrations(db);

    const { app, sessionStore } = createApp(db);
    const server = http.createServer(app);

    // Attach WebSocket Server
    const wss = createWebSocketServer(server, sessionStore);

    server.listen(appConfig.port, appConfig.host, async () => {
      logger.info(
        `Bangron Virtual Office running on http://${appConfig.host}:${appConfig.port} in ${appConfig.env} mode`
      );

      // Start the DEMO auto-play director unless explicitly disabled.
      if (process.env.DEMO_AUTOPLAY !== 'false') {
        demoEngine.start();
      }

      // G6.1: EventBridge startup recovery for active Hermes runs
      // Query tasks with non-empty hermes_run_id and non-terminal status,
      // rebuild run-to-task mappings, and resume polling.
      try {
        await recoverActiveHermesRuns(db);
      } catch (err) {
        logger.error({ err }, 'Hermes EventBridge startup recovery failed');
      }

      // PHASE 3: Runtime health watchdog.
      // Tracks Hermes runtime availability SEPARATELY from agent lifecycle
      // state (queued / working / thinking / collaborating / waiting /
      // completed / failed / cancelled / idle). The watchdog NEVER overwrites
      // persisted agent lifecycle statuses with runtime availability.
      // When Hermes is unreachable, agents keep their lifecycle status in the
      // database; the frontend derives "Offline" avatar appearance from
      // runtimeStatus.connected = false while preserving the actual lifecycle
      // state. When Hermes returns, agents resume normally — no state churn.
      const hermesAdapter = new HermesAdapter();
      let runtimeConnected = null; // null = unknown, true/false = last known
      let healthCheckInFlight = false; // prevent overlapping requests

      setInterval(async () => {
        if (healthCheckInFlight) return;
        healthCheckInFlight = true;
        try {
          const runtime = await hermesAdapter.getRuntimeStatus();
          const connected = !!runtime.connected;

          if (runtimeConnected === null) {
            // First tick: just record, don't churn state.
            runtimeConnected = connected;
          } else if (connected !== runtimeConnected) {
            // State changed: publish runtime availability change only.
            // Agent lifecycle statuses are NOT modified — they remain the
            // source of truth and are reconciled by Hermes events.
            runtimeConnected = connected;
            eventPublisher.publish('runtime.status.changed', {
              connected,
              reason: connected ? 'runtime_recovered' : 'runtime_unavailable',
              timestamp: new Date().toISOString()
            });
          }
        } catch (err) {
          logger.debug({ err }, 'Runtime health check tick skipped');
        } finally {
          healthCheckInFlight = false;
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

      // G6.1: Stop all EventBridge polling on shutdown
      hermesEventBridge.stopAll();

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

/**
 * True hanya jika modul ini dijalankan langsung (node src/server.js),
 * bukan diimpor sebagai dependensi (mis. dari test).
 *
 * Tanpa guard ini, import ke src/server.js akan mengeksekusi startServer()
 * dan merebut port produksi (EADDRINUSE saat service hidup).
 */
export function isDirectRun(
  importMetaUrl = import.meta.url,
  entryPoint = process.argv[1]
) {
  if (!entryPoint) return false;
  return importMetaUrl === pathToFileURL(entryPoint).href;
}

if (isDirectRun()) {
  startServer();
}

