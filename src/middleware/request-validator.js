import { sendError } from '../utils/response.js';

export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.validatedBody = schema.parse(req.body);
      next();
    } catch (err) {
      const details = err.errors ? err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message
      })) : [err.message];

      return sendError(res, 'VALIDATION_ERROR', 'Request validation failed', details, 400);
    }
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.validatedQuery = schema.parse(req.query);
      next();
    } catch (err) {
      const details = err.errors ? err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message
      })) : [err.message];

      return sendError(res, 'VALIDATION_ERROR', 'Query validation failed', details, 400);
    }
  };
}
