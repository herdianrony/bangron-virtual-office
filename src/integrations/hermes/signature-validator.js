import { verifyHmacSha256 } from '../../utils/crypto.js';
import { hermesConfig } from '../../config/index.js';
import logger from '../../utils/logger.js';

const MAX_TIMESTAMP_DRIFT_SEC = 300; // 5 minutes replay protection

export function validateHermesSignature(req) {
  // Header resmi Outbound Webhooks Hermes Agent: X-Hermes-Signature-256 (GitHub-style).
  // Kompatibel juga dengan X-Hermes-Signature (kontrak internal) dan X-Hub-Signature-256 (GitHub).
  const signature =
    req.headers['x-hermes-signature-256'] ||
    req.headers['x-hermes-signature'] ||
    req.headers['x-hub-signature-256'];
  const timestampHeader = req.headers['x-hermes-timestamp'];

  if (!signature) {
    logger.warn('Hermes webhook missing signature header');
    return { valid: false, reason: 'MISSING_SIGNATURE' };
  }

  // Replay protection if timestamp header is provided
  if (timestampHeader) {
    const timestampSec = parseInt(timestampHeader, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!isNaN(timestampSec) && Math.abs(nowSec - timestampSec) > MAX_TIMESTAMP_DRIFT_SEC) {
      logger.warn({ timestampHeader, nowSec }, 'Hermes webhook timestamp drift exceeded limit');
      return { valid: false, reason: 'TIMESTAMP_DRIFT' };
    }
  }

  // Raw body required for signature check
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const isValid = verifyHmacSha256(rawBody, signature, hermesConfig.webhookSecret);

  if (!isValid) {
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

export default {
  validateHermesSignature,
  signatureValidatorMiddleware
};
