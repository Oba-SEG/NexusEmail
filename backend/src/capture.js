// Safe Sentry capture for route handlers that swallow errors internally
// (catch blocks that still send a JSON error response). No-ops the Sentry
// half when Sentry isn't configured, but always logs server-side so
// diagnostics survive either way.
function captureException(err) {
  try {
    console.error('[capture]', err?.stack || err);
    if (process.env.SENTRY_DSN && global.Sentry) {
      global.Sentry.captureException(err);
    }
  } catch {
    // never let error reporting break request handling
  }
}

module.exports = { captureException };
