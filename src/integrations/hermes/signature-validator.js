import { verifyHmacSha256 } from '../../utils/crypto.js';
import { hermesConfig } from '../../config/index.js';
import logger from '../../utils/logger.js';

const MAX_TIMESTAMP_DRIFT_SEC = 300;

// Bangron's webhook contract: HMAC-SHA256 over the exact request bytes,
// with X-Hermes-Timestamp as a Unix timestamp in seconds.
export function validateHermesSignature(req) {
  const signature =
    req.headers['x-hermes-signature-256'] ||
    req.headers['x-hermes-signature'] ||
    req.headers['x-hub-signature-256'];
  const timestampHeader = req.headers['x-hermes-timestamp'];

  if (!hermesConfig.webhookSecret) {
    logger.error('Hermes webhook secret is not configured');
    return { valid: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
  }
  if (!signature) {
    logger.warn('Hermes webhook missing signature header');
    return { valid: false, reason: 'MISSING_SIGNATURE' };
  }
  if (!timestampHeader || !/^\d{10}$/.test(String(timestampHeader))) {
    return { valid: false, reason: 'MISSING_OR_INVALID_TIMESTAMP' };
  }

  const timestampSec = Number(timestampHeader);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestampSec) > MAX_TIMESTAMP_DRIFT_SEC) {
    logger.warn({ timestampHeader, nowSec }, 'Hermes webhook timestamp drift exceeded limit');
    return { valid: false, reason: 'TIMESTAMP_DRIFT' };
  }

  if (!Buffer.isBuffer(req.rawBody)) {
    logger.warn('Hermes webhook raw request body is unavailable');
    return { valid: false, reason: 'RAW_BODY_UNAVAILABLE' };
  }

  if (!verifyHmacSha256(req.rawBody, signature, hermesConfig.webhookSecret)) {
    logger.warn('Hermes webhook invalid signature');
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  return { valid: true };
}

export function signatureValidatorMiddleware(req, res, next) {
  const result = validateHermesSignature(req);
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      error: {
        code: result.reason,
        message: 'Webhook signature verification failed.'
      }
    });
  }
  next();
}

export default { validateHermesSignature, signatureValidatorMiddleware };
