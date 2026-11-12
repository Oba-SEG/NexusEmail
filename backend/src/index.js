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

const authRoutes = require('./routes/auth');
const whmcsRoutes = require('./routes/whmcs');
const domainRoutes = require('./routes/domains');
const { router: settingsRoutes } = require('./routes/settings');
const brandProtectionRoutes = require('./routes/brandProtection');
const remediationRoutes = require('./routes/remediation');
const reportsRoutes = require('./routes/reports');
const { requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4000;

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
  const db = require('./db/database');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Sentry error reporting — after all routes, before the default handler.
if (process.env.SENTRY_DSN && global.Sentry) {
  app.use((err, req, res, next) => {
    global.Sentry.captureException(err);
    next(err);
  });
}

app.listen(PORT, () => {
  console.log(`🚀 NexusEmail API running on http://localhost:${PORT}`);
});

module.exports = app;
