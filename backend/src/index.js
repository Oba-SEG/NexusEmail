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

let app = null;
const PORT = process.env.PORT || 4000;

async function main() {
  // Create tables, run migrations, and seed defaults before any route module
  // is required (they all require the database at import time).
  await initDatabase();

  const authRoutes = require('./routes/auth');
  const whmcsRoutes = require('./routes/whmcs');
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
  // behind the Cloudflare Tunnel the socket peer is cloudflared on localhost
  // ('loopback'); behind Render's ingress the peer is Render's proxy
  // (1 hop). TRUST_PROXY takes 'loopback' (default) or a hop count ('1').
  const trustProxy = process.env.TRUST_PROXY || 'loopback';
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3002', 'http://localhost:3000'],
    credentials: true
  }));

  // Body parsing. WHMCS PHP/cURL can submit form-encoded payloads; accept both JSON and URL-encoded bodies.
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
      const path = req.path.toLowerCase();
      return path === '/api/auth/login' || path === '/api/auth/whmcs-exchange';
    }
  });
  app.use(limiter);

  // Root route
  app.get('/', (req, res) => {
    res.json({ name: 'NexusEmail API', status: 'running', version: '1.0.0' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/whmcs', whmcsRoutes);
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
