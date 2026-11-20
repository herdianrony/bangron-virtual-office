import { Router } from 'express';
import { hermesWebhookController } from './webhook-controller.js';
import { webhookLimiter } from '../../middleware/rate-limit.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

// Webhook ingestion endpoint (with burst limiter and raw signature checks)
router.post('/events', webhookLimiter, hermesWebhookController.handleWebhook);

// Registrasi agen sebelum event datang (nama agen asli Hermes). HMAC-protected.
router.post('/agents', webhookLimiter, hermesWebhookController.registerAgents);

// Hermes health and integration status — Director-only (S1 remediation):
// runtime metadata and recent event payloads must never reach anonymous
// clients. Consistent with /api/audit and /api/director/dashboard policy.
router.get('/status', authenticate, requireDirector, hermesWebhookController.getStatus);

export default router;
