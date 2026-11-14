const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { EmailSecurityAuditor } = require('../services/auditEngine');
const { NotificationService } = require('../services/notifications');
const { DomainVerificationService } = require('../services/domainVerification');
const { captureException } = require('../capture');
const { normalizeDomain } = require('../utils/domain');

const auditor = new EmailSecurityAuditor();
const notificationService = new NotificationService();
const verificationService = new DomainVerificationService();

// Get all domains
router.get('/', async (req, res, next) => {
  try {
  const domains = await db.getDomains(req.orgId);
  const result = await Promise.all(domains.map(async (d) => {
    const lastScan = await db.getLatestScan(d.id, req.orgId);
    return {
      ...d,
      last_score: lastScan?.score || null,
      last_scan: lastScan?.scanned_at || null,
      verified: d.verified || false,
      verified_at: d.verified_at || null,
      verification_method: d.verification_method || null
    };
  }));
  res.json(result);
  } catch (err) { next(err); }
});

// Generate verification for domain (before adding)
router.post('/verify/generate', async (req, res) => {
  const { domain } = req.body;
  
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }
  
  const verification = verificationService.generateVerification(domain.toLowerCase().trim());
  
  // Store pending verification
  const pending = await db.getSetting('pending_verifications', req.orgId) || '[]';
  const pendingList = JSON.parse(pending);
  pendingList.push(verification);
  await db.setSetting('pending_verifications', JSON.stringify(pendingList.slice(-50)), req.orgId);
  
  res.json(verification);
});

// Check verification status
router.post('/verify/check', async (req, res) => {
  const { domain, token, method } = req.body;
  
  if (!domain || !token) {
    return res.status(400).json({ error: 'Domain and token are required' });
  }
  
  const result = await verificationService.verify(domain, token, method || 'AUTO');
  
  res.json(result);
});

// Add new domain (with optional verification)
router.post('/', async (req, res) => {
  const { name, provider, provider_config, auto_fix, notify_email, verify } = req.body;

  const check = normalizeDomain(name);
  if (!check.ok) return res.status(400).json({ error: check.error });

  try {
    const domainData = {
      name: check.name,
      provider: provider || 'manual',
      provider_config: provider_config || {},
      auto_fix: auto_fix ? 1 : 0,
      notify_email: notify_email || null,
      status: 'active'
    };
    
    // If verification provided, mark as verified
    if (verify && verify.token) {
      domainData.verified = 1;
      domainData.verified_at = new Date().toISOString();
      domainData.verification_method = verify.method || 'TXT';
    }
    
    const domain = await db.addDomain(domainData, req.orgId);
    res.json({ 
      success: true, 
      ...domain,
      verified: domain.verified || false,
      features_unlocked: domain.verified ? true : false
    });
  } catch (error) {
    captureException(error);
    res.status(400).json({ error: error.message });
  }
});

// Verify existing domain
router.post('/:id/verify', async (req, res) => {
  const { token, method } = req.body;
  const id = parseInt(req.params.id);
  const domain = Number.isNaN(id) ? null : await db.getDomain(id, req.orgId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  if (!token) {
    return res.status(400).json({ error: 'Verification token required' });
  }
  
  const result = await verificationService.verify(domain.name, token, method || 'TXT');
  
  if (result.verified) {
    await db.updateDomain(domain.id, {
      verified: true,
      verified_at: result.verified_at,
      verification_method: result.method
    }, req.orgId);
  }
  
  res.json({
    verified: result.verified,
    method: result.method,
    verified_at: result.verified_at,
    reason: result.reason
  });
});

// Get verification status for domain
router.get('/:id/verify/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const domain = Number.isNaN(id) ? null : await db.getDomain(id, req.orgId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  res.json({
    domain: domain.name,
    verified: !!domain.verified,
    verified_at: domain.verified_at || null,
    verification_method: domain.verification_method || null,
    features_unlocked: !!domain.verified
  });
});

// Generate new verification token for existing domain
router.get('/:id/verify/generate', async (req, res) => {
  const id = parseInt(req.params.id);
  const domain = Number.isNaN(id) ? null : await db.getDomain(id, req.orgId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  const verification = verificationService.generateVerification(domain.name);
  res.json(verification);
});

// Bulk add domains
router.post('/bulk', async (req, res) => {
  const { domains } = req.body;
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'No domains provided' });
  }

  const added = [];
  const failed = [];

  for (const rawName of domains) {
    const check = normalizeDomain(rawName);
    if (!check.ok) {
      failed.push({ name: typeof rawName === 'string' ? rawName : String(rawName), error: check.error });
      continue;
    }
    try {
      const domain = await db.addDomain({ name: check.name, provider: 'manual', status: 'active' }, req.orgId);
      added.push(check.name);
    } catch (e) {
    captureException(e);
      failed.push({ name: check.name, error: e.message });
    }
  }

  res.json({ added, failed, total: domains.length });
});

// Bulk scan
router.post('/bulk-scan', async (req, res, next) => {
  try {
    const domains = (await db.getDomains(req.orgId)).filter(d => d.status === 'active');
    const results = [];

    for (const domain of domains) {
      try {
        const audit = await auditor.auditDomain(domain.name);
        await db.addScan({
          domain_id: domain.id,
          score: audit.score,
          spf_status: audit.spf?.status || 'UNKNOWN',
          dkim_status: audit.dkim?.status || 'UNKNOWN',
          dmarc_status: audit.dmarc?.status || 'UNKNOWN',
          spf_record: JSON.stringify(audit.spf),
          dkim_selectors: JSON.stringify(audit.dkim?.selectors || []),
          dmarc_record: JSON.stringify(audit.dmarc),
          issues: JSON.stringify(audit.issues || [])
        }, req.orgId);
        results.push({ domain: domain.name, ...audit });
      } catch (error) {
        captureException(error);
        results.push({ domain: domain.name, error: error.message });
      }
    }

    res.json({ results, total: domains.length });
  } catch (err) { next(err); }
});

// Get single domain
router.get('/:id', async (req, res) => {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });

  const latestScan = await db.getLatestScan(domain.id, req.orgId);
  const history = await db.getScans(domain.id, 30, req.orgId);

  res.json({ ...domain, latest_scan: latestScan, history, issues: db.parseField(latestScan?.issues, []) });
});

// Scan single domain
router.post('/:id/scan', async (req, res) => {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });

  // Check domain ownership verification
  if (!domain.verified) {
    return res.status(403).json({ 
      error: 'Domain not verified',
      verification_required: true,
      message: 'Please verify domain ownership before scanning',
      instructions: {
        method: 'TXT',
        record: `_nexusemail-verification`,
        value: 'Add a TXT record with verification token'
      }
    });
  }

  try {
    const audit = await auditor.auditDomain(domain.name);
    await db.addScan({
      domain_id: domain.id,
      score: audit.score,
      spf_status: audit.spf?.status || 'UNKNOWN',
      dkim_status: audit.dkim?.status || 'UNKNOWN',
      dmarc_status: audit.dmarc?.status || 'UNKNOWN',
      spf_record: JSON.stringify(audit.spf),
      dkim_selectors: JSON.stringify(audit.dkim?.selectors || []),
      dmarc_record: JSON.stringify(audit.dmarc),
      issues: JSON.stringify(audit.issues || [])
    }, req.orgId);
    res.json({ success: true, ...audit });
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Update domain
router.patch('/:id', async (req, res) => {
  const { provider, auto_fix, notify_email } = req.body;
  const updates = {};
  if (provider) updates.provider = provider;
  if (auto_fix !== undefined) updates.auto_fix = auto_fix ? 1 : 0;
  if (notify_email !== undefined) updates.notify_email = notify_email;
  
  await db.updateDomain(parseInt(req.params.id), updates, req.orgId);
  res.json({ success: true });
});

// Delete domain
router.delete('/:id', async (req, res) => {
  await db.deleteDomain(parseInt(req.params.id), req.orgId);
  res.json({ success: true });
});

module.exports = router;