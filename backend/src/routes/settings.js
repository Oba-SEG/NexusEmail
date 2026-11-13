const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { NotificationService } = require('../services/notifications');
const { getProvider } = require('../services/providers');
const { captureException } = require('../capture');

const notificationService = new NotificationService();

// Notifications (matches frontend)
router.get('/notifications', async (req, res, next) => {
  try {
    const smtpRaw = await db.getSetting('smtp_config', req.orgId);
    const smtpMasked = smtpRaw ? JSON.parse(smtpRaw) : null;
    if (smtpMasked && smtpMasked.pass) smtpMasked.pass = maskSecret(smtpMasked.pass);
    res.json({
      notify_scan_completed: await db.getSetting('notify_scan_completed', req.orgId) !== '0',
      notify_critical_alerts: await db.getSetting('notify_critical_alerts', req.orgId) !== '0',
      notify_weekly_report: await db.getSetting('notify_weekly_report', req.orgId) === '1',
      smtp_config: smtpMasked
    });
  } catch (err) { next(err); }
});

// Get all config (without sensitive data)
function maskSecret(value) {
  if (value && typeof value === 'string' && value.length > 4) {
    return value.substring(0, 4) + '****';
  }
  return value;
}

router.get('/config', async (req, res, next) => {
  try {
    const credentials = await db.getSetting('provider_credentials', req.orgId) || '{}';
    const parsed = JSON.parse(credentials);

    // Mask sensitive values for response
    const masked = {};
    for (const [provider, config] of Object.entries(parsed)) {
      masked[provider] = {};
      for (const [key, value] of Object.entries(config)) {
        masked[provider][key] = maskSecret(value);
      }
    }

    // Mask the SMTP password and Resend API key; the rest is display data.
    const smtpRaw = await db.getSetting('smtp_config', req.orgId);
    const smtpMasked = smtpRaw ? JSON.parse(smtpRaw) : null;
    if (smtpMasked && smtpMasked.pass) smtpMasked.pass = maskSecret(smtpMasked.pass);
    const resendRaw = await db.getSetting('resend_config', req.orgId);
    const resendMasked = resendRaw ? JSON.parse(resendRaw) : null;
    if (resendMasked && resendMasked.api_key) resendMasked.api_key = maskSecret(resendMasked.api_key);

    res.json({
      smtp_config: smtpMasked,
      resend_config: resendMasked,
      slack_webhook: maskSecret(await db.getSetting('slack_webhook', req.orgId)),
      provider_credentials: masked,
      notifications: {
        scan_completed: await db.getSetting('notify_scan_completed', req.orgId) !== '0',
        critical_alerts: await db.getSetting('notify_critical_alerts', req.orgId) !== '0',
        weekly_report: await db.getSetting('notify_weekly_report', req.orgId) === '1'
      },
      scan_schedule: {
        enabled: await db.getSetting('scan_schedule_enabled', req.orgId) === 'true',
        cron: await db.getSetting('scan_schedule_cron', req.orgId) || '0 2 * * *'
      },
      auto_remediation: await db.getSetting('auto_remediation_enabled', req.orgId) === 'true'
    });
  } catch (err) { next(err); }
});

// Save provider credentials
router.post('/providers/credentials', async (req, res, next) => {
  try {
    const { provider, credentials } = req.body;

    if (!provider || !credentials) {
      return res.status(400).json({ error: 'Provider and credentials required' });
    }

    // Atomic merge: a concurrent save/delete of another provider can no
    // longer be lost by a read-modify-write race.
    await db.mergeSetting('provider_credentials', { [provider.toLowerCase()]: credentials }, req.orgId);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// Delete provider credentials
router.delete('/providers/credentials/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider.toLowerCase();
    await db.removeSettingKey('provider_credentials', provider, req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Test provider connection
router.post('/providers/test', async (req, res) => {
  const { provider } = req.body;
  let { credentials } = req.body;

  if (!provider) {
    return res.status(400).json({ error: 'Provider required' });
  }

  try {
    const providerKey = provider.toLowerCase();
    // The GET endpoint returns masked values (first 4 chars + '****') for
    // display only. If the caller echoes those back (the UI's saved-state
    // test does), swap them for the real stored values. Also fall back to
    // stored credentials entirely when none were supplied.
    const stored = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}')[providerKey] || {};
    credentials = credentials || {};
    let hasMasked = false;
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value === 'string' && /\*{4}$/.test(value)) {
        if (stored[key] === undefined) {
          return res.status(400).json({ error: `Stored credentials for ${provider} not found` });
        }
        credentials[key] = stored[key];
        hasMasked = true;
      }
    }
    if (!hasMasked && Object.keys(credentials).length === 0) {
      credentials = stored;
    }
    if (Object.keys(credentials).length === 0) {
      return res.status(400).json({ error: 'Provider and credentials required' });
    }

    const dnsProvider = getProvider(provider, credentials);
    if (!dnsProvider) {
      return res.json({ success: false, error: 'Unknown provider' });
    }

    const result = await dnsProvider.testConnection();
    res.json(result);
  } catch (e) {
    captureException(e);
    res.json({ success: false, error: e.message });
  }
});

// Get provider credentials (for internal use)
async function getProviderCredentials(provider) {
  const all = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}');
  return all[provider.toLowerCase()] || null;
}

// SMTP Config
router.post('/smtp', async (req, res, next) => {
  try {
    const { host, port, secure, user, from } = req.body;
    let { pass } = req.body;
    const stored = JSON.parse(await db.getSetting('smtp_config', req.orgId) || '{}');
    // The GET view never returns the password (it masks it, and the UI form
    // prefills empty). An unchanged/blank password must preserve the stored
    // one instead of wiping it.
    if (typeof pass !== 'string' || pass === '' || /\*{4}$/.test(pass)) {
      pass = stored.pass;
    }
    const config = { host, port: parseInt(port) || 587, secure: !!secure, user, pass, from };
    await db.setSetting('smtp_config', JSON.stringify(config), req.orgId);

    notificationService.configureSMTP({
      host,
      port: parseInt(port) || 587,
      secure: !!secure,
      auth: user && pass ? { user, pass } : undefined,
      from
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Test SMTP — always tests the stored config (survives restarts)
router.post('/smtp/test', async (req, res, next) => {
  try {
    const svc = await NotificationService.createForOrg(req.orgId);
    const result = await svc.testConnection();
    res.json(result);
  } catch (err) { next(err); }
});

// Resend (HTTP email API — works even where outbound SMTP is blocked)
router.post('/resend', async (req, res, next) => {
  try {
    const { from } = req.body;
    let { api_key } = req.body;
    if (typeof api_key === 'string' && /\*{4}$/.test(api_key)) {
      const stored = JSON.parse(await db.getSetting('resend_config', req.orgId) || '{}');
      api_key = stored.api_key;
    }
    if (!api_key) {
      return res.status(400).json({ error: 'Resend API key required' });
    }
    await db.setSetting('resend_config', JSON.stringify({ api_key, from }), req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Test Resend — sends a real email to the given address
router.post('/resend/test', async (req, res, next) => {
  try {
    const svc = await NotificationService.createForOrg(req.orgId);
    const result = await svc.testResend(req.body.to);
    res.json(result);
  } catch (err) { next(err); }
});

// Slack (incoming webhook)
router.post('/slack', async (req, res, next) => {
  try {
    let { webhook_url } = req.body;
    if (typeof webhook_url === 'string' && /\*{4}$/.test(webhook_url)) {
      webhook_url = await db.getSetting('slack_webhook', req.orgId);
    }
    if (!webhook_url) {
      return res.status(400).json({ error: 'Slack webhook URL required' });
    }
    // The backend POSTs to whatever URL is stored — restrict it to Slack's
    // own endpoint to prevent SSRF into internal services.
    if (!NotificationService.isValidSlackWebhook(webhook_url)) {
      return res.status(400).json({ error: 'Webhook URL must be an https://hooks.slack.com/services/… URL' });
    }
    await db.setSetting('slack_webhook', webhook_url, req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Test Slack — posts a real message to the stored webhook
router.post('/slack/test', async (req, res, next) => {
  try {
    const svc = await NotificationService.createForOrg(req.orgId);
    const result = await svc.testSlack();
    res.json(result);
  } catch (err) { next(err); }
});

// Notifications preferences
router.post('/notifications', async (req, res, next) => {
  try {
    const { scan_completed, critical_alerts, weekly_report } = req.body;
    if (scan_completed !== undefined) await db.setSetting('notify_scan_completed', scan_completed ? '1' : '0', req.orgId);
    if (critical_alerts !== undefined) await db.setSetting('notify_critical_alerts', critical_alerts ? '1' : '0', req.orgId);
    if (weekly_report !== undefined) await db.setSetting('notify_weekly_report', weekly_report ? '1' : '0', req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Scan schedule
router.post('/schedule', async (req, res) => {
  const { enabled, cron } = req.body;
  if (enabled !== undefined) await db.setSetting('scan_schedule_enabled', enabled.toString(), req.orgId);
  if (cron) await db.setSetting('scan_schedule_cron', cron, req.orgId);
  res.json({ success: true });
});

// Auto remediation
router.post('/auto-remediation', async (req, res) => {
  const { enabled } = req.body;
  await db.setSetting('auto_remediation_enabled', enabled ? 'true' : 'false', req.orgId);
  res.json({ success: true });
});

// Integrations
router.get('/integrations', async (req, res, next) => { try { res.json(await db.getIntegrations(req.orgId)); } catch (err) { next(err); } });
router.post('/integrations', async (req, res) => {
  const { provider, config, name } = req.body;
  const integration = await db.addIntegration({ provider, name: name || provider, config: config || {}, status: 'active' }, req.orgId);
  res.json({ success: true, ...integration });
});
router.delete('/integrations/:id', async (req, res) => {
  await db.deleteIntegration(parseInt(req.params.id), req.orgId);
  res.json({ success: true });
});

// Bulk delete domains
router.post('/bulk-delete', async (req, res, next) => {
  try {
    const { domain_ids } = req.body;
    if (!Array.isArray(domain_ids)) return res.status(400).json({ error: 'Invalid request' });
    for (const id of domain_ids) await db.deleteDomain(id, req.orgId);
    res.json({ success: true, deleted: domain_ids.length });
  } catch (err) { next(err); }
});

// Health check
router.get('/health', async (req, res, next) => {
  try {
    const domains = await db.getDomains(req.orgId);
    const integrations = await db.getIntegrations(req.orgId);
    const credentials = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}');
    res.json({
      status: 'healthy',
      domains: domains.length,
      integrations: integrations.length,
      providers_configured: Object.keys(credentials).length,
      timestamp: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

module.exports = { router, getProviderCredentials };