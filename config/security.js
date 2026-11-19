import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const configuredSessionSecret = process.env.SESSION_SECRET;

if (isProduction && (!configuredSessionSecret || configuredSessionSecret.length < 32)) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters in production.');
}

export const securityConfig = {
  // A per-process random value is acceptable for local development only.
  sessionSecret: configuredSessionSecret || randomBytes(48).toString('hex'),
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10),
  bcryptRounds: 12,
  csrfCookieName: 'bvo_csrf',
  sessionCookieName: 'bvo_session'
};

export default securityConfig;
