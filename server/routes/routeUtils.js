/**
 * asyncHandler — wraps an async Express route handler so that
 * any thrown error or rejected promise is forwarded to next().
 * Eliminates repetitive try/catch boilerplate in route files.
 */
function asyncHandler(fn) {
  return function(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(function(e) {
      if (!res.headersSent) {
        res.status(500).json({ error: e.message || 'Internal server error' });
      }
    });
  };
}

module.exports = { asyncHandler };
