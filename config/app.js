import dotenv from 'dotenv';
dotenv.config();

/**
 * Test-only routes (e.g. /api/test/runtime-status) require an EXPLICIT opt-in
 * flag AND a non-production environment. `NODE_ENV !== 'production'` alone is
 * never a sufficient safety boundary: development boxes can be exposed, and
 * a mis-set NODE_ENV must not silently enable test endpoints.
 *
 * Production hard-locks this to false even if ENABLE_TEST_ROUTES=true leaks
 * into the environment.
 */
export function resolveTestRoutesEnabled(env = process.env) {
  return env.ENABLE_TEST_ROUTES === 'true' && env.NODE_ENV !== 'production';
}

export const appConfig = {
  name: process.env.APP_NAME || 'Bangron Virtual Office',
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  testRoutesEnabled: resolveTestRoutesEnabled(),
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  url: process.env.APP_URL || 'http://localhost:3000'
};

export default appConfig;
