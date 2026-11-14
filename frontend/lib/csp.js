// CSP builder shared by next.config.js (server headers for Docker/VPS
// staging) and app/layout.tsx (meta tag for static-export/GitHub Pages
// builds, which can't set response headers). Every connect target is derived
// from the same build-time inputs the client uses, so a
// vars.NEXT_PUBLIC_API_URL override (e.g. a Render hostname) can never be
// blocked by a stale hardcoded origin.

function apiOrigin() {
  try {
    const raw = process.env.NEXT_PUBLIC_API_URL || "https://nexusapi.segbytes.xyz/api";
    return new URL(raw).origin;
  } catch {
    return "https://nexusapi.segbytes.xyz";
  }
}

function cspValue({ withFrameAncestors } = {}) {
  const connect = [
    "'self'",
    apiOrigin(),
    "http://localhost:4000",
    // Sentry ingestion (browser fetch transport); the DSN's own host is
    // covered by the wildcards.
    "https://*.ingest.sentry.io",
    "https://*.sentry.io",
  ].join(" ");
  // unsafe-eval is a dev-mode need (React refresh/HMR). Production builds
  // don't eval, so it's only emitted when explicitly running `next dev`
  // (NODE_ENV=development); production defaults to a locked-down script-src.
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (process.env.NODE_ENV === "development") scriptSrc.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
  ];
  if (withFrameAncestors) directives.push("frame-ancestors 'none'");
  directives.push("base-uri 'self'", "form-action 'self'");
  return directives.join("; ");
}

module.exports = { apiOrigin, cspValue };
