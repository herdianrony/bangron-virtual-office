import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';

export function errorHandler(err, req, res, next) {
  logger.error({
    err: {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
    method: req.method,
    url: req.url
  }, 'Unhandled request error');

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message || 'An unexpected error occurred';

  return sendError(res, err.code || 'INTERNAL_ERROR', message, [], statusCode);
}

export function notFoundHandler(req, res) {
  return sendError(res, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`, [], 404);
}
