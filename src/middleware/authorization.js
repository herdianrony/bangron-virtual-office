import { sendError } from '../utils/response.js';

export function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'UNAUTHENTICATED', 'Authentication required.', [], 401);
    }

    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        'FORBIDDEN',
        `Access denied. Role '${req.user.role}' is not authorized for this resource.`,
        [],
        403
      );
    }

    next();
  };
}

export const requireDirector = requireRole('director');
