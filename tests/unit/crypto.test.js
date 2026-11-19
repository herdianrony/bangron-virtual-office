import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword, computeHmacSha256, verifyHmacSha256 } from '../../src/utils/crypto.js';

describe('Crypto Utilities', () => {
  it('hashes and compares passwords securely with bcrypt', async () => {
    const raw = 'SuperSecret123!';
    const hash = await hashPassword(raw);

    expect(hash).not.toBe(raw);
    const matches = await comparePassword(raw, hash);
    expect(matches).toBe(true);

    const falseMatch = await comparePassword('WrongPassword', hash);
    expect(falseMatch).toBe(false);
  });

  it('computes and verifies HMAC-SHA256 signatures for webhook verification', () => {
    const secret = 'my-webhook-secret-key-123';
    const payload = JSON.stringify({ event: 'agent:start', task_id: 'task_100' });
    const signature = computeHmacSha256(payload, secret);

    expect(verifyHmacSha256(payload, signature, secret)).toBe(true);
    expect(verifyHmacSha256(payload, 'sha256=invalid', secret)).toBe(false);
    expect(verifyHmacSha256(payload, signature, 'wrong-secret')).toBe(false);
  });
});
