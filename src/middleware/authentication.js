import { sendError } from '../utils/response.js';
import { getDatabase } from '../database/connection.js';

export function authenticate(req, res, next) {
  if (!req.session || !req.session.userId) {
    return sendError(res, 'UNAUTHENTICATED', 'Authentication required. Please log in.', [], 401);
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(req.session.userId);

  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    return sendError(res, 'UNAUTHENTICATED', 'User account is inactive or not found.', [], 401);
  }

  req.user = user;
  next();
}

export function optionalAuthenticate(req, res, next) {
  if (req.session && req.session.userId) {
    const db = getDatabase();
    const user = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.is_active) {
      req.user = user;
    }
  }
  next();
}
