/** @type {import('next').NextConfig} */
// Static export is used for the GitHub Pages hosted build
// (NEXUSEMAIL_STATIC_EXPORT=1 in the Pages workflow). Docker/VPS staging
// builds omit it and get server headers() instead.
const STATIC_EXPORT = !!process.env.NEXUSEMAIL_STATIC_EXPORT;

const { cspValue } = require('./lib/csp');

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: cspValue({ withFrameAncestors: true }) }
];

const nextConfig = {
  reactStrictMode: true,
  ...(STATIC_EXPORT
    ? {
        output: 'export',
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {
        async headers() {
          return [
            {
              source: '/(.*)',
              headers: securityHeaders
            }
          ];
        }
      }),
};

module.exports = nextConfig;
