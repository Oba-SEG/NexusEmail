const express = require('express');
const router = express.Router();
const { BrandProtectionService } = require('../services/brandProtection');
const db = require('../db/database');
const { captureException } = require('../capture');

const brandService = new BrandProtectionService();

// T162 — Brand Protection routes now use the relational tables (brands /
// brand_threats / brand_takedowns / brand_takedown_replies /
// brand_safe_entries / brand_alerts) added in this same change.
//
// API response shape is preserved: each brand object still contains nested
// threats[], takedowns[] (with replies[]), and safe_list[], so the frontend
// doesn't need to change. Hydration happens server-side via getBrandFull /
// getBrandsFull, which join the relational tables.

router.get('/settings', (req, res) => {
  res.json({
    reply_to: db.getSetting('brand_protection_reply_to', req.orgId) || 'legal@yourcompany.com'
  });
});

router.put('/settings', (req, res) => {
  const { reply_to } = req.body;
  if (reply_to) {
    db.setSetting('brand_protection_reply_to', reply_to, req.orgId);
  }
  res.json({ success: true });
});

router.get('/', (req, res) => {
  res.json(db.getBrandsFull(req.orgId));
});

router.post('/', (req, res) => {
  const { domain, brand_name } = req.body;
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }
  const created = db.addBrand({ domain, brand_name }, req.orgId);
  res.json({ success: true, ...created, threats: [], takedowns: [], safe_list: [] });
});

router.post('/scan/all', async (req, res) => {
  const brands = db.getBrandsFull(req.orgId);
  const results = [];

  for (const brand of brands) {
    try {
      const previousResults = brand.last_results;
      const result = await brandService.checkBrandProtection(brand.domain, previousResults);
      result.brand_id = brand.id;
      results.push(result);

      db.updateBrand(brand.id, {
        last_scan: new Date().toISOString(),
        last_results: result,
      }, req.orgId);

      if (result.newThreats && result.newThreats.length > 0 && brand.alerts_enabled) {
        for (const alert of (result.alerts || [])) {
          db.addBrandAlert({ ...alert, brand_id: brand.id, brand_name: brand.domain }, req.orgId);
        }
      }
    } catch (e) {
    captureException(e);
      results.push({ domain: brand.domain, error: e.message, brand_id: brand.id });
    }
  }

  res.json({ scanned: brands.length, results });
});

router.post('/check/:id', async (req, res) => {
  const brand = db.getBrandFull(parseInt(req.params.id), req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const result = await brandService.checkBrandProtection(brand.domain, brand.last_results);

  db.updateBrand(brand.id, {
    last_scan: new Date().toISOString(),
    last_results: result,
  }, req.orgId);

  if (result.newThreats && result.newThreats.length > 0 && brand.alerts_enabled) {
    for (const alert of (result.alerts || [])) {
      db.addBrandAlert({ ...alert, brand_id: brand.id, brand_name: brand.domain }, req.orgId);
    }
  }

  res.json(result);
});

// Alerts routes (must be before /:id)
router.get('/alerts', (req, res) => {
  res.json(db.getBrandAlerts(req.orgId, 50));
});

router.delete('/alerts/:alertId', (req, res) => {
  db.deleteBrandAlert(parseInt(req.params.alertId), req.orgId);
  res.json({ success: true });
});

router.post('/alerts/clear', (req, res) => {
  db.clearBrandAlerts(req.orgId);
  res.json({ success: true, message: 'All alerts cleared' });
});

router.get('/:id', (req, res) => {
  const brand = db.getBrandFull(parseInt(req.params.id), req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(brand);
});

router.patch('/:id', (req, res) => {
  const { scan_schedule, alerts_enabled, brand_name } = req.body;
  const updates = {};
  if (scan_schedule !== undefined) updates.scan_schedule = scan_schedule;
  if (alerts_enabled !== undefined) updates.alerts_enabled = alerts_enabled;
  if (brand_name) updates.brand_name = brand_name;

  if (scan_schedule && scan_schedule !== 'manual') {
    const interval = { daily: 1, weekly: 7, monthly: 30 }[scan_schedule];
    if (interval) {
      updates.next_scan = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const updated = db.updateBrand(parseInt(req.params.id), updates, req.orgId);
  if (!updated) return res.status(404).json({ error: 'Brand not found' });
  res.json({ success: true, ...updated });
});

router.post('/:id/safe', (req, res) => {
  const { domain } = req.body;
  const brandId = parseInt(req.params.id);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  db.addSafeEntry(brandId, domain, req.orgId);
  // Auto-purge any existing threats for this domain on this brand
  db.deleteBrandThreatByDomain(brandId, domain, req.orgId);

  res.json({ success: true, message: `Added ${domain} to safe list` });
});

router.delete('/:id/safe', (req, res) => {
  const { domain } = req.body;
  const brandId = parseInt(req.params.id);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  db.removeSafeEntry(brandId, domain, req.orgId);
  res.json({ success: true });
});

router.post('/:id/takedown', async (req, res) => {
  const { domain, threat_type, evidence, contact_email } = req.body;
  const brandId = parseInt(req.params.id);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Lookup registrar for the BAD domain (not the brand)
  const domainRegistrar = await brandService.getRegistrarInfo(domain);
  const registrar = domainRegistrar.registrar ? domainRegistrar : { registrar: 'Unknown', abuse_email: null };

  const baseTakedown = {
    domain,
    threat_type: threat_type || 'impersonation',
    evidence: evidence || {},
    contact_email: contact_email || 'legal@brand.com',
    status: 'pending',
    submitted_at: new Date().toISOString(),
    provider: registrar.registrar,
    abuse_email: registrar.abuse_email,
    email_template: brandService.buildTakedownEmail(domain, brand.brand_name, registrar.registrar, threat_type),
    sent: false,
    notes: ''
  };

  // Try to send email via SMTP
  const senderEmail = contact_email || 'legal@yourcompany.com';

  if (registrar.abuse_email) {
    try {
      const { NotificationService } = require('../services/notifications');
      const notifService = new NotificationService();
      const smtpConfig = JSON.parse(db.getSetting('smtp_config', req.orgId) || '{}');

      if (smtpConfig.host && smtpConfig.host.trim()) {
        notifService.configureSMTP(smtpConfig);
        const emailResult = await notifService.sendNotification(
          registrar.abuse_email,
          `[Brand Abuse Report] ${domain} - ${threat_type || 'Impersonation'}`,
          baseTakedown.email_template,
          { replyTo: senderEmail, cc: senderEmail }
        );
        if (emailResult.success) {
          baseTakedown.sent = true;
          baseTakedown.status = 'sent';
          baseTakedown.sent_at = new Date().toISOString();
          baseTakedown.sender_email = senderEmail;
        }
      }
    } catch (e) {
    captureException(e);
      console.error('Failed to send takedown email:', e.message);
    }
  }

  const takedown = db.addBrandTakedown(baseTakedown, brandId, req.orgId);
  res.json({ success: true, takedown_id: takedown.id, takedown });
});

router.get('/:id/takedowns', (req, res) => {
  const brand = db.getBrand(parseInt(req.params.id), req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(db.getBrandTakedowns(brand.id, req.orgId));
});

// Add reply to takedown
router.post('/:id/takedown/:takedownId/reply', (req, res) => {
  const { from, subject, body, direction } = req.body;
  const brandId = parseInt(req.params.id);
  const takedownId = parseInt(req.params.takedownId);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const reply = db.addTakedownReply({ from, subject, body, direction: direction || 'incoming' }, takedownId, brandId, req.orgId);
  if (!reply) return res.status(404).json({ error: 'Takedown not found' });

  // If incoming reply on a 'sent' takedown, advance status to waiting_response
  if ((direction || 'incoming') === 'incoming') {
    const tdRow = db.getBrandTakedowns(brandId, req.orgId).find(t => t.id === takedownId);
    if (tdRow && tdRow.status === 'sent') {
      db.updateBrandTakedown(takedownId, brandId, { status: 'waiting_response' }, req.orgId);
    }
  }

  res.json({ success: true, reply });
});

router.patch('/:id/takedown/:takedownId', (req, res) => {
  const { status, notes } = req.body;
  const brandId = parseInt(req.params.id);
  const takedownId = parseInt(req.params.takedownId);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const updates = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  const updated = db.updateBrandTakedown(takedownId, brandId, updates, req.orgId);
  if (!updated) return res.status(404).json({ error: 'Takedown not found' });

  res.json({ success: true });
});

router.post('/:id/threat', (req, res) => {
  const { domain, threat_type, severity, notes } = req.body;
  const brandId = parseInt(req.params.id);
  const brand = db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const threat = db.addBrandThreat({
    domain, threat_type, severity, notes,
    detected_at: new Date().toISOString(),
  }, brandId, req.orgId);

  res.json({ success: true, threat_id: threat.id });
});

router.get('/:id/threats', (req, res) => {
  const brand = db.getBrand(parseInt(req.params.id), req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(db.getBrandThreats(brand.id, req.orgId));
});

router.delete('/:id', (req, res) => {
  const brandId = parseInt(req.params.id);
  // Foreign keys with ON DELETE CASCADE handle threats / takedowns /
  // replies / safe_entries / alerts cleanup automatically.
  const ok = db.deleteBrand(brandId, req.orgId);
  res.json({ success: ok });
});

module.exports = router;
