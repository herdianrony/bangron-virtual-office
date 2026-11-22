import { TaskRepository } from '../../database/repositories/task.repository.js';
import { hermesEventBridge } from './event-bridge.js';
import logger from '../../utils/logger.js';

/**
 * G6.1: Recover active Hermes runs after application restart.
 * Queries tasks with non-empty hermes_run_id and non-terminal status,
 * rebuilds run-to-task mappings, and resumes SSE polling for eligible runs.
 *
 * Lives in its own module (bukan src/server.js) agar import untuk pengujian
 * tidak menjalankan entry point server dan ikut merebut port produksi.
 *
 * Accepts a TaskRepository-compatible object with a `db` property for
 * dependency injection in tests.
 */
export async function recoverActiveHermesRuns(db) {
  const taskRepo = new TaskRepository(db);
  const terminalStatuses = ['completed', 'failed', 'cancelled'];

  // Find tasks with a Hermes run ID that are not in a terminal state
  const activeTasks = db.prepare(`
    SELECT id, hermes_run_id, status
    FROM agent_tasks
    WHERE hermes_run_id IS NOT NULL
      AND hermes_run_id != ''
      AND status NOT IN (${terminalStatuses.map(() => '?').join(',')})
  `).all(...terminalStatuses);

  if (activeTasks.length === 0) {
    logger.info('No active Hermes runs to recover');
    return { recovered: [], skipped: [] };
  }

  logger.info({ count: activeTasks.length }, 'Recovering active Hermes runs');

  const recovered = [];
  const skipped = [];

  for (const task of activeTasks) {
    const { id: taskId, hermes_run_id: runId, status } = task;

    // Validate run_id format
    if (!runId || typeof runId !== 'string' || runId.trim() === '') {
      logger.warn({ taskId, runId }, 'Invalid run_id in recovered task, skipping');
      skipped.push({ taskId, reason: 'invalid_run_id' });
      continue;
    }

    // Rebuild run-to-task mapping in EventBridge
    hermesEventBridge.registerRunTaskMapping(runId, taskId);
    logger.info({ taskId, runId, status }, 'Re-registered run-to-task mapping');
    recovered.push({ taskId, runId, status });

    // Resume polling for this run (fire-and-forget)
    // Each run's failure is isolated — one failure doesn't stop others
    hermesEventBridge.startPolling(runId).catch((err) => {
      logger.error({ err, taskId, runId }, 'EventBridge polling failed for recovered run');
    });
  }

  return { recovered, skipped };
}
