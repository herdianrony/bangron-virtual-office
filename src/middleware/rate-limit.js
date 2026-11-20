import rateLimit from 'express-rate-limit';

// Secure production default: 30 login attempts per IP per 15 minutes.
const AUTH_RATE_LIMIT_PRODUCTION_MAX = 30;
// Test-only default headroom so E2E suites (one login per test) never trip
// the limiter. Only ever applied when NODE_ENV === 'test'.
const AUTH_RATE_LIMIT_TEST_DEFAULT_MAX = 300;

/**
 * Resolve the auth rate limit for a given environment.
 *
 * Security contract:
 * - Production ALWAYS uses the secure default (30/15min). No environment
 *   variable can raise it in production.
 * - The AUTH_RATE_LIMIT_MAX override is honored ONLY under NODE_ENV === 'test'
 *   (vitest / Playwright E2E). Development and any other env keep the secure
 *   default, so a stray override cannot weaken a deployed instance.
 *
 * Exported as a pure function so unit tests can prove the matrix without
 * booting Express.
 */
export function resolveAuthRateLimitMax(env = process.env) {
  if (env.NODE_ENV === 'production') {
    return AUTH_RATE_LIMIT_PRODUCTION_MAX;
  }
  if (env.NODE_ENV === 'test') {
    const override = parseInt(env.AUTH_RATE_LIMIT_MAX || '', 10);
    if (Number.isFinite(override) && override > 0) {
      return override;
    }
    return AUTH_RATE_LIMIT_TEST_DEFAULT_MAX;
  }
  return AUTH_RATE_LIMIT_PRODUCTION_MAX;
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.'
    }
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Brute-force protection stays at 30/15min in production and development.
  // Only an explicit NODE_ENV=test process may raise it (see resolver above).
  max: resolveAuthRateLimitMax(),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again later.'
    }
  }
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
      message: 'Webhook burst threshold exceeded.'
    }
  }
});
