import { verifyHmacSha256 } from '../../utils/crypto.js';
import { hermesConfig } from '../../config/index.js';
import { parseEventTimestamp } from './event-timestamp.js';
import logger from '../../utils/logger.js';

const MAX_TIMESTAMP_DRIFT_SEC = 300;
// The legacy X-Hermes-Timestamp header (if a sender still provides it) must
// agree with the signed body timestamp within this tolerance.
const HEADER_MATCH_TOLERANCE_MS = 1000;

// Signature layer (shared by /events and /agents):
// HMAC-SHA256 over the EXACT raw request bytes, constant-time comparison.
// Accepted signature headers: X-Hermes-Signature-256 (native Hermes outbound
// webhooks, `sha256=<hex>`), x-hermes-signature, x-hub-signature-256.
//
// Verified native contract (Hermes v0.23.2, agent/outbound_webhooks.py):
// delivery_id and timestamp live INSIDE the signed body; there is NO native
// X-Hermes-Timestamp header. Freshness for /events is therefore validated
// from the signed body in validateHermesEvent below — never from an unsigned
// header alone.
export function validateHermesSignature(req) {
  const signature =
    req.headers['x-hermes-signature-256'] ||
    req.headers['x-hermes-signature'] ||
    req.headers['x-hub-signature-256'];

  if (!hermesConfig.webhookSecret) {
    logger.error('Hermes webhook secret is not configured');
    return { valid: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
  }
  if (!signature) {
    logger.warn('Hermes webhook missing signature header');
    return { valid: false, reason: 'MISSING_SIGNATURE' };
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

// Event layer (/events only): signature + replay protection.
//
// 1. A stable event/delivery ID is REQUIRED (delivery_id for native Hermes,
//    event_id for the Bangron-defined contract). Missing IDs are rejected —
//    never silently replaced with a random ID, which would defeat dedupe.
// 2. Freshness is validated from the timestamp INSIDE the HMAC-signed body
//    (timestamp or occurred_at; unix seconds/ms or ISO-8601). Because the
//    signature covers the exact body bytes, the freshness timestamp is
//    cryptographically bound to the signed content.
// 3. If the legacy X-Hermes-Timestamp header is present it must match the
//    signed body timestamp; a modified header with an unchanged signature is
//    rejected (TIMESTAMP_HEADER_MISMATCH).
// 4. Duplicate deliveries are handled downstream by the reconciler's
//    event_id dedupe (the controller answers 409 DUPLICATE_EVENT).
export function validateHermesEvent(req) {
  const sigCheck = validateHermesSignature(req);
  if (!sigCheck.valid) return sigCheck;

  const body = req.body || {};

  const stableId = body.delivery_id ?? body.event_id;
  if (stableId === undefined || stableId === null || String(stableId).trim() === '') {
    logger.warn('Hermes webhook missing stable event/delivery ID');
    return { valid: false, reason: 'MISSING_STABLE_EVENT_ID' };
  }

  const rawTs =
    body.timestamp !== undefined && body.timestamp !== null && body.timestamp !== ''
      ? body.timestamp
      : body.occurred_at;
  if (rawTs === undefined || rawTs === null || rawTs === '') {
    logger.warn({ eventId: stableId }, 'Hermes webhook missing signed timestamp');
    return { valid: false, reason: 'MISSING_SIGNED_TIMESTAMP' };
  }
  const tsMs = parseEventTimestamp(rawTs);
  if (tsMs === null) {
    logger.warn({ eventId: stableId, rawTs }, 'Hermes webhook malformed timestamp');
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }
  const nowMs = Date.now();
  if (Math.abs(nowMs - tsMs) > MAX_TIMESTAMP_DRIFT_SEC * 1000) {
    logger.warn({ eventId: stableId, tsMs, nowMs }, 'Hermes webhook timestamp drift exceeded limit');
    return { valid: false, reason: 'TIMESTAMP_DRIFT' };
  }

  const headerTs = req.headers['x-hermes-timestamp'];
  if (headerTs !== undefined) {
    const headerMs = parseEventTimestamp(headerTs);
    if (headerMs === null || Math.abs(headerMs - tsMs) > HEADER_MATCH_TOLERANCE_MS) {
      logger.warn({ eventId: stableId, headerTs }, 'Hermes webhook timestamp header disagrees with signed body');
      return { valid: false, reason: 'TIMESTAMP_HEADER_MISMATCH' };
    }
  }

  return { valid: true, eventId: String(stableId), timestampMs: tsMs };
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

export default { validateHermesSignature, validateHermesEvent, signatureValidatorMiddleware };
