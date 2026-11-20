/**
 * Report builder — one place that turns stored scans into shareable output.
 *
 * Used by the reports routes (single-domain HTML reports) and by the
 * scheduler (portfolio digest e-mails). Pure helpers are exported for the
 * regression tests in backend/test/reports-builder.test.js.
 */
const crypto = require('crypto');
const { escapeHtml } = require('../utils/html');

const PASSING_SCORE = 80;
const WARNING_SCORE = 50;
const SHARE_TTL_DEFAULT_DAYS = 7;
const SHARE_TTL_MAX_DAYS = 30;
const SCHEDULE_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function parse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function band(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'unknown';
  if (score >= PASSING_SCORE) return 'passing';
  if (score >= WARNING_SCORE) return 'warnings';
  return 'failed';
}

function bandLabel(b) {
  return b === 'passing' ? 'Healthy' : b === 'warnings' ? 'Needs attention' : b === 'failed' ? 'Action required' : 'Not scanned';
}

function toneColor(b) {
  return b === 'passing' ? '#15803d' : b === 'warnings' ? '#b45309' : b === 'failed' ? '#b91c1c' : '#57534e';
}

function toneBg(b) {
  return b === 'passing' ? '#f0fdf4' : b === 'warnings' ? '#fffbeb' : b === 'failed' ? '#fef2f2' : '#fafaf9';
}

// CSVs are opened in spreadsheets: a value starting with = + - @ tab or CR
// is a formula there. Prefix with ' and quote per RFC 4180.
function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function deriveStatus(obj, flat) {
  if (flat && flat !== 'UNKNOWN') return flat;
  if (obj?.status) return obj.status;
  if (obj == null) return flat || null;
  if (obj.error || (Array.isArray(obj.errors) && obj.errors.length)) {
    const msgs = [obj.error, ...(Array.isArray(obj.errors) ? obj.errors : [])]
      .filter(Boolean).join(' ');
    if (!obj.found && /ENOTFOUND|NXDOMAIN|No (?:SPF|DMARC) record found/i.test(msgs)) return 'NOT_FOUND';
    return 'ERROR';
  }
  if (obj.found) return 'FOUND';
  return 'NOT_FOUND';
}

/**
 * Scan rows exist in two storage shapes: the audit routes store flat
 * *_status plus *_record JSON strings; the scheduler stores objects
 * directly. Normalise both, including MTA-STS and TLS-RPT (a previous
 * version dropped them, so reports always said "Not checked").
 */
function normalizeDnsResults(scan) {
  if (!scan) return {};
  const breakdown = parse(scan.score_breakdown, null);
  // A persisted "null" (or blank) is absence of data, not a negative lookup:
  // only decoded evidence or a numeric score-breakdown value counts.
  const present = (obj, ...flatKeys) => !!obj || flatKeys.some((k) => {
    const value = scan[k];
    if (value == null) return false;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return false;
    }
    return true;
  });

  const spf = parse(scan.spf, null) || parse(scan.spf_record, null);
  const dkim = parse(scan.dkim, null);
  const dmarc = parse(scan.dmarc, null) || parse(scan.dmarc_record, null);
  const mta = parse(scan.mta_sts, null) || parse(scan.mta_sts_record, null);
  const tls = parse(scan.tls_rpt, null) || parse(scan.tls_rpt_record, null);
  const selectors = parse(scan.dkim_selectors, null) || dkim?.selectors || [];
  const selectorNames = (Array.isArray(selectors) ? selectors : [])
    .map((s) => (typeof s === 'string' ? s : s?.selector))
    .filter(Boolean)
    .join(', ');

  return {
    spf: present(spf, 'spf_status', 'spf_record')
      ? {
        status: deriveStatus(spf, scan.spf_status),
        record: spf?.record || spf?.error || (spf?.errors || [])[0] || null,
        policy: spf?.policy ?? null,
      }
      : null,
    dkim: present(dkim, 'dkim_status', 'dkim_selectors')
      ? {
        status: dkim
          ? deriveStatus(dkim, scan.dkim_status)
          : (scan.dkim_status && scan.dkim_status !== 'UNKNOWN'
            ? scan.dkim_status
            : selectors.length ? 'FOUND' : 'NOT_FOUND'),
        selector: selectorNames || null,
        selectors: Array.isArray(selectors) ? selectors : [],
      }
      : null,
    dmarc: present(dmarc, 'dmarc_status', 'dmarc_record')
      ? {
        status: deriveStatus(dmarc, scan.dmarc_status),
        record: dmarc?.record || dmarc?.error || (dmarc?.errors || [])[0] || null,
        policy: dmarc?.policy || dmarc?.error || (dmarc?.errors || [])[0] || null,
      }
      : null,
    mta_sts: present(mta, 'mta_sts_record')
      ? {
        status: mta ? deriveStatus(mta, null) : (breakdown?.mta_sts > 0 ? 'FOUND' : 'NOT_FOUND'),
        mode: mta?.mode || null,
        maxAge: mta?.maxAge ?? null,
        record: mta?.record || null,
      }
      : (breakdown && typeof breakdown.mta_sts === 'number'
        ? { status: breakdown.mta_sts > 0 ? 'FOUND' : 'NOT_FOUND', mode: null, maxAge: null, record: null }
        : null),
    tls_rpt: present(tls, 'tls_rpt_record')
      ? {
        status: tls ? deriveStatus(tls, null) : (breakdown?.tls_rpt > 0 ? 'FOUND' : 'NOT_FOUND'),
        reporting: (tls?.reporting && (tls.reporting.rua?.join?.(', ') || tls.reporting.join?.(', ')))
          || tls?.record || null,
      }
      : (breakdown && typeof breakdown.tls_rpt === 'number'
        ? { status: breakdown.tls_rpt > 0 ? 'FOUND' : 'NOT_FOUND', reporting: null }
        : null),
  };
}

function passClass(status) {
  return status === 'pass' || status === 'FOUND' ? 'pass' : 'fail';
}

function spfPassClass(spf) {
  if (!spf || passClass(spf.status) !== 'pass') return 'fail';
  return spf.policy === 'hardfail' || spf.policy === 'softfail' ? 'pass' : 'fail';
}

function dmarcPassClass(dmarc) {
  if (!dmarc || passClass(dmarc.status) !== 'pass') return 'fail';
  return dmarc.policy === 'reject' || dmarc.policy === 'quarantine' ? 'pass' : 'fail';
}

/** Distinct issues from one scan: persistence across scans must not
 * multiply the same finding. Also accepts the stored JSON string. */
function distinctIssues(scan) {
  const raw = Array.isArray(scan?.issues) ? scan.issues : parse(scan?.issues, []);
  const seen = new Set();
  const out = [];
  for (const issue of Array.isArray(raw) ? raw : []) {
    const type = String(issue?.type || 'Issue');
    const message = String(issue?.message || '');
    const key = `${type}|${message}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, message, severity: String(issue?.severity || 'low') });
  }
  const rank = (s) => (s === 'high' ? 0 : s === 'medium' ? 1 : 2);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

function scoreTrend(scans) {
  return (Array.isArray(scans) ? scans : [])
    .filter((s) => typeof s?.score === 'number' && !Number.isNaN(s.score))
    .map((s) => ({ at: s.scanned_at || null, score: s.score }));
}

function recommendationsFor(scan) {
  const raw = Array.isArray(scan?.recommendations) ? scan.recommendations : parse(scan?.recommendations, []);
  return Array.isArray(raw) ? raw.filter((r) => r && r.action) : [];
}

function statusText(status) {
  switch (String(status || '').toUpperCase()) {
    case 'FOUND': return 'Found';
    case 'NOT_FOUND': return 'Missing';
    case 'ERROR': return 'Lookup error';
    case 'PASS': return 'Pass';
    case 'FAIL': return 'Fail';
    default: return status ? String(status) : 'Not checked';
  }
}

function statusTone(status, policy) {
  const s = String(status || '').toUpperCase();
  if (s !== 'FOUND' && s !== 'PASS') return '#b91c1c';
  if (policy === 'none' || policy === 'neutral' || policy === 'testing') return '#b45309';
  return '#15803d';
}

/** SPF/DMARC only count as green when the policy actually enforces:
 * a FOUND record with no policy is a warning, not a pass. */
function recordTone(kind, node) {
  const pass = kind === 'SPF' ? spfPassClass(node) : kind === 'DMARC' ? dmarcPassClass(node) : null;
  if (pass == null) return statusTone(node.status, node.policy || node.mode);
  if (pass === 'pass') return '#15803d';
  const status = String(node.status || '').toUpperCase();
  return status === 'FOUND' || status === 'PASS' ? '#b45309' : '#b91c1c';
}

function dmarcSummary(reports) {
  const rows = Array.isArray(reports) ? reports : [];
  const seen = new Map();
  for (const r of rows) {
    const org = r?.report?.orgName || '?';
    const key = r?.report?.reportId ? `id|${org}|${r.report.reportId}` : `fb|${org}|${r?.report?.begin || 0}`;
    if (!seen.has(key) || (r.id ?? 0) > (seen.get(key).id ?? 0)) seen.set(key, r);
  }
  let messages = 0;
  let aligned = 0;
  let begin = null;
  let end = null;
  for (const r of seen.values()) {
    for (const rec of r?.report?.records || []) {
      const count = Number(rec?.count) || 0;
      messages += count;
      if (rec?.spfAligned === true || rec?.dkimAligned === true) aligned += count;
    }
    if (typeof r?.report?.begin === 'number') begin = begin === null ? r.report.begin : Math.min(begin, r.report.begin);
    if (typeof r?.report?.end === 'number') end = end === null ? r.report.end : Math.max(end, r.report.end);
  }
  return {
    reports: seen.size,
    messages,
    aligned,
    failed: Math.max(0, messages - aligned),
    begin,
    end,
  };
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDay(ms) {
  if (typeof ms !== 'number') return '—';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const REPORT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 20px; background: #f5f4f2; color: #1c1917;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .sheet { max-width: 880px; margin: 0 auto; background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; padding: 40px 44px; }
  .eyebrow { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #a8a29e; }
  h1 { margin: 0; font-size: 30px; line-height: 1.15; letter-spacing: -0.02em; }
  .meta { margin: 8px 0 0; color: #78716c; font-size: 12.5px; }
  .hero { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 18px 28px; margin: 26px 0 30px; padding: 20px 22px; border: 1px solid #e7e5e4; border-radius: 8px; background: #fafaf9; }
  .score { font-size: 46px; line-height: 1; font-weight: 650; letter-spacing: -0.03em; }
  .score span { font-size: 16px; font-weight: 500; color: #a8a29e; letter-spacing: 0; }
  .verdict { font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
  .hero .note { margin-left: auto; max-width: 380px; color: #57534e; font-size: 12.5px; }
  h2 { margin: 34px 0 10px; padding-top: 18px; border-top: 1px solid #e7e5e4; font-size: 15px; letter-spacing: -0.01em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #a8a29e; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; }
  td { padding: 10px; border-bottom: 1px solid #f0efed; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .mono { font-family: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .muted { color: #78716c; }
  .status { font-weight: 600; white-space: nowrap; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
  .issue { padding: 10px 0; border-bottom: 1px solid #f0efed; }
  .issue:last-child { border-bottom: 0; }
  .issue .sev { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-right: 8px; }
  .rec { padding: 10px 0; border-bottom: 1px solid #f0efed; }
  .rec:last-child { border-bottom: 0; }
  .rec .pri { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #b45309; margin-right: 8px; }
  .rec .cmd { margin: 6px 0 0; padding: 8px 10px; background: #fafaf9; border: 1px solid #f0efed; border-radius: 6px; }
  .trend { display: flex; align-items: flex-end; gap: 3px; height: 64px; margin: 12px 0 4px; }
  .trend i { flex: 1 1 0; min-width: 4px; border-radius: 2px 2px 0 0; background: #d6d3d1; }
  .trend i.ok { background: #86efac; }
  .trend i.warn { background: #fcd34d; }
  .trend i.bad { background: #fca5a5; }
  .trend-labels { display: flex; justify-content: space-between; font-size: 11px; color: #a8a29e; }
  .empty { color: #78716c; font-size: 12.5px; margin: 8px 0 0; }
  .footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e7e5e4; color: #a8a29e; font-size: 11.5px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; padding: 0; max-width: none; } }
`;

function recordRow(label, node, extra) {
  if (!node) {
    return `<tr><td>${escapeHtml(label)}</td><td class="status" style="color:#78716c"><span class="dot" style="background:#a8a29e"></span>Not checked</td><td class="muted">No scan data</td></tr>`;
  }
  const color = recordTone(label, node);
  const evidence = extra
    ? `<div class="mono">${escapeHtml(extra)}</div>`
    : '<span class="muted">—</span>';
  return `<tr><td>${escapeHtml(label)}</td><td class="status" style="color:${color}"><span class="dot" style="background:${color}"></span>${escapeHtml(statusText(node.status))}</td><td>${evidence}</td></tr>`;
}

function buildDomainReport({
  domain,
  scans,
  dmarcReports = [],
  rangeDays = 30,
  generatedAt = new Date().toISOString(),
  note = '',
  appBaseUrl = '',
}) {
  const allScans = Array.isArray(scans) ? scans : [];
  const latest = allScans[allScans.length - 1] || null;
  const results = normalizeDnsResults(latest);
  const score = typeof latest?.score === 'number' ? latest.score : null;
  const b = band(score);
  const issues = distinctIssues(latest);
  const recommendations = recommendationsFor(latest);
  const trend = scoreTrend(allScans).slice(-30);
  const dmarc = dmarcSummary(dmarcReports);
  const breakdown = parse(latest?.score_breakdown, null);

  const trendBars = trend.map((p) => {
    const pb = band(p.score);
    const cls = pb === 'passing' ? 'ok' : pb === 'warnings' ? 'warn' : 'bad';
    const height = Math.max(4, Math.min(100, p.score));
    const title = `${fmtDate(p.at)} — ${p.score}/100`;
    return `<i class="${cls}" style="height:${height}%" title="${escapeHtml(title)}"></i>`;
  }).join('');
  const trendFlat = trend.length > 1 && trend.every((p) => p.score === trend[0].score);
  const trendHtml = trend.length > 1
    ? `<h2>Score trend</h2>${trendFlat
      ? `<p class="empty">Flat at ${trend[0].score}/100 across the last ${trend.length} scans.</p>`
      : `<div class="trend">${trendBars}</div>
  <div class="trend-labels"><span>${escapeHtml(fmtDay(Date.parse(trend[0].at)))}</span><span>${escapeHtml(fmtDay(Date.parse(trend[trend.length - 1].at)))}</span></div>`}`
    : '';

  const breakdownRows = breakdown
    ? [
      ['SPF', breakdown.spf, breakdown.max?.spf ?? 35],
      ['DKIM', breakdown.dkim, breakdown.max?.dkim ?? 30],
      ['DMARC', breakdown.dmarc, breakdown.max?.dmarc ?? 35],
      ['MTA-STS', breakdown.mta_sts, breakdown.max?.mta_sts ?? 15],
      ['TLS-RPT', breakdown.tls_rpt, breakdown.max?.tls_rpt ?? 5],
    ].map(([label, got, max]) => `<tr><td>${label}</td><td class="mono">${Number(got) || 0} / ${Number(max) || 0}</td></tr>`).join('')
    : '';

  const issuesHtml = issues.length
    ? issues.map((i) => {
      const color = i.severity === 'high' ? '#b91c1c' : i.severity === 'medium' ? '#b45309' : '#1d4ed8';
      return `<div class="issue"><span class="sev" style="color:${color}">${escapeHtml(i.severity)}</span>${escapeHtml(i.type)}: ${escapeHtml(i.message)}</div>`;
    }).join('')
    : typeof score === 'number' && score < 50
      ? `<p class="empty">No structured issues were reported, but the latest scan scored ${score}/100 — check the DNS evidence above.</p>`
      : '<p class="empty">No issues found in the latest scan.</p>';

  const recsHtml = recommendations.length
    ? recommendations.map((r) => `<div class="rec"><span class="pri">${escapeHtml(r.priority || 'fix')}</span>${escapeHtml(r.action)}${r.command ? `<p class="cmd mono">${escapeHtml(r.command)}</p>` : ''}</div>`).join('')
    : '';

  const evidence = [
    ['SPF record', results.spf?.record],
    ['SPF policy', results.spf?.policy],
    ['DKIM selectors', results.dkim?.selector],
    ['DMARC record', results.dmarc?.record],
    ['DMARC policy', results.dmarc?.policy],
    ['MTA-STS mode', results.mta_sts?.mode],
    ['MTA-STS max age', results.mta_sts?.maxAge],
    ['MTA-STS record', results.mta_sts?.record],
    ['TLS-RPT reporting', results.tls_rpt?.reporting],
  ].filter(([, v]) => v != null && v !== '');

  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email authentication report — ${escapeHtml(domain?.name || 'domain')}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main class="sheet">
  <p class="eyebrow">Email authentication report</p>
  <h1>${escapeHtml(domain?.name || 'domain')}</h1>
  <p class="meta">
    ${escapeHtml(domain?.provider || 'Manual provider')}
    &middot; ${domain?.verified ? 'Ownership verified' : 'Ownership not verified'}
    &middot; Generated ${escapeHtml(fmtDate(generatedAt))}
    &middot; ${allScans.length} scan${allScans.length === 1 ? '' : 's'} over ${rangeDays} day${rangeDays === 1 ? '' : 's'}
  </p>

  <div class="hero">
    <div>
      <div class="score" style="color:${toneColor(b)}">${score ?? '—'}<span>/100</span></div>
      <div class="verdict" style="color:${toneColor(b)};background:${toneBg(b)}">${bandLabel(b)}</div>
    </div>
    <p class="note">SPF, DKIM and DMARC posture based on the latest scan${latest?.scanned_at ? ` from ${escapeHtml(fmtDate(latest.scanned_at))}` : ''}.${note ? ` ${escapeHtml(note)}` : ''}</p>
  </div>

  <h2>Authentication records</h2>
  <table>
    <thead><tr><th>Record</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>
      ${recordRow('SPF', results.spf, results.spf?.record)}
      ${recordRow('DKIM', results.dkim, results.dkim?.selector)}
      ${recordRow('DMARC', results.dmarc, results.dmarc?.record)}
      ${recordRow('MTA-STS', results.mta_sts, [results.mta_sts?.mode, results.mta_sts?.record].filter(Boolean).join(' · '))}
      ${recordRow('TLS-RPT', results.tls_rpt, results.tls_rpt?.reporting)}
    </tbody>
  </table>

  ${breakdownRows ? `<h2>Score breakdown</h2>
  <table><tbody>${breakdownRows}</tbody></table>` : ''}

  ${trendHtml}

  ${dmarc.reports > 0 ? `<h2>DMARC aggregate reports</h2>
  <table><tbody>
    <tr><td class="muted">Reports ingested</td><td class="mono">${dmarc.reports}</td></tr>
    <tr><td class="muted">Messages covered</td><td class="mono">${dmarc.messages.toLocaleString('en-GB')}</td></tr>
    <tr><td class="muted">Aligned</td><td class="mono">${dmarc.aligned.toLocaleString('en-GB')}${dmarc.messages ? ` (${Math.round((dmarc.aligned / dmarc.messages) * 100)}%)` : ''}</td></tr>
    <tr><td class="muted">Failed alignment</td><td class="mono">${dmarc.failed.toLocaleString('en-GB')}</td></tr>
    ${dmarc.begin !== null || dmarc.end !== null ? `<tr><td class="muted">Coverage</td><td class="mono">${escapeHtml(fmtDay(dmarc.begin))} – ${escapeHtml(fmtDay(dmarc.end))}</td></tr>` : ''}
  </tbody></table>` : ''}

  <h2>Issues</h2>
  ${issuesHtml}

  ${recsHtml ? `<h2>Recommended fixes</h2>${recsHtml}` : ''}

  <h2>Evidence</h2>
  ${evidence.length
    ? `<table><tbody>${evidence.map(([label, value]) => `<tr><td class="muted" style="width:170px">${escapeHtml(label)}</td><td class="mono">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No DNS evidence captured in the stored scans.</p>'}

  <p class="footer">Generated by NexusEmail${appBaseUrl ? ` &middot; ${escapeHtml(appBaseUrl)}` : ''}. Scores: SPF 35 &middot; DKIM 30 &middot; DMARC 35 &middot; MTA-STS 15 &middot; TLS-RPT 5.</p>
</main>
</body>
</html>`,
    score,
    band: b,
    issueCounts: {
      high: issues.filter((i) => i.severity === 'high').length,
      medium: issues.filter((i) => i.severity === 'medium').length,
      low: issues.filter((i) => i.severity === 'low').length,
    },
    issues,
    trend,
    dmarc,
  };
}

/**
 * Portfolio digest used by the scheduler: an email body (inline styles,
 * table-based) plus a standalone HTML attachment.
 */
function buildPortfolioReport({ orgName, rows, generatedAt = new Date().toISOString(), rangeDays = 30 }) {
  const list = Array.isArray(rows) ? rows : [];
  const scored = list.filter((r) => typeof r.score === 'number');
  const average = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  const atRisk = scored.filter((r) => r.score < WARNING_SCORE).length;

  const tableRows = list.map((r) => {
    const b = band(r.score);
    const color = toneColor(b);
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px">${escapeHtml(r.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;font-weight:600;color:${color};white-space:nowrap">${r.score ?? '—'}${typeof r.score === 'number' ? ' / 100' : ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;white-space:nowrap">${escapeHtml(r.spf || '—')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;white-space:nowrap">${escapeHtml(r.dkim || '—')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;white-space:nowrap">${escapeHtml(r.dmarc || '—')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0efed;color:#78716c;white-space:nowrap">${r.issues ?? 0}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:32px 16px;background:#f5f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917">
<div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:32px 36px">
  <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">Email authentication digest</p>
  <h1 style="margin:0;font-size:24px;letter-spacing:-.02em">${escapeHtml(orgName || 'Your organization')}</h1>
  <p style="margin:8px 0 0;color:#78716c;font-size:12.5px">Generated ${escapeHtml(fmtDate(generatedAt))} &middot; ${list.length} domain${list.length === 1 ? '' : 's'} &middot; last ${rangeDays} day${rangeDays === 1 ? '' : 's'}</p>

  <table role="presentation" style="width:100%;border-collapse:collapse;margin:24px 0 0">
    <tr>
      <td style="padding:0 12px 0 0;width:33%"><div style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Average score</div><div style="font-size:26px;font-weight:650;color:${toneColor(band(average))}">${average ?? '—'}<span style="font-size:12px;color:#a8a29e"> /100</span></div></td>
      <td style="padding:0 12px;width:33%"><div style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Domains below ${WARNING_SCORE}</div><div style="font-size:26px;font-weight:650;color:${atRisk ? '#b91c1c' : '#15803d'}">${atRisk}</div></td>
      <td style="padding:0 0 0 12px;width:33%"><div style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Domains monitored</div><div style="font-size:26px;font-weight:650">${list.length}</div></td>
    </tr>
  </table>

  <table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 0;font-size:13px">
    <thead><tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Domain</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Score</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">SPF</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">DKIM</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">DMARC</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e">Issues</th>
    </tr></thead>
    <tbody>${tableRows || '<tr><td colspan="6" style="padding:14px 12px;color:#78716c">No active domains.</td></tr>'}</tbody>
  </table>

  <p style="margin:26px 0 0;font-size:12.5px;color:#57534e">The full report is attached as an HTML file. Open the console for per-record evidence and fix guidance.</p>
  <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #e7e5e4;font-size:11px;color:#a8a29e">Generated by NexusEmail. Scores: SPF 35 &middot; DKIM 30 &middot; DMARC 35 &middot; MTA-STS 15 &middot; TLS-RPT 5.</p>
</div>
</body></html>`;

  const metaPlain = list.map((r) => `- ${r.name}: ${r.score ?? '—'}/100 (SPF ${r.spf || '—'}, DKIM ${r.dkim || '—'}, DMARC ${r.dmarc || '—'}, ${r.issues ?? 0} issues)`).join('\n');
  const text = `Email authentication digest — ${orgName || 'Your organization'}\nGenerated ${fmtDate(generatedAt)} · ${list.length} domains\n\nAverage score: ${average ?? '—'}/100 · Below ${WARNING_SCORE}: ${atRisk}\n\n${metaPlain}\n\nFull report attached.`;

  return {
    subject: `Nexus email authentication digest — ${orgName || 'Your organization'} — ${new Date(generatedAt).toISOString().slice(0, 10)}`,
    html,
    text,
    average,
    atRisk,
  };
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signShareToken(reportId, expiresAt, secret) {
  if (!secret) throw new Error('share secret required');
  const payload = `${reportId}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyShareToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(exp)) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = Number(exp);
  if (expiresAt < now) return null;
  return { reportId: Number(id), expiresAt };
}

function isScheduleDue(schedule, now = Date.now()) {
  if (!schedule || schedule.enabled !== true) return false;
  const interval = SCHEDULE_INTERVALS[schedule.frequency];
  if (!interval) return false;
  const last = Date.parse(schedule.last_run || '') || 0;
  return now - last >= interval;
}

/** Accepts comma/semicolon/whitespace separated addresses; dedupes,
 * lowercases, and drops malformed entries. */
function parseRecipients(input) {
  const out = [];
  const seen = new Set();
  for (const raw of String(input || '').split(/[\s,;]+/)) {
    const value = raw.trim().toLowerCase();
    if (!value || !EMAIL_RE.test(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.slice(0, 20);
}

module.exports = {
  PASSING_SCORE,
  WARNING_SCORE,
  SHARE_TTL_DEFAULT_DAYS,
  SHARE_TTL_MAX_DAYS,
  SCHEDULE_INTERVALS,
  band,
  bandLabel,
  csvField,
  deriveStatus,
  normalizeDnsResults,
  passClass,
  spfPassClass,
  dmarcPassClass,
  distinctIssues,
  scoreTrend,
  recommendationsFor,
  dmarcSummary,
  buildDomainReport,
  buildPortfolioReport,
  signShareToken,
  verifyShareToken,
  isScheduleDue,
  parseRecipients,
};
