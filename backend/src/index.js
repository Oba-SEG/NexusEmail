require('dotenv').config();

// Sentry MUST be initialized before Express is loaded — Sentry's Express
// instrumentation injects at require time (route spans + naming).
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
  global.Sentry = Sentry;
  console.log('[sentry] backend error tracking enabled');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { initDatabase } = require('./db/database');
const { hasEncryptionKey } = require('./utils/secretbox');

let app = null;
const PORT = process.env.PORT || 4000;

async function main() {
  // Create tables, run migrations, and seed defaults before any route module
  // is required (they all require the database at import time).
  await initDatabase();

  const authRoutes = require('./routes/auth');
  const domainRoutes = require('./routes/domains');
  const { router: settingsRoutes } = require('./routes/settings');
  const brandProtectionRoutes = require('./routes/brandProtection');
  const remediationRoutes = require('./routes/remediation');
  const reportsRoutes = require('./routes/reports');
  const scanRoutes = require('./routes/scans');
  const { requireAuth } = require('./auth');

  app = express();

  // Rate limiting keys on req.ip, which only reflects the real client when
  // the enforced ingress hop is trusted. The hop differs per deployment:
  // behind the Cloudflare Tunnel connections arrive with the Docker bridge
  // gateway as the socket peer (userland proxy), so staging trusts the
  // pinned bridge subnet; behind Render's ingress the peer is Render's
  // proxy (1 hop). TRUST_PROXY takes a comma-separated list: 'loopback',
  // CIDR subnets, or a hop count ('1').
  const trustProxyEnv = process.env.TRUST_PROXY || 'loopback';
  const trustProxyEntries = trustProxyEnv.split(',').map((entry) => {
    const t = entry.trim();
    return /^\d+$/.test(t) ? Number(t) : t;
  });
  // A standalone hop count must be a plain number — Express rejects
  // numeric entries inside a subnet array (proxy-addr only takes strings).
  app.set(
    'trust proxy',
    trustProxyEntries.length === 1 && typeof trustProxyEntries[0] === 'number'
      ? trustProxyEntries[0]
      : trustProxyEntries
  );

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3002', 'http://localhost:3000'],
    credentials: true
  }));

  // Body parsing: JSON plus URL-encoded (some clients post forms).
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // No global request sanitizer: stripping < > ' " from every payload
  // silently corrupted legitimate input (SMTP passwords with quotes were
  // stored mangled; takedown templates and brand names got mangled too),
  // and it never covered DNS-sourced data — the real XSS surface.
  // Defense lives at the render points: HTML templates escape via
  // src/utils/html.js, and JSON responses are framework-encoded.

  // Rate limiting
  // Global API budget. Client IP is real now that trust proxy is scoped to
  // loopback (behind the tunnel it comes from X-Forwarded-For).
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    // Credential endpoints have their own tight budget; excluding them here
    // keeps failed logins from eating the global allowance that /auth/me and
    // organization endpoints share.
    skip: (req) => {
      let path = req.path.toLowerCase();
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      return path === '/api/auth/login'
        || path === '/api/health'
        || path === '/api/cron/tick';
    }
  });
  app.use(limiter);

  // Root route
  app.get('/', (req, res) => {
    res.json({ name: 'NexusEmail API', status: 'running', version: '1.0.0' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/domains', requireAuth, domainRoutes);
  app.use('/api/settings', requireAuth, settingsRoutes);
  app.use('/api/brands', requireAuth, brandProtectionRoutes);
  app.use('/api/domains', requireAuth, remediationRoutes);
  app.use('/api/reports', requireAuth, reportsRoutes);
  app.use('/api/scans', requireAuth, scanRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Keep-warm tick: wakes the instance on Render's free tier and runs any scans
  // that are due. Gated by a shared secret so the public cannot trigger scans.
  app.post('/api/cron/tick', async (req, res) => {
    const provided = req.get('x-cron-secret') || '';
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const { runDueScans } = require('./services/scheduler');
      const result = await runDueScans();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[cron] tick failed:', err.message);
      if (global.Sentry) global.Sentry.captureException(err);
      res.status(500).json({ error: 'tick failed' });
    }
  });

  // Sentry error reporting — after all routes, before the default handler.
  if (process.env.SENTRY_DSN && global.Sentry) {
    app.use((err, req, res, next) => {
      global.Sentry.captureException(err);
      next(err);
    });
  }

  // Final JSON error handler: anything routed here via next(err) would
  // otherwise hit Express's default handler, which answers HTML (and shows
  // stacks outside production). 5xx never echoes internals — detail lives
  // in Sentry/logs only (captured by the middleware above); deliberate
  // 4xx errors keep their message.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    if (status >= 500) console.error(`[${req.method} ${req.originalUrl}] ${status}:`, err?.stack || err);
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
  });

  // Secrets at rest are encrypted under NEXUSEMAIL_ENCRYPTION_KEY; without it
  // every secret read/write fails at request time. Fail at startup instead so
  // a bad deploy never reaches a half-broken serving state.
  if (process.env.NODE_ENV === 'production' && !hasEncryptionKey()) {
    throw new Error('NEXUSEMAIL_ENCRYPTION_KEY is not configured');
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 NexusEmail API running on http://localhost:${PORT}`);
  });

  return server;
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

module.exports = { get app() { return app; } };
