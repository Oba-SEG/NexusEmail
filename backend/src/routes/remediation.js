const express = require('express');
const router = express.Router();
const dns = require('dns').promises;
const db = require('../db/database');
const { captureException } = require('../capture');

async function getMXRecords(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.sort((a, b) => a.priority - b.priority).map(r => ({ host: r.exchange, priority: r.priority }));
  } catch (e) {
    captureException(e);
    return [];
  }
}

async function getNSRecords(domain) {
  try {
    const ns = await dns.resolveNs(domain);
    return ns;
  } catch (e) {
    captureException(e);
    return [];
  }
}

async function detectEmailProvider(mxRecords) {
  if (!mxRecords.length) return { provider: 'Unknown', supported: false };
  
  const mx = mxRecords[0].host.toLowerCase();
  const providers = [
    { name: 'Google Workspace', patterns: ['google.com', 'googlemail.com', 'aspmx.l.google.com'] },
    { name: 'Microsoft 365', patterns: ['outlook.com', 'office365.com', 'protection.outlook.com', 'mail.protection.outlook.com'] },
    { name: 'Yahoo', patterns: ['yahoo.com', 'yahoodns.net'] },
    { name: 'Amazon SES', patterns: ['amazonses.com', 'amazon.com'] },
    { name: 'Mailgun', patterns: ['mailgun.org', 'mailgun.net'] },
    { name: 'SendGrid', patterns: ['sendgrid.net', 'twilio.com'] },
    { name: 'Zoho', patterns: ['zohomail.com', 'zoho.com'] },
    { name: 'Cloudflare', patterns: ['cloudflare.com', 'mx.cloudflare.com'] },
    { name: 'Namecheap', patterns: ['namecheap.com', 'efwsmail.com'] },
    { name: 'GoDaddy', patterns: ['godaddy.com', 'secureserver.net'] },
  ];

  for (const p of providers) {
    if (p.patterns.some(pattern => mx.includes(pattern))) {
      return { provider: p.name, supported: true };
    }
  }
  
  return { provider: 'Unknown', supported: false };
}

function generateSPFRecord(domain) {
  return `v=spf1 include:_spf.${domain} ~all`;
}

function generateDKIMRecord(selector) {
  return {
    name: `${selector}._domainkey`,
    type: 'TXT',
    content: `v=DKIM1; k=rsa; p=;`
  };
}

function generateDMARCRecord() {
  return {
    name: '_dmarc',
    type: 'TXT',
    content: 'v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@domain.com'
  };
}

function generateMTASTSRecord() {
  return {
    name: '_mta-sts',
    type: 'TXT',
    content: 'v=STSv1; id=1'
  };
}

function generateTLSRPTRecord() {
  return {
    name: '_smtp._tls',
    type: 'TXT',
    content: 'v=TLSRPTv1; rua=mailto:tls-reports@domain.com'
  };
}

router.post('/:id/analyze-fix', async (req, res, next) => {
  try {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });

  try {
    // Get current DNS records
    const [mxRecords, nsRecords] = await Promise.all([
      getMXRecords(domain.name),
      getNSRecords(domain.name)
    ]);

    // Detect email provider
    const emailProvider = await detectEmailProvider(mxRecords);

    // Get current scan results
    const latestScan = await db.getLatestScan(domain.id, req.orgId);
    const issues = db.parseField(latestScan?.issues, []);
    const spfRecord = latestScan ? JSON.parse(latestScan.spf_record || '{}') : {};
    const dkimSelectors = latestScan ? JSON.parse(latestScan.dkim_selectors || '[]') : [];
    const dmarcRecord = latestScan ? JSON.parse(latestScan.dmarc_record || '{}') : {};

    // Generate recommended records
    const recommendedRecords = {
      spf: {
        name: '@',
        type: 'TXT',
        current: spfRecord.record || null,
        recommended: generateSPFRecord(domain.name),
        editable: true
      },
      dkim: dkimSelectors.length === 0 ? {
        name: 'default._domainkey',
        type: 'TXT',
        current: null,
        recommended: 'v=DKIM1; k=rsa; p=[YOUR_PUBLIC_KEY]',
        editable: true,
        note: 'Generate a DKIM key pair and add the public key here'
      } : {
        name: 'default._domainkey',
        type: 'TXT',
        current: 'Found',
        recommended: 'Keep existing or rotate if needed',
        editable: false
      },
      dmarc: {
        name: '_dmarc',
        type: 'TXT',
        current: dmarcRecord.policy || null,
        recommended: 'v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@' + domain.name,
        editable: true
      },
      mta_sts: {
        name: '_mta-sts',
        type: 'TXT',
        current: null,
        recommended: 'v=STSv1; id=1',
        editable: true
      },
      tls_rpt: {
        name: '_smtp._tls',
        type: 'TXT',
        current: null,
        recommended: 'v=TLSRPTv1; rua=mailto:tls-reports@' + domain.name,
        editable: true
      }
    };

    res.json({
      domain: domain.name,
      email_provider: emailProvider,
      mx_records: mxRecords,
      ns_records: nsRecords.slice(0, 5),
      issues: issues,
      recommended_records: recommendedRecords,
      auto_fix_supported: emailProvider.supported,
      instructions: emailProvider.supported 
        ? `Configure DNS records at your domain registrar. Provider: ${emailProvider.provider}`
        : 'Manual DNS configuration required. Check with your domain provider.'
    });
  } catch (error) {
    captureException(error);
    res.status(500).json({ error: error.message });
  }
  } catch (err) { next(err); }
});

router.post('/:id/apply-fix', async (req, res, next) => {
  try {
  const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
  if (!domain) return res.status(404).json({ error: 'Domain not found' });

  const { records, manual_verification } = req.body;
  
  // Get stored provider credentials
  const allCredentials = JSON.parse(await db.getSetting('provider_credentials', req.orgId) || '{}');
  const providerCredentials = allCredentials[domain.provider.toLowerCase()];

  if (!providerCredentials || !providerCredentials.api_key) {
    return res.status(400).json({ 
      error: 'No provider credentials configured',
      requires_manual: true,
      message: 'Configure provider credentials in Settings to enable auto-fix'
    });
  }

  // For now, return what would be applied since we don't have actual provider integration
  res.json({
    success: true,
    domain: domain.name,
    provider: domain.provider,
    records_to_apply: records || {},
    manual_verification_required: !domain.provider_credentials?.api_key,
    message: 'Auto-fix requires provider API integration. Records generated for manual review.'
  });
  } catch (err) { next(err); }
});

module.exports = router;