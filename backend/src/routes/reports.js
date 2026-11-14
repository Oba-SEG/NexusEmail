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
      csv += `${csvField(d.name)},${csvField(d.provider || 'Manual')},${csvField(d.last_score || '')},${csvField(d.last_scan || '')},${csvField(d.verified ? 'Yes' : 'No')},${csvField(results.spf?.status || 'N/A')},${csvField(results.dkim?.status || 'N/A')},${csvField(results.dmarc?.status || 'N/A')}\n`;
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

function generateReportHtml(domain, scans, issues) {
  const latestScan = scans[0];
  const results = latestScan?.results ? JSON.parse(latestScan.results) : {};
  
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
    <div class="score">${domain.last_score || 'N/A'}</div>
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
      <tr><td>SPF</td><td class="${results.spf?.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(results.spf?.status || 'Not checked')}</td><td>${escapeHtml(results.spf?.record || 'No record')}</td></tr>
      <tr><td>DKIM</td><td class="${results.dkim?.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(results.dkim?.status || 'Not checked')}</td><td>${escapeHtml(results.dkim?.selector || 'No record')}</td></tr>
      <tr><td>DMARC</td><td class="${results.dmarc?.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(results.dmarc?.status || 'Not checked')}</td><td>${escapeHtml(results.dmarc?.policy || 'No policy')}</td></tr>
      <tr><td>MTA-STS</td><td class="${results.mta_sts?.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(results.mta_sts?.status || 'Not checked')}</td><td>${escapeHtml(results.mta_sts?.mode || 'N/A')}</td></tr>
      <tr><td>TLS-RPT</td><td class="${results.tls_rpt?.status === 'pass' ? 'pass' : 'fail'}">${escapeHtml(results.tls_rpt?.status || 'Not checked')}</td><td>${escapeHtml(results.tls_rpt?.reportUri || 'No reporting')}</td></tr>
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