import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function comparePassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

export function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const randomBytes = crypto.randomBytes(6).toString('hex');
  return prefix ? `${prefix}_${timestamp}${randomBytes}` : `${timestamp}${randomBytes}`;
}

export function verifyHmacSha256(rawBody, signature, secret) {
  if (!signature || !secret || !rawBody) {
    return false;
  }

  try {
    const cleanSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const expectedSig = hmac.digest('hex');

    const sigBuf = Buffer.from(cleanSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function computeHmacSha256(rawBody, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return 'sha256=' + hmac.digest('hex');
}

export default {
  hashPassword,
  comparePassword,
  generateId,
  verifyHmacSha256,
  computeHmacSha256
};
