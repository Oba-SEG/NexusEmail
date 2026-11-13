const cron = require('node-cron');
const { getDomains, addScan, getScans } = require('../db/database');
const { DNSService } = require('./dnsProviders');
const { captureException } = require('../capture');
const { NotificationService } = require('./notifications');

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

  console.log('✅ Scheduled scans initialized');
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
  console.log(`🔄 Scheduled scans finished (${scanned} scanned)`);
  return { scanned };
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
  console.log(`🔄 Due scans finished (${scanned} scanned)`);
  return { scanned };
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

module.exports = { startScheduledScans, runScheduledScans, runDueScans };