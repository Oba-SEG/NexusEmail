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

const fs = require('fs');
const path = require('path');
const { restoreLatestSnapshot, startSnapshotLoop } = require('./services/snapshot');
const dataDir = process.env.NEXUSEMAIL_DATA_DIR || path.join(__dirname, '../../data');
const sqliteFile = process.env.NEXUSEMAIL_DB_PATH || path.join(dataDir, 'nexusemail.sqlite');

let app = null;
const PORT = process.env.PORT || 4000;

async function main() {
  // Restore the database from object storage before any route module is
  // required (they all require the database at import time).
  // Fail hard when nothing usable exists: proceeding would create a fresh
  // database whose first snapshot would overwrite the real one in storage.
  try {
    await restoreLatestSnapshot({ sqliteFile });
  } catch (err) {
    const usable = fs.existsSync(sqliteFile) && fs.statSync(sqliteFile).size > 0;
    console.error(`[snapshot] restore failed${usable ? ' (continuing with local copy)' : ' (no local copy — aborting)'}`, err.message);
    if (global.Sentry) global.Sentry.captureException(err);
    if (!usable) process.exit(1);
  }

  const authRoutes = require('./routes/auth');
  const whmcsRoutes = require('./routes/whmcs');
  const domainRoutes = require('./routes/domains');
  const { router: settingsRoutes } = require('./routes/settings');
  const brandProtectionRoutes = require('./routes/brandProtection');
  const remediationRoutes = require('./routes/remediation');
  const reportsRoutes = require('./routes/reports');
  const { requireAuth } = require('./auth');

  app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3002', 'http://localhost:3000'],
    credentials: true
  }));

  // Body parsing. WHMCS PHP/cURL can submit form-encoded payloads; accept both JSON and URL-encoded bodies before sanitization.
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // Input sanitization - basic XSS prevention
  const sanitizeInput = (req, res, next) => {
    const sanitize = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace(/[<>'"]/g, '');
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      return obj;
    };

    if (req.body) req.body = sanitize(req.body);
    if (req.query) req.query = sanitize(req.query);
    next();
  };

  app.use(sanitizeInput);

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
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

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Keep-warm tick: wakes the instance on Render's free tier and runs any scans
  // that are due. Gated by a shared secret so the public cannot trigger scans.
  // Snapshots after each tick — the instance may spin down before the periodic
  // timer fires again, so every wake ends with a durable copy.
  app.post('/api/cron/tick', async (req, res) => {
    const provided = req.get('x-cron-secret') || '';
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const { runDueScans } = require('./services/scheduler');
      const { snapshotNow } = require('./services/snapshot');
      const result = await runDueScans();
      const snapshot = await snapshotNow({ sqliteFile });
      if (snapshot === 'stale-during-shutdown') {
        // The durable copy does not yet include this tick's writes — do not
        // report success (the keep-warm workflow treats 5xx as retryable).
        return res.status(503).json({ ok: false, ...result, snapshot });
      }
      res.json({ ok: true, ...result, snapshot });
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

  startSnapshotLoop({ sqliteFile, server });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

module.exports = { get app() { return app; } };
