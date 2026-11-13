const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { NotificationService } = require('../services/notifications');
const { getProvider } = require('../services/providers');
const { captureException } = require('../capture');

const notificationService = new NotificationService();

// Notifications (matches frontend)
router.get('/notifications', async (req, res) => {
  res.json({
    notify_scan_completed: await db.getSetting('notify_scan_completed', req.orgId) === '1',
    notify_critical_alerts: await db.getSetting('notify_critical_alerts', req.orgId) === '1',
    notify_weekly_report: await db.getSetting('notify_weekly_report', req.orgId) === '1',
    smtp_config: await db.getSetting('smtp_config', req.orgId) ? JSON.parse(await db.getSetting('smtp_config', req.orgId)) : null
  });
});

// Get all config (without sensitive data)
router.get('/config', async (req, res) => {
  const credentials = await db.getSetting('provider_credentials', req.orgId) || '{}';
  const parsed = JSON.parse(credentials);
  
  // Mask sensitive values for response
  const masked = {};
  for (const [provider, config] of Object.entries(parsed)) {
    masked[provider] = {};
    for (const [key, value] of Object.entries(config)) {
      if (value && typeof value === 'string' && value.length > 4) {
        masked[provider][key] = value.substring(0, 4) + '****';
      } else {
        masked[provider][key] = value;
      }
    }
  }

  res.json({
    smtp_config: await db.getSetting('smtp_config', req.orgId) ? JSON.parse(await db.getSetting('smtp_config', req.orgId)) : null,
    provider_credentials: masked,
    notifications: {
      scan_completed: await db.getSetting('notify_scan_completed', req.orgId) === '1',
      critical_alerts: await db.getSetting('notify_critical_alerts', req.orgId) === '1',
      weekly_report: await db.getSetting('notify_weekly_report', req.orgId) === '1'
    },
    scan_schedule: {
      enabled: await db.getSetting('scan_schedule_enabled', req.orgId) === 'true',
      cron: await db.getSetting('scan_schedule_cron', req.orgId) || '0 2 * * *'
    },
    auto_remediation: await db.getSetting('auto_remediation_enabled', req.orgId) === 'true'
  });
});

// Save provider credentials
router.post('/providers/credentials', async (req, res) => {
  const { provider, credentials } = req.body;
  
  if (!provider || !credentials) {
    return res.status(400).json({ error: 'Provider and credentials required' });
  }

  const allCredentials = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}');
  allCredentials[provider.toLowerCase()] = credentials;
  await db.setSetting('provider_credentials', JSON.stringify(allCredentials), req.orgId);
  
  res.json({ success: true });
});

// Delete provider credentials
router.delete('/providers/credentials/:provider', async (req, res) => {
  const provider = req.params.provider.toLowerCase();
  const allCredentials = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}');
  delete allCredentials[provider];
  await db.setSetting('provider_credentials', JSON.stringify(allCredentials), req.orgId);
  
  res.json({ success: true });
});

// Test provider connection
router.post('/providers/test', async (req, res) => {
  const { provider, credentials } = req.body;
  
  if (!provider || !credentials) {
    return res.status(400).json({ error: 'Provider and credentials required' });
  }

  try {
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
router.post('/smtp', async (req, res) => {
  const { host, port, secure, user, pass, from } = req.body;
  const config = { host, port: parseInt(port) || 587, secure: !!secure, user, from };
  await db.setSetting('smtp_config', JSON.stringify(config), req.orgId);
  
  notificationService.configureSMTP({ 
    host, 
    port: parseInt(port) || 587, 
    secure: !!secure, 
    auth: user && pass ? { user, pass } : undefined, 
    from 
  });
  res.json({ success: true });
});

// Test SMTP
router.post('/smtp/test', async (req, res) => {
  const result = await notificationService.testConnection();
  res.json(result);
});

// Notifications preferences
router.post('/notifications', async (req, res) => {
  const { scan_completed, critical_alerts, weekly_report } = req.body;
  if (scan_completed !== undefined) await db.setSetting('notify_scan_completed', scan_completed ? '1' : '0', req.orgId);
  if (critical_alerts !== undefined) await db.setSetting('notify_critical_alerts', critical_alerts ? '1' : '0', req.orgId);
  if (weekly_report !== undefined) await db.setSetting('notify_weekly_report', weekly_report ? '1' : '0', req.orgId);
  res.json({ success: true });
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
router.get('/integrations', async (req, res) => res.json(await db.getIntegrations(req.orgId)));
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
router.post('/bulk-delete', async (req, res) => {
  const { domain_ids } = req.body;
  if (!Array.isArray(domain_ids)) return res.status(400).json({ error: 'Invalid request' });
  for (const id of domain_ids) await db.deleteDomain(id, req.orgId);
  res.json({ success: true, deleted: domain_ids.length });
});

// Health check
router.get('/health', async (req, res) => {
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
});

module.exports = { router, getProviderCredentials };