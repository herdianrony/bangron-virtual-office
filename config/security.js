import dotenv from 'dotenv';
dotenv.config();

export const securityConfig = {
  sessionSecret: process.env.SESSION_SECRET || 'bangron-default-secret-key-change-in-prod-2026',
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10), // 24h
  bcryptRounds: 10,
  csrfCookieName: 'bvo_csrf',
  sessionCookieName: 'bvo_session'
};

export default securityConfig;
