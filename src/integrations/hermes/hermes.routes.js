import { Router } from 'express';
import { hermesWebhookController } from './webhook-controller.js';
import { webhookLimiter } from '../../middleware/rate-limit.js';

const router = Router();

// Webhook ingestion endpoint (with burst limiter and raw signature checks)
router.post('/events', webhookLimiter, hermesWebhookController.handleWebhook);

// Registrasi agen sebelum event datang (nama agen asli Hermes). HMAC-protected.
router.post('/agents', webhookLimiter, hermesWebhookController.registerAgents);

// Hermes health and integration status
router.get('/status', hermesWebhookController.getStatus);

export default router;
