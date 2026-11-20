const cron = require('node-cron');
const { getDomains, addScan, getScans, getAllBrands, getOrganizations, getUsers, getSetting, setSetting, getLatestScan } = require('../db/database');
const { DNSService } = require('./dnsProviders');
const { captureException } = require('../capture');
const { NotificationService } = require('./notifications');
const { performBrandScan, isBrandDue } = require('./brandScan');
const { buildPortfolioReport, normalizeDnsResults, distinctIssues, isScheduleDue, parseRecipients } = require('./reportBuilder');

const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || 'https://brandprotection.segbytes.xyz').replace(/\/$/, '');

function statusWord(status) {
  switch (String(status || '').toUpperCase()) {
    case 'FOUND': return 'Found';
    case 'NOT_FOUND': return 'Missing';
    case 'ERROR': return 'Error';
    case 'PASS': return 'Pass';
    default: return '—';
  }
}

function recordLabel(result, policy) {
  const word = statusWord(result?.status);
  return policy ? `${word} · ${policy}` : word;
}

function startScheduledScans() {
  // Run daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('🔄 Starting scheduled domain scans...');
    await runScheduledScans();
  });

  // Run every 6 hours for critical domains
  cron.schedule('0 */6 * * *', async () => {
    console.log('🔄 Running critical domain health check...');
    await runCriticalScans();
  });

  // Brand Protection: hourly check for brands whose next_scan is due
  // (per-brand daily/weekly/monthly schedules). Idempotent — brands not
  // due cost nothing beyond one list query.
  cron.schedule('15 * * * *', async () => {
    try {
      await runBrandDueScans();
    } catch (error) {
      captureException(error);
      console.error('❌ Brand due scans failed:', error.message);
    }
  });

  // Scheduled report digests: hourly tick, per-org frequency decides due.
  cron.schedule('25 * * * *', async () => {
    try {
      await runReportSchedules();
    } catch (error) {
      captureException(error);
      console.error('❌ Report schedules failed:', error.message);
    }
  });

  console.log('✅ Scheduled scans initialized');
}

// Scans every brand whose per-brand schedule has come due.
async function runBrandDueScans() {
  let scanned = 0;
  for (const brand of await getAllBrands()) {
    if (!isBrandDue(brand)) continue;
    try {
      const result = await performBrandScan(brand, brand.org_id, { requireDue: true });
      if (result.skipped) continue;
      scanned += 1;
      console.log(`🛡️ Brand scan done: ${brand.domain}`);
    } catch (error) {
      captureException(error);
      console.error(`❌ Brand scan failed for ${brand.domain}:`, error.message);
    }
  }
  if (scanned > 0) console.log(`🛡️ Brand due scans finished (${scanned} scanned)`);
  return { scanned };
}

async function scanDomain(domain, dnsService, { notify } = {}) {
  const [spf, dkim, dmarc] = await Promise.all([
    dnsService.checkSPF(domain.name),
    dnsService.checkDKIM(domain.name),
    dnsService.checkDMARC(domain.name)
  ]);

  const score = dnsService.calculateHealthScore(spf, dkim, dmarc);
  await addScan({ domain_id: domain.id, score, spf, dkim, dmarc, spf_record: JSON.stringify(spf), dkim_selectors: JSON.stringify(dkim.selectors || []), dmarc_record: JSON.stringify(dmarc), issues: [] }, domain.org_id);
  console.log(`✅ Scanned ${domain.name} - Score: ${score}`);

  // Optional dispatch (used by the daily run, not the hourly warm tick).
  if (notify) {
    try {
      await NotificationService.dispatchScanResults(domain.org_id, domain, {
        score, spf, dkim, dmarc, issues: []
      });
    } catch (error) {
      captureException(error);
      console.error(`❌ Notification dispatch failed for ${domain.name}:`, error.message);
    }
  }
  return score;
}

// Scans every active domain regardless of recency (used by the 2 AM cron).
// Scan-completed notifications fire here only — the hourly warm tick stays quiet.
async function runScheduledScans() {
  const dnsService = new DNSService();
  let scanned = 0;
  for (const domain of await getDomains()) {
    if (domain.status !== 'active') continue;
    try {
      await scanDomain(domain, dnsService, { notify: true });
      scanned += 1;
    } catch (error) {
      captureException(error);
      console.error(`❌ Error scanning ${domain.name}:`, error.message);
    }
  }
  let brands = { scanned: 0 };
  try {
    brands = await runBrandDueScans();
  } catch (error) {
    captureException(error);
    console.error('❌ Brand due scans failed:', error.message);
  }
  console.log(`🔄 Scheduled scans finished (${scanned} scanned)`);
  return { scanned, brands_scanned: brands.scanned };
}

// Scans only domains whose latest scan is older than maxAgeHours.
// Used by the keep-warm tick so hourly pings don't hammer the DNS lookups.
async function runDueScans(maxAgeHours = 12) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const dnsService = new DNSService();
  let scanned = 0;
  for (const domain of await getDomains()) {
    if (domain.status !== 'active') continue;
    const latest = (await getScans(domain.id, 1))[0];
    if (latest && latest.scanned_at > cutoff) continue;
    try {
      await scanDomain(domain, dnsService);
      scanned += 1;
    } catch (error) {
      captureException(error);
      console.error(`❌ Error scanning ${domain.name}:`, error.message);
    }
  }
  let brands = { scanned: 0 };
  try {
    brands = await runBrandDueScans();
  } catch (error) {
    captureException(error);
    console.error('❌ Brand due scans failed:', error.message);
  }
  console.log(`🔄 Due scans finished (${scanned} scanned)`);
  return { scanned, brands_scanned: brands.scanned };
}

async function runCriticalScans() {
  const dnsService = new DNSService();
  const active = (await getDomains()).filter((d) => d.status === 'active');
  const withScores = (await Promise.all(active.map(async (domain) => {
    const latest = (await getScans(domain.id, 1))[0];
    return { domain, lastScore: latest ? latest.score : 0 };
  })))
    .sort((a, b) => (a.lastScore || 0) - (b.lastScore || 0))
    .slice(0, 10);

  for (const { domain, lastScore } of withScores) {
    try {
      const score = await scanDomain(domain, dnsService);
      // Critical alert on a significant score drop (≥10 points)
      if (lastScore && lastScore - score >= 10) {
        console.log(`⚠️ ${domain.name} score dropped: ${lastScore} -> ${score}`);
        try {
          await NotificationService.dispatchCriticalAlert(
            domain.org_id,
            domain,
            `Security score dropped from ${lastScore} to ${score}`
          );
        } catch (error) {
          captureException(error);
          console.error(`❌ Critical alert dispatch failed for ${domain.name}:`, error.message);
        }
      }
    } catch (error) {
      captureException(error);
      console.error(`❌ Error on critical scan ${domain.name}:`, error.message);
    }
  }
}

async function collectDigestRows(orgId) {
  const domains = (await getDomains(orgId)).filter((d) => d.status !== 'archived');
  const rows = [];
  for (const domain of domains) {
    const scan = await getLatestScan(domain.id, orgId);
    const n = normalizeDnsResults(scan);
    rows.push({
      name: domain.name,
      score: typeof scan?.score === 'number' ? scan.score : null,
      spf: recordLabel(n.spf, n.spf?.policy),
      dkim: n.dkim?.status === 'FOUND' ? (n.dkim.selector || 'Found') : recordLabel(n.dkim),
      dmarc: recordLabel(n.dmarc, n.dmarc?.policy),
      issues: distinctIssues(scan).length,
    });
  }
  return rows;
}

async function deliverReportDigest(org, schedule) {
  const rows = await collectDigestRows(org.id);
  const built = buildPortfolioReport({ orgName: org.name, rows, rangeDays: 30 });
  const date = new Date().toISOString().slice(0, 10);
  const svc = await NotificationService.createForOrg(org.id);

  const recipients = parseRecipients(schedule.recipients);
  let email = { skipped: true };
  if (recipients.length) {
    email = await svc.sendNotification(recipients.join(', '), built.subject, built.html, {
      attachments: [{
        filename: `nexus-portfolio-${date}.html`,
        content: Buffer.from(built.html, 'utf8'),
        contentType: 'text/html',
      }],
    });
  }

  let slack = { skipped: true };
  if (schedule.slack && svc.slackWebhook) {
    slack = await svc.sendSlack({
      text: `📊 *Email authentication digest — ${org.name}*\nAverage ${built.average ?? '—'}/100 · ${built.atRisk} domain${built.atRisk === 1 ? '' : 's'} below 50\n<${APP_BASE_URL}/?tab=reports|Open reports>`,
    });
  }

  return { email, slack };
}

function channelState(result) {
  if (!result) return 'skipped';
  if (result.success) return 'sent';
  if (result.skipped) return 'skipped';
  return result.error || 'failed';
}

/** Hourly tick: delivers any org schedule that is due. The legacy
 * "weekly summary" notification toggle routes to the org's owners/admins
 * and shares the same digest builder. */
async function runReportSchedules(now = Date.now()) {
  const orgs = await getOrganizations();
  const results = [];

  for (const org of orgs) {
    let schedule = null;
    try {
      const raw = await getSetting('report_schedule', org.id);
      schedule = raw ? JSON.parse(raw) : null;
    } catch { schedule = null; }

    if (schedule && schedule.enabled) {
      if (!isScheduleDue(schedule, now)) continue;
      try {
        const outcome = await deliverReportDigest(org, schedule);
        const next = {
          ...schedule,
          last_run: new Date(now).toISOString(),
          last_result: { email: channelState(outcome.email), slack: channelState(outcome.slack) },
        };
        await setSetting('report_schedule', JSON.stringify(next), org.id);
        results.push({ org: org.id, ...next.last_result });
      } catch (error) {
        captureException(error);
        results.push({ org: org.id, error: error.message });
      }
      continue;
    }

    const legacyWeekly = (await getSetting('notify_weekly_report', org.id)) === '1';
    if (!legacyWeekly) continue;
    const lastRun = await getSetting('notify_weekly_report_last_run', org.id);
    const legacy = { enabled: true, frequency: 'weekly', recipients: '', slack: false, last_run: lastRun || null };
    if (!isScheduleDue(legacy, now)) continue;

    const users = (await getUsers(org.id)).filter(
      (u) => u.status === 'active' && (u.role === 'owner' || u.role === 'admin') && u.email
    );
    if (!users.length) continue;

    try {
      const outcome = await deliverReportDigest(org, { ...legacy, recipients: users.map((u) => u.email).join(', ') });
      await setSetting('notify_weekly_report_last_run', new Date(now).toISOString(), org.id);
      results.push({ org: org.id, email: channelState(outcome.email), slack: channelState(outcome.slack) });
    } catch (error) {
      captureException(error);
      results.push({ org: org.id, error: error.message });
    }
  }

  if (results.length) console.log(`📬 Report digests processed: ${results.length}`);
  return { delivered: results.length, results };
}

module.exports = { startScheduledScans, runScheduledScans, runDueScans, runBrandDueScans, runReportSchedules };