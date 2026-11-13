const express = require('express');
const router = express.Router();
const { getDomain, addScan, getScans } = require('../db/database');
const { DNSService } = require('../services/dnsProviders');
const { captureException } = require('../capture');

// Run scan on domain
router.post('/run/:domainId', async (req, res, next) => {
  try {
    // Org-scoped lookup: a signed-in user must not operate on another
    // organization's domain by guessing its id.
    const domain = await getDomain(req.params.domainId, req.orgId);

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const dnsService = new DNSService(domain.provider);

    const [spf, dkim, dmarc] = await Promise.all([
      dnsService.checkSPF(domain.name),
      dnsService.checkDKIM(domain.name),
      dnsService.checkDMARC(domain.name)
    ]);

    const score = dnsService.calculateHealthScore(spf, dkim, dmarc);

    const issues = [
      ...(spf.found ? [] : ['SPF not found']),
      ...(dkim.found ? [] : ['DKIM not found']),
      ...(dmarc.found && dmarc.policy === 'none' ? ['DMARC policy is none'] : [])
    ];

    // Insert under the authenticated organization, never the domain's.
    // Also store the legacy-named fields (spf_record/dkim_selectors/dmarc_record)
    // that the remediation route reads, alongside the object form.
    const created = await addScan({
      domain_id: domain.id,
      score,
      spf, dkim, dmarc,
      spf_record: JSON.stringify(spf),
      dkim_selectors: JSON.stringify(dkim.selectors || []),
      dmarc_record: JSON.stringify(dmarc),
      issues
    }, req.orgId);

    res.json({
      success: true,
      scan_id: created.id,
      score,
      spf,
      dkim,
      dmarc,
      issues
    });
  } catch (error) {
    next(error);
  }
});

// Get scan history for domain
router.get('/history/:domainId', async (req, res, next) => {
  try {
    const scans = await getScans(req.params.domainId, 50, req.orgId);
    res.json(scans);
  } catch (error) { next(error); }
});

// Auto-fix issues
router.post('/fix/:domainId', async (req, res, next) => {
  try {
    const domain = await getDomain(req.params.domainId, req.orgId);

    if (!domain) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const { record_type, content } = req.body;
    const dnsService = new DNSService(domain.provider);

    let result;
    switch (record_type) {
      case 'spf':
        result = await dnsService.createSPF(domain.name, content, domain.provider);
        break;
      case 'dkim':
        const selector = req.body.selector || 'default';
        result = await dnsService.createDKIM(domain.name, selector, content, domain.provider);
        break;
      case 'dmarc':
        result = await dnsService.createDMARC(domain.name, content, domain.provider);
        break;
      default:
        return res.status(400).json({ error: 'Invalid record type' });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
