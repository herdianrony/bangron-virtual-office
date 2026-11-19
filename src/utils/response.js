export function sendSuccess(res, data = null, message = null, meta = null, status = 200) {
  const payload = {
    success: true,
    data
  };
  if (message) payload.message = message;
  if (meta) payload.meta = meta;

  return res.status(status).json(payload);
}

export function sendError(res, code = 'INTERNAL_ERROR', message = 'An unexpected error occurred', details = [], status = 500) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details
    }
  });
}

export default {
  sendSuccess,
  sendError
};
