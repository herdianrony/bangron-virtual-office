import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import { sendSuccess, sendError } from '../../utils/response.js';

// Test-only routes for E2E verification of runtime availability separation.
// Only mounted in development/test mode. Never exposed in production.
export function createTestRoutes() {
  const router = Router();

  // Simulate Hermes runtime status change for E2E testing.
  // Body: { connected: boolean }
  router.post(
    '/test/runtime-status',
    authenticate,
    requireDirector,
    (req, res) => {
      const { connected } = req.body || {};
      if (typeof connected !== 'boolean') {
        return sendError(res, 'VALIDATION_ERROR', 'connected must be a boolean', [], 400);
      }
      eventPublisher.publish('runtime.status.changed', {
        connected,
        reason: connected ? 'runtime_recovered' : 'runtime_unavailable',
        timestamp: new Date().toISOString(),
        source: 'e2e-test'
      });
      return sendSuccess(res, { connected }, 'Runtime status simulated.');
    }
  );

  return router;
}
