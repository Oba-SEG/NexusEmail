const express = require('express');
const router = express.Router();

const db = require('../db/database');
const { captureException } = require('../capture');
const {
  csvField,
  normalizeDnsResults,
  passClass,
  spfPassClass,
  dmarcPassClass,
  distinctIssues,
  buildDomainReport,
  signShareToken,
  verifyShareToken,
  SHARE_TTL_DEFAULT_DAYS,
  SHARE_TTL_MAX_DAYS,
} = require('../services/reportBuilder');

function shareSecret() {
  const secret = process.env.REPORT_SHARE_SECRET || process.env.JWT_SECRET || process.env.NEXUSEMAIL_JWT_SECRET;
  if (!secret) throw new Error('REPORT_SHARE_SECRET or JWT_SECRET must be set to enable report sharing');
  return secret;
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
}

function parseRangeDays(value, fallback = 30) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(n, 365));
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function inRange(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

function reportMeta(report) {
  if (!report) return null;
  return {
    id: report.id,
    domain_id: report.domain_id,
    domain_name: report.domain_name,
    range_days: report.range_days,
    score: report.score,
    issue_counts: report.issue_counts || null,
    generated_at: report.generated_at,
  };
}

// Legacy on-the-fly report used by older clients. New clients call
// POST /generate so the report is persisted and shareable.
router.get('/domains/:id/report', async (req, res) => {
  try {
    const domain = await db.getDomain(parseInt(req.params.id), req.orgId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const rangeDays = parseRangeDays(req.query.range_days, 30);
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    const scans = (await db.getScans(domain.id, 100, req.orgId))
      .filter((s) => inRange(s.scanned_at, new Date(cutoff).toISOString(), null));
    const dmarcReports = await db.getDmarcReports(domain.id, req.orgId, 30);
    const report = buildDomainReport({ domain, scans, dmarcReports, rangeDays, appBaseUrl: appBaseUrl() });
    res.type('html').send(report.html);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Generate + persist a single-domain report.
router.post('/generate', async (req, res) => {
  try {
    const domainId = Number(req.body?.domain_id);
    if (!Number.isFinite(domainId)) return res.status(400).json({ error: 'domain_id is required' });
    const domain = await db.getDomain(domainId, req.orgId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const rangeDays = parseRangeDays(req.body?.range_days, 30);
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    const scans = (await db.getScans(domain.id, 100, req.orgId))
      .filter((s) => inRange(s.scanned_at, new Date(cutoff).toISOString(), null));
    const dmarcReports = await db.getDmarcReports(domain.id, req.orgId, 30);
    const built = buildDomainReport({ domain, scans, dmarcReports, rangeDays, appBaseUrl: appBaseUrl() });

    const stored = await db.addReport({
      domain_id: domain.id,
      domain_name: domain.name,
      range_days: rangeDays,
      score: built.score,
      issue_counts: built.issueCounts,
      trend: built.trend,
      html: built.html,
    }, req.orgId);

    res.json({ ...reportMeta(stored), html: built.html });
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// History — metadata only, newest first.
router.get('/', async (req, res) => {
  try {
    const reports = await db.getReports(null, req.orgId);
    res.json(reports.slice(0, 50).map(reportMeta));
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Scoped CSV export: one row per scan, per selected domain, inside a range.
router.get('/export/csv', async (req, res) => {
  try {
    const all = await db.getDomains(req.orgId);
    const wanted = req.query.domains
      ? new Set(String(req.query.domains).split(',').map((v) => Number(v.trim())).filter(Number.isFinite))
      : null;
    const domains = wanted ? all.filter((d) => wanted.has(d.id)) : all;

    const to = isoOrNull(req.query.to) || new Date().toISOString();
    const from = isoOrNull(req.query.from) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let csv = [
      'Domain', 'Provider', 'Verified', 'Score', 'Scanned At',
      'SPF Status', 'SPF Policy', 'SPF Record',
      'DKIM Status', 'DKIM Selectors',
      'DMARC Status', 'DMARC Policy', 'DMARC Record',
      'MTA-STS Status', 'MTA-STS Mode',
      'TLS-RPT Status', 'TLS-RPT Reporting',
      'Issue Count',
    ].join(',') + '\n';

    let rows = 0;
    for (const domain of domains) {
      const scans = await db.getScansInRange(domain.id, req.orgId, from, to, 500);
      for (const scan of scans) {
        if (rows >= 10000) break;
        const n = normalizeDnsResults(scan);
        csv += [
          csvField(domain.name),
          csvField(domain.provider || 'Manual'),
          csvField(domain.verified ? 'Yes' : 'No'),
          csvField(scan.score ?? ''),
          csvField(scan.scanned_at ?? ''),
          csvField(n.spf?.status || 'N/A'),
          csvField(n.spf?.policy || ''),
          csvField(n.spf?.record || ''),
          csvField(n.dkim?.status || 'N/A'),
          csvField(n.dkim?.selector || ''),
          csvField(n.dmarc?.status || 'N/A'),
          csvField(n.dmarc?.policy || ''),
          csvField(n.dmarc?.record || ''),
          csvField(n.mta_sts?.status || 'N/A'),
          csvField(n.mta_sts?.mode || ''),
          csvField(n.tls_rpt?.status || 'N/A'),
          csvField(n.tls_rpt?.reporting || ''),
          csvField(distinctIssues(scan).length),
        ].join(',') + '\n';
        rows += 1;
      }
      if (rows >= 10000) break;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=nexusemail-records-${to.slice(0, 10)}.csv`);
    res.send(csv);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Scoped JSON export: domain metadata plus the raw scan payloads in range.
router.get('/export/json', async (req, res) => {
  try {
    const all = await db.getDomains(req.orgId);
    const wanted = req.query.domains
      ? new Set(String(req.query.domains).split(',').map((v) => Number(v.trim())).filter(Number.isFinite))
      : null;
    const domains = wanted ? all.filter((d) => wanted.has(d.id)) : all;

    const to = isoOrNull(req.query.to) || new Date().toISOString();
    const from = isoOrNull(req.query.from) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const payload = {
      exported_at: new Date().toISOString(),
      range: { from, to },
      domains: [],
    };

    for (const domain of domains) {
      const scans = await db.getScansInRange(domain.id, req.orgId, from, to, 500);
      const latest = scans[scans.length - 1] || null;
      payload.domains.push({
        id: domain.id,
        name: domain.name,
        provider: domain.provider || 'Manual',
        verified: !!domain.verified,
        latest_score: latest?.score ?? null,
        latest_records: latest ? normalizeDnsResults(latest) : null,
        scans,
      });
    }

    res.setHeader('Content-Disposition', `attachment; filename=nexusemail-export-${to.slice(0, 10)}.json`);
    res.json(payload);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

function storedReportId(req) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Single stored report (org-scoped), including the HTML for in-tab preview.
router.get('/:id', async (req, res) => {
  try {
    const id = storedReportId(req);
    if (!id) return res.status(404).json({ error: 'Report not found' });
    const report = await db.getReportById(id, req.orgId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const id = storedReportId(req);
    if (!id) return res.status(404).json({ error: 'Report not found' });
    const report = await db.getReportById(id, req.orgId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const safeName = String(report.domain_name || 'domain').replace(/[^a-zA-Z0-9.-]+/g, '-');
    const date = String(report.generated_at || new Date().toISOString()).slice(0, 10);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=nexus-report-${safeName}-${date}.html`);
    res.send(report.html);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Expiring, signed share link. The public route lives in index.js.
router.post('/:id/share', async (req, res) => {
  try {
    const id = storedReportId(req);
    if (!id) return res.status(404).json({ error: 'Report not found' });
    const report = await db.getReportById(id, req.orgId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const days = Math.max(1, Math.min(Number.parseInt(req.body?.expires_days, 10) || SHARE_TTL_DEFAULT_DAYS, SHARE_TTL_MAX_DAYS));
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    const token = signShareToken(report.id, expiresAt, shareSecret());
    res.json({ token, expires_at: new Date(expiresAt).toISOString(), path: `/api/reports/shared/${token}` });
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = storedReportId(req);
    if (!id) return res.status(404).json({ error: 'Report not found' });
    const report = await db.getReportById(id, req.orgId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    await db.deleteReport(report.id, req.orgId);
    res.json({ success: true });
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Public, signature-checked report view. Mounted before requireAuth in
// index.js so stakeholders can open a shared link without a console account.
async function getSharedReport(req, res) {
  try {
    const verified = verifyShareToken(req.params.token, shareSecret());
    if (!verified) return res.status(404).json({ error: 'Report not found or link expired' });
    const report = await db.getReportById(verified.reportId);
    if (!report) return res.status(404).json({ error: 'Report not found or link expired' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(report.html);
  } catch (e) {
    captureException(e);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = router;
module.exports.getSharedReport = getSharedReport;
// Backwards-compatible exports for backend/test/reports-normalize.test.js.
module.exports.normalizeDnsResults = normalizeDnsResults;
module.exports.passClass = passClass;
module.exports.spfPassClass = spfPassClass;
module.exports.dmarcPassClass = dmarcPassClass;
