import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';
import { appConfig } from '../../config/index.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import { sendSuccess, sendError } from '../../utils/response.js';

// Test-only routes for E2E verification of runtime availability separation.
//
// Security contract (defense in depth):
// 1. app.js only mounts this router when appConfig.testRoutesEnabled is true
//    (ENABLE_TEST_ROUTES === 'true' AND NODE_ENV !== 'production').
// 2. createTestRoutes() refuses to build routes unless the flag is enabled.
// 3. Every request re-checks the flag at request time, so a router instance
//    that somehow ends up mounted in a production process still 404s.
// 4. Requests must be authenticated AND carry the director role.
//
// The endpoint ONLY publishes a simulated `runtime.status.changed` WebSocket
// event (source: 'e2e-test'). It never calls HermesAdapter, never touches the
// real Hermes runtime connection, and never modifies agent lifecycle state.
export function createTestRoutes() {
  const router = Router();

  if (!appConfig.testRoutesEnabled) {
    // Flag disabled: return an inert router. Nothing is registered.
    return router;
  }

  // Simulate Hermes runtime status change for E2E testing.
  // Body: { connected: boolean }
  router.post(
    '/test/runtime-status',
    (req, res, next) => {
      // Request-time guard: production must never serve this endpoint even
      // if the router was mounted by mistake.
      if (!appConfig.testRoutesEnabled || appConfig.isProduction) {
        return sendError(res, 'NOT_FOUND', 'Endpoint not available', [], 404);
      }
      next();
    },
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