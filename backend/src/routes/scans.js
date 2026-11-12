const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');
const { DNSService } = require('../services/dnsProviders');
const { captureException } = require('../capture');

// Run scan on domain
router.post('/run/:domainId', async (req, res) => {
  const db = getDatabase();
  const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(req.params.domainId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  const dnsService = new DNSService(domain.provider);
  
  try {
    const [spf, dkim, dmarc] = await Promise.all([
      dnsService.checkSPF(domain.name),
      dnsService.checkDKIM(domain.name),
      dnsService.checkDMARC(domain.name)
    ]);
    
    const score = dnsService.calculateHealthScore(spf, dkim, dmarc);
    
    // Save scan result
    const stmt = db.prepare(`
      INSERT INTO scans (domain_id, score, spf_status, dkim_status, dmarc_status, 
        spf_record, dkim_selectors, dmarc_record, issues)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const issues = [
      ...(spf.found ? [] : ['SPF not found']),
      ...(dkim.found ? [] : ['DKIM not found']),
      ...(dmarc.found && dmarc.policy === 'none' ? ['DMARC policy is none'] : [])
    ];
    
    const result = stmt.run(
      domain.id,
      score,
      spf.status,
      dkim.status,
      dmarc.status,
      JSON.stringify(spf),
      JSON.stringify(dkim.selectors),
      JSON.stringify(dmarc),
      JSON.stringify(issues)
    );
    
    res.json({
      success: true,
      scan_id: result.lastInsertRowid,
      score,
      spf,
      dkim,
      dmarc,
      issues
    });
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: error.message });
  }
});

// Get scan history for domain
router.get('/history/:domainId', (req, res) => {
  const db = getDatabase();
  const scans = db.prepare(`
    SELECT * FROM scans WHERE domain_id = ? ORDER BY scanned_at DESC LIMIT 50
  `).all(req.params.domainId);
  
  res.json(scans);
});

// Auto-fix issues
router.post('/fix/:domainId', async (req, res) => {
  const db = getDatabase();
  const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(req.params.domainId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  const { record_type, content } = req.body;
  const dnsService = new DNSService(domain.provider);
  const providerConfig = JSON.parse(domain.provider_config || '{}');
  
  try {
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
    captureException(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;