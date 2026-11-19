import crypto from 'crypto';
import { sendError } from '../utils/response.js';

export function setupCsrf(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  next();
}

export function verifyCsrf(req, res, next) {
  // Safe methods pass through
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Exempt webhook and auth login routes from CSRF token (webhook uses HMAC signature, login generates token)
  const exemptPaths = [
    '/api/integrations/hermes/events',
    '/integrations/hermes/events',
    '/api/integrations/hermes/agents',
    '/integrations/hermes/agents',
    '/api/auth/login',
    '/auth/login'
  ];

  const fullPath = (req.baseUrl || '') + (req.path || '');
  if (exemptPaths.some((p) => fullPath.startsWith(p) || req.path.startsWith(p))) {
    return next();
  }

  const tokenFromHeader = req.headers['x-csrf-token'];
  const sessionToken = req.session ? req.session.csrfToken : null;

  if (!tokenFromHeader || !sessionToken || tokenFromHeader !== sessionToken) {
    return sendError(res, 'CSRF_INVALID', 'Invalid or missing CSRF token', [], 403);
  }

  next();
}
