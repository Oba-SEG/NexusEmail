const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const db = require('../db/database');
const { captureException } = require('../capture');
const { escapeHtml } = require('../utils/html');

// Ensure reports directory exists
const reportsDir = path.join(__dirname, '../../data/reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Generate single domain HTML report
router.get('/domains/:id/report', async (req, res) => {
  try {
    const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const scans = await db.getScans(domain.id, 30, req.orgId) || [];
    const issues = { high: 0, medium: 0, low: 0 };
    scans.forEach(scan => {
      if (scan.issues) {
        try {
          JSON.parse(scan.issues).forEach(issue => {
            if (issue.severity === 'high') issues.high++;
            else if (issue.severity === 'medium') issues.medium++;
            else issues.low++;
          });
        } catch (e) {}
      }
    });

    const html = generateReportHtml(domain, scans, issues);
    res.type('html').send(html);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// CSV field sanitizer: (1) neutralize spreadsheet formula injection — a
// value beginning with = + - @ tab or CR is a formula in
// Excel/LibreOffice/Sheets, prefixing with ' forces text interpretation;
// (2) RFC 4180 quoting — embedded commas/newlines would otherwise split
// cells/rows and a split could re-expose a formula-leading cell.
function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Export all domains as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const domains = await db.getDomains(req.orgId);
    let csv = 'Domain,Provider,Score,Last Scan,Verified,SPF,DKIM,DMARC\n';

    for (const d of domains) {
      const scan = await db.getLatestScan(d.id, req.orgId);
      const results = scan?.results ? JSON.parse(scan.results) : {};
      // ?? not ||: a real score of 0 must survive (|| would coerce it to '')
      csv += `${csvField(d.name)},${csvField(d.provider || 'Manual')},${csvField(scan?.score ?? '')},${csvField(scan?.scanned_at ?? '')},${csvField(d.verified ? 'Yes' : 'No')},${csvField(results.spf?.status || 'N/A')},${csvField(results.dkim?.status || 'N/A')},${csvField(results.dmarc?.status || 'N/A')}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=nexusemail-domains.csv');
    res.send(csv);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Export all domains as JSON
router.get('/export/json', async (req, res) => {
  try {
    const domains = await db.getDomains(req.orgId);
    res.json(domains);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Scan rows exist in two storage shapes: the audit routes
// (domains.js bulk-scan /:id/scan) store flat *_status fields plus
// *_record JSON strings of the audit objects, while the scheduler and
// the /scans/run route store spf/dkim/dmarc objects (mirrored as JSON
// strings). hydrateScan adds no `results` field — normalize both
// shapes into what the report table reads.
function normalizeDnsResults(scan) {
  if (!scan) return {};
  const parse = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return null; }
  };
  const deriveStatus = (obj, flat) => {
    if (flat && flat !== 'UNKNOWN') return flat;
    if (obj?.status) return obj.status;
    if (obj == null) return flat || null;
    // Validation errors beat found:true — an SPF record with +all or a
    // DMARC p=none row is found but failing, and must not render green.
    if (obj.error || (Array.isArray(obj.errors) && obj.errors.length)) return 'ERROR';
    if (obj.found) return 'FOUND';
    return 'NOT_FOUND';
  };
  const present = (obj, ...flatKeys) => !!(obj || flatKeys.some(k => scan[k] != null));
  const spf = parse(scan.spf) || parse(scan.spf_record);
  const dkim = parse(scan.dkim);
  const dmarc = parse(scan.dmarc) || parse(scan.dmarc_record);
  const selectors = parse(scan.dkim_selectors) || dkim?.selectors || [];
  const selectorNames = selectors
    .map(s => (typeof s === 'string' ? s : s?.selector))
    .filter(Boolean)
    .join(', ');
  return {
    spf: present(spf, 'spf_status', 'spf_record')
      ? { status: deriveStatus(spf, scan.spf_status), record: spf?.record || spf?.error || (spf?.errors || [])[0] }
      : null,
    dkim: present(dkim, 'dkim_status', 'dkim_selectors')
      ? {
        status: dkim
          ? deriveStatus(dkim, scan.dkim_status)
          : (scan.dkim_status && scan.dkim_status !== 'UNKNOWN'
            ? scan.dkim_status
            : selectors.length ? 'FOUND' : 'NOT_FOUND'),
        selector: selectorNames
      }
      : null,
    dmarc: present(dmarc, 'dmarc_status', 'dmarc_record')
      ? { status: deriveStatus(dmarc, scan.dmarc_status), policy: dmarc?.policy || dmarc?.error || (dmarc?.errors || [])[0] }
      : null
  };
}

function passClass(status) {
  return status === 'pass' || status === 'FOUND' ? 'pass' : 'fail';
}

function generateReportHtml(domain, scans, issues) {
  // getScans returns oldest-first (DESC query then .reverse()), so the
  // newest scan is the last element.
  const latestScan = scans[scans.length - 1];
  const results = normalizeDnsResults(latestScan);
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>NexusEmail Report - ${escapeHtml(domain.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .score { font-size: 48px; font-weight: bold; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .issues { display: flex; gap: 20px; margin-top: 10px; }
    .issue { padding: 8px 16px; border-radius: 4px; }
    .issue.high { background: #fee2e2; color: #dc2626; }
    .issue.medium { background: #fef3c7; color: #d97706; }
    .issue.low { background: #dbeafe; color: #2563eb; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
    .pass { color: #16a34a; }
    .fail { color: #dc2626; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔒 NexusEmail Security Report</h1>
    <p>Domain: <strong>${escapeHtml(domain.name)}</strong></p>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <div class="score">${latestScan?.score ?? 'N/A'}</div>
  </div>
  
  <div class="card">
    <h3>Security Score</h3>
    <div class="issues">
      <div class="issue high">🔴 ${issues.high} High</div>
      <div class="issue medium">🟡 ${issues.medium} Medium</div>
      <div class="issue low">🔵 ${issues.low} Low</div>
    </div>
  </div>
  
  <div class="card">
    <h3>DNS Records</h3>
    <table>
      <tr><th>Record</th><th>Status</th><th>Details</th></tr>
      <tr><td>SPF</td><td class="${passClass(results.spf?.status)}">${escapeHtml(results.spf?.status || 'Not checked')}</td><td>${escapeHtml(results.spf?.record || 'No record')}</td></tr>
      <tr><td>DKIM</td><td class="${passClass(results.dkim?.status)}">${escapeHtml(results.dkim?.status || 'Not checked')}</td><td>${escapeHtml(results.dkim?.selector || 'No record')}</td></tr>
      <tr><td>DMARC</td><td class="${passClass(results.dmarc?.status)}">${escapeHtml(results.dmarc?.status || 'Not checked')}</td><td>${escapeHtml(results.dmarc?.policy || 'No policy')}</td></tr>
      <tr><td>MTA-STS</td><td class="${passClass(results.mta_sts?.status)}">${escapeHtml(results.mta_sts?.status || 'Not checked')}</td><td>${escapeHtml(results.mta_sts?.mode || 'N/A')}</td></tr>
      <tr><td>TLS-RPT</td><td class="${passClass(results.tls_rpt?.status)}">${escapeHtml(results.tls_rpt?.status || 'Not checked')}</td><td>${escapeHtml(results.tls_rpt?.reportUri || 'No reporting')}</td></tr>
    </table>
  </div>
  
  <div class="card">
    <h3>Issues Found</h3>
    ${db.parseField(latestScan?.issues, []).map(i => `<p><strong>${escapeHtml(i.type)}:</strong> ${escapeHtml(i.message)}</p>`).join('') || '<p>No issues found</p>'}
  </div>
  
  <p style="color: #6b7280; font-size: 12px;">Generated by NexusEmail - Email Security Auditing Platform</p>
</body>
</html>`;
}

module.exports = router;