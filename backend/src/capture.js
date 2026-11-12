// Safe Sentry capture for route handlers that swallow errors internally
// (catch blocks that still send a JSON error response). No-ops when Sentry
// isn't configured, so it's free to call everywhere.
function captureException(err) {
  try {
    if (process.env.SENTRY_DSN && global.Sentry) {
      global.Sentry.captureException(err);
    }
  } catch {
    // never let error reporting break request handling
  }
}

module.exports = { captureException };
