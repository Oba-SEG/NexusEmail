// Central place to report exceptions to the error tracker.
// No-ops when Sentry is not configured (global.Sentry only exists after init).
function captureException(err) {
  if (global.Sentry) global.Sentry.captureException(err);
}

module.exports = { captureException };
