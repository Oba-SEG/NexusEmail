const express = require('express');
const router = express.Router();
const db = require('../db/database');
const dns = require('dns').promises;
const { EmailSecurityAuditor } = require('../services/auditEngine');
const { DkimAnalyzer } = require('../services/dkimAnalyzer');
const { DomainVerificationService } = require('../services/domainVerification');
const { DmarcReportIngestor } = require('../services/dmarcReportParser');
const { captureException } = require('../capture');
const { normalizeDomain } = require('../utils/domain');

const auditor = new EmailSecurityAuditor();
const verificationService = new DomainVerificationService();
const dmarcIngestor = new DmarcReportIngestor();

// Aggregate XML uploads are large; this route opts into a bigger body
// limit (the global json parser is 10kb) with its own 2MB cap.
const DMARC_UPLOAD_LIMIT = 2 * 1024 * 1024;

// Active domains per organization (per-plan limits later). Env-tunable so
// deployments can tighten it without a code change.
const DOMAIN_CAP = Number.parseInt(process.env.DOMAIN_CAP || '25', 10) || 25;

function capError(activeCount) {
  return `Domain limit reached: ${DOMAIN_CAP} active domains per organization (currently ${activeCount}). Remove domains or upgrade your plan.`;
}

// Get all domains
router.get('/', async (req, res, next) => {
  try {
  const domains = await db.getDomains(req.orgId);
  const result = await Promise.all(domains.map(async (d) => {
    const lastScan = await db.getLatestScan(d.id, req.orgId);
    return {
      ...d,
      // Full latest scan (both writer shapes) for the frontend record
      // chips — the list previously surfaced only score + timestamp.
      latest_scan: lastScan,
      // ?? not ||: a real score of 0 must survive (|| would coerce it to null)
      last_score: lastScan?.score ?? null,
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
    const activeCount = await db.countActiveDomains(req.orgId);
    if (activeCount >= DOMAIN_CAP) {
      return res.status(402).json({ error: capError(activeCount) });
    }

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
  const valid = [];

  for (const rawName of domains) {
    const check = normalizeDomain(rawName);
    if (!check.ok) {
      // no String() coercion here — hostile objects (null toString) throw
      failed.push({ name: typeof rawName === 'string' ? rawName : '[invalid]', error: check.error });
      continue;
    }
    valid.push(check.name);
  }

  // Whole-request cap: if the valid additions would exceed the cap, 402 and
  // insert nothing (no partial adds — predictable upgrade flow).
  if (valid.length > 0) {
    try {
      const activeCount = await db.countActiveDomains(req.orgId);
      if (activeCount + valid.length > DOMAIN_CAP) {
        return res.status(402).json({ error: capError(activeCount) });
      }
    } catch (e) {
      captureException(e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  for (const name of valid) {
    try {
      const domain = await db.addDomain({ name, provider: 'manual', status: 'active' }, req.orgId);
      added.push(name);
    } catch (e) {
    captureException(e);
      failed.push({ name, error: e.message });
    }
  }

  res.json({ added, failed, total: domains.length });
});

// Bulk scan
router.post('/bulk-scan', async (req, res, next) => {
  try {
    const all = (await db.getDomains(req.orgId)).filter(d => d.status === 'active');
    // Honor an explicit target list when the caller provides one:
    // domain_ids (row ids) or names (just-restored domains have no ids
    // yet). An absent or empty list scans every active domain.
    const idTargets = Array.isArray(req.body && req.body.domain_ids)
      ? req.body.domain_ids.map(Number) : null;
    const nameTargets = Array.isArray(req.body && req.body.names)
      ? req.body.names.map(String) : null;
    let domains = all;
    if (idTargets && idTargets.length > 0) domains = all.filter(d => idTargets.includes(d.id));
    else if (nameTargets && nameTargets.length > 0) domains = all.filter(d => nameTargets.includes(d.name));
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
          mta_sts_record: JSON.stringify(audit.mta_sts || null),
          tls_rpt_record: JSON.stringify(audit.tls_rpt || null),
          recommendations: JSON.stringify(audit.recommendations || []),
          issues: JSON.stringify(audit.issues || []),
          score_breakdown: audit.score_breakdown || null
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
  const dmarcReports = await db.getDmarcReports(domain.id, req.orgId, 20);

  res.json({ ...domain, latest_scan: latestScan, history, issues: db.parseField(latestScan?.issues, []), dmarc_reports: dmarcReports });
});

// ===== DMARC aggregate report ingestion (issue #64) =====

// Upload an RFC 7489 aggregate XML report for a verified domain.
// The global express.json parser is 10kb and runs earlier in the chain,
// so large uploads must use a text content type (text/xml, application/xml
// or text/plain) which the global parser ignores; this route parses the
// raw body itself with its own 2MB cap. Small JSON bodies ({ xml }) also
// work for convenience/testing.
router.post('/:id/dmarc-reports',
  express.text({ type: ['text/*', 'application/xml'], limit: '2mb' }),
  express.json({ limit: '10kb' }),
  async (req, res) => {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });

  // Ownership check: aggregate data is sensitive, only verified domains.
  if (!domain.verified) {
    return res.status(403).json({ error: 'Domain not verified' });
  }

  const xml = typeof req.body === 'string' ? req.body : req.body && req.body.xml;
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    return res.status(400).json({ error: 'Aggregate report XML is required (send { xml } or a text body)' });
  }
  if (Buffer.byteLength(xml, 'utf8') > DMARC_UPLOAD_LIMIT) {
    return res.status(413).json({ error: `Aggregate report too large (max ${DMARC_UPLOAD_LIMIT} bytes)` });
  }

  try {
    const { report, insights } = await dmarcIngestor.ingest(xml, domain.name);
    const stored = await db.addDmarcReport({
      domain_id: domain.id,
      report_id: report.reportId,
      date_begin: report.begin,
      report,
      insights,
    }, req.orgId);
    res.status(201).json({ success: true, report_id: stored.id, report, insights });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// List ingested aggregate reports (newest first) for a domain.
router.get('/:id/dmarc-reports', async (req, res) => {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });
  const reports = await db.getDmarcReports(domain.id, req.orgId, 20);
  res.json(reports);
});

// Scan single domain
// On-demand DKIM selector check: the default sweep only probes common
// selectors, but a customer often knows theirs (e.g. resend, google,
// selector1). Validates the selector shape, probes DNS live, returns the
// parsed key data or a friendly not-published message.
// On-demand DKIM selector check: the default sweep only probes common
// selectors, but a customer often knows theirs (e.g. resend, google,
// selector1). Distinguishes a confirmed-absent record from a DNS lookup
// failure (retryable) so "not published" is never a lie.
router.post('/:id/dkim-check', async (req, res, next) => {
  try {
    const domain = await db.getDomain(parseInt(req.params.id, 10), req.orgId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const selector = String(req.body?.selector || '').trim().toLowerCase();
    // Dot-separated selectors are valid (e.g. "2023.azure", "k1.sep").
    if (!/^[a-z0-9]([a-z0-9_-]{0,62})(\.[a-z0-9]([a-z0-9_-]{0,62}))*$/.test(selector)) {
      return res.status(400).json({
        error: 'Invalid selector — letters, digits, dashes, underscores and dots, max 63 chars per label (e.g. resend, google, selector1).',
      });
    }

    const analyzer = new DkimAnalyzer({ selectors: [] });
    const hostname = `${selector}._domainkey.${domain.name}`;
    let records;
    try {
      records = await dns.resolveTxt(hostname);
    } catch (e) {
      const code = e.code || '';
      if (/ENOTFOUND|ENODATA|NXDOMAIN/.test(code)) {
        return res.json({
          found: false,
          selector,
          query: hostname,
          message: `No ${hostname} record published. If this is the right selector, publish it at your DNS provider, then re-check.`,
        });
      }
      // ESERVFAIL / ETIMEDOUT / network trouble — absence was NOT proven.
      return res.status(503).json({
        error: `DNS lookup for ${hostname} failed (${code || 'unknown error'}). This is not proof the record is missing — try again shortly.`,
      });
    }

    const candidates = records.map((chunks) => (chunks || []).map(String).join(''));
    const record = candidates.find((r) => analyzer.isDkimRecord(r));
    if (!record) {
      return res.json({
        found: false,
        selector,
        query: hostname,
        message: `A record exists at ${hostname} but it is not a DKIM key (missing v=DKIM1 or p= tag).`,
      });
    }

    const sel = analyzer.analyzeSelector(selector, record);
    res.json({
      found: true,
      selector: sel.selector,
      valid: !!sel.valid,
      keySize: sel.keySize,
      algorithm: sel.algorithm,
      record: sel.record,
      errors: sel.errors || [],
      warnings: sel.warnings || [],
    });
  } catch (err) { next(err); }
});

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
      mta_sts_record: JSON.stringify(audit.mta_sts || null),
      tls_rpt_record: JSON.stringify(audit.tls_rpt || null),
      recommendations: JSON.stringify(audit.recommendations || []),
      issues: JSON.stringify(audit.issues || []),
      score_breakdown: audit.score_breakdown || null
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