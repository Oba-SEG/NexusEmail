const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { NotificationService } = require('../services/notifications');
const { getProvider } = require('../services/providers');
const { captureException } = require('../capture');
const { sign, hashPassword, verifyPassword, requireRole } = require('../auth');
const { parseRecipients, scheduleConfigHash } = require('../services/reportBuilder');
const { isScanEnabledValue } = require('../services/scanSchedule');

const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly'];
const REPORT_STATE_KEY = 'report_schedule_state';

async function readReportState(orgId, config) {
  const raw = await db.getOrgSetting(REPORT_STATE_KEY, orgId);
  let state = null;
  try { state = raw ? JSON.parse(raw) : null; } catch { state = null; }
  if (!state || state.config_hash !== scheduleConfigHash(config)) return null;
  return state;
}

// Notifications (matches frontend)
router.get('/notifications', async (req, res, next) => {
  try {
    const smtpRaw = await db.getSetting('smtp_config', req.orgId);
    const smtpMasked = smtpRaw ? JSON.parse(smtpRaw) : null;
    if (smtpMasked) delete smtpMasked.pass;
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
    // The SMTP password is never returned at all — masks still leak short
    // secrets and prefixes.
    const smtpRaw = await db.getSetting('smtp_config', req.orgId);
    const smtpMasked = smtpRaw ? JSON.parse(smtpRaw) : null;
    if (smtpMasked) delete smtpMasked.pass;
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
        enabled: isScanEnabledValue(await db.getOrgSetting('scan_schedule_enabled', req.orgId))
      }
    });
  } catch (err) { next(err); }
});

// Workspace rename. Owner/admin only; the slug (used in URLs and support
// references) is intentionally immutable here.
router.patch('/organization', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Workspace name must be between 2 and 80 characters' });
    }
    let org = null;
    await db.withTransaction(async (tx) => {
      org = await db.updateOrganization(req.orgId, { name }, tx);
      if (!org) return;
      await db.insertAuditLog({
        actorUserId: req.user.id,
        actorEmail: req.user.email,
        action: 'organization.renamed',
        targetOrgId: req.orgId,
        detail: { name }
      }, tx);
    });
    if (!org) return res.status(404).json({ error: 'Workspace not found' });
    res.json({ organization: { id: org.id, name: org.name, slug: org.slug } });
  } catch (err) { next(err); }
});

// Self-service password change. Verifying the current password keeps a
// borrowed session from locking the real owner out. setUserPassword bumps
// token_version in the same statement, so every other device is signed out;
// the fresh token returned here keeps this device signed in.
router.post('/password', async (req, res, next) => {
  try {
    const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const nextPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!current || !nextPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    if (nextPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (!req.user.password_hash || !verifyPassword(current, req.user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    let tokenVersion;
    await db.withTransaction(async (tx) => {
      tokenVersion = await db.setUserPassword(req.user.id, hashPassword(nextPassword), tx);
      await db.insertAuditLog({
        actorUserId: req.user.id,
        actorEmail: req.user.email,
        action: 'user.password_changed',
        targetOrgId: req.orgId,
        detail: {}
      }, tx);
    });
    const token = sign({
      sub: req.user.id,
      org_id: req.user.org_id,
      role: req.user.role,
      tv: tokenVersion
    });
    res.json({ success: true, token });
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

// SMTP Config — delivery credentials and connection tests are owner/admin
// only: the test opens a real outbound connection with the saved credentials.
router.post('/smtp', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const { host, port, secure, user, from } = req.body;
    let { pass } = req.body;
    // Preserve a stored password only from this tenant's own row, and only
    // when the endpoint and account are unchanged: a global deployment
    // password must never be sent to a different server the tenant picks.
    const stored = JSON.parse((await db.getOrgSetting('smtp_config', req.orgId)) || '{}');
    const nextPort = parseInt(port) || 587;
    // A blank or masked field is a reuse request, never a real password.
    if (typeof pass !== 'string' || pass === '' || /\*{4}$/.test(pass)) {
      const endpointUnchanged = stored.host === host && Number(stored.port) === nextPort && stored.user === user;
      if (endpointUnchanged) {
        pass = stored.pass;
      } else if (user) {
        return res.status(400).json({ error: 'Enter the password for this SMTP account' });
      } else {
        pass = '';
      }
    }
    const config = { host, port: nextPort, secure: !!secure, user, pass, from };
    // Persist only: senders build their transport per operation via
    // NotificationService.createForOrg (DB-backed), so a restart loses nothing
    // and one org's SMTP settings can never leak into another org's sends.
    await db.setSetting('smtp_config', JSON.stringify(config), req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Test SMTP — always tests the stored config (survives restarts)
router.post('/smtp/test', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    // Test the SMTP channel specifically, even when Resend is also saved.
    const svc = await NotificationService.createSmtpForOrg(req.orgId);
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
    // Slack-only: a stalled SMTP/DNS lookup must not delay a webhook test.
    const svc = await NotificationService.createSlackForOrg(req.orgId);
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

// Scheduled report delivery (frequency, recipients, Slack mirror).
router.get('/report-schedule', async (req, res, next) => {
  try {
    const raw = await db.getOrgSetting('report_schedule', req.orgId);
    let saved = {};
    try { saved = raw ? JSON.parse(raw) : {}; } catch {}
    const config = {
      enabled: saved.enabled === true,
      frequency: REPORT_FREQUENCIES.includes(saved.frequency) ? saved.frequency : 'weekly',
      recipients: typeof saved.recipients === 'string' ? saved.recipients : '',
      slack: saved.slack === true,
    };
    const state = await readReportState(req.orgId, config);
    res.json({
      ...config,
      last_run: state?.last_run || null,
      last_result: state?.last_result || null,
    });
  } catch (err) { next(err); }
});

router.post('/report-schedule', async (req, res, next) => {
  try {
    const raw = await db.getOrgSetting('report_schedule', req.orgId);
    let prev = {};
    try { prev = raw ? JSON.parse(raw) : {}; } catch {}
    const enabled = req.body?.enabled === true;
    const frequency = REPORT_FREQUENCIES.includes(req.body?.frequency) ? req.body.frequency : 'weekly';
    const recipients = parseRecipients(req.body?.recipients).join(', ');
    const slack = req.body?.slack === true;
    if (enabled && !recipients && !slack) {
      return res.status(400).json({ error: 'Add at least one recipient or enable Slack delivery.' });
    }
    const prevRecipients = typeof prev.recipients === 'string' ? prev.recipients : '';
    const prevSlack = prev.slack === true;
    const configChanged = recipients !== prevRecipients
      || slack !== prevSlack
      || enabled !== (prev.enabled === true);
    const next = {
      enabled,
      frequency,
      recipients,
      slack,
      updated_at: new Date().toISOString(),
    };
    await db.setSetting('report_schedule', JSON.stringify(next), req.orgId);
    // Delivery progress lives under a separate key, so config saves never
    // resurrect stale checkpoints. Only a delivery-relevant edit resets it.
    if (configChanged) await db.deleteSetting(REPORT_STATE_KEY, req.orgId);
    const state = configChanged ? null : await readReportState(req.orgId, next);
    res.json({
      ...next,
      last_run: state?.last_run || null,
      last_result: state?.last_result || null,
    });
  } catch (err) { next(err); }
});

// Scan schedule. The scheduler runs daily at 02:00 UTC and honors this
// per-org opt-out; there is no custom-cron support to advertise.
router.post('/schedule', requireRole('owner', 'admin'), async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  await db.setSetting('scan_schedule_enabled', enabled ? 'true' : 'false', req.orgId);
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

module.exports = { router };