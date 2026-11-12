/** @type {import('next').NextConfig} */
// Static export is used for the GitHub Pages hosted build
// (NEXUSEMAIL_STATIC_EXPORT=1 in the Pages workflow). Docker/VPS staging
// builds omit it and get server headers() instead.
const STATIC_EXPORT = !!process.env.NEXUSEMAIL_STATIC_EXPORT;

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.brandprotection.segbytes.xyz http://localhost:4000; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }
];

// Same policy as a <meta> tag for the static-export build (GitHub Pages can't
// set response headers). frame-ancestors has no effect in <meta> CSP and is
// omitted; X-Frame-Options headers are enforced by GitHub Pages for Pages
// sites (SAMEORIGIN) which covers clickjacking there.
const metaCSP = "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.brandprotection.segbytes.xyz http://localhost:4000; base-uri 'self'; form-action 'self'";

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
