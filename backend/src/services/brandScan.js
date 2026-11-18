const crypto = require('crypto');
const db = require('../db/database');
const { BrandProtectionService } = require('./brandProtection');

// Shared brand-scan pipeline used by the manual routes and the scheduled
// scanner. Persists everything a reload needs: the snapshot (brand_scans
// history), the detected threats (brand_threats rows), the brand's
// last_scan/next_scan, and alerts for genuinely new threats.
//
// Concurrency: each scan must win an atomic per-brand claim before probing,
// so a scheduled run and a manual click can't double-insert threats. All
// completion writes happen in one transaction — a failure leaves the last
// committed scan (and its due date) intact for retry.

const SCHEDULE_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const ALLOWED_SCHEDULES = ['manual', 'daily', 'weekly', 'monthly'];

function nextScanFor(schedule, from = Date.now()) {
  const days = SCHEDULE_DAYS[schedule];
  if (!days) return null;
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}

// Map each result section to the threat rows it should persist.
const THREAT_SECTIONS = [
  // Records use status strings ('registered'/'active') or a boolean flag
  // depending on the probe — treat either as a live, registered threat.
  { key: 'typosquatting', type: 'typosquatting', severity: (r) => (r.registered || r.status === 'registered' || r.status === 'active' ? 'high' : 'low') },
  { key: 'lookalikes', type: 'lookalike', severity: () => 'medium' },
  { key: 'impersonation', type: 'subdomain_abuse', severity: () => 'low' },
  { key: 'homographs', type: 'homograph', severity: () => 'high' },
];

function collectThreats(result, brandDomain, safeList = []) {
  const safe = new Set([brandDomain, ...safeList].map((d) => String(d).toLowerCase()));
  const byDomain = new Map();
  for (const section of THREAT_SECTIONS) {
    for (const record of result[section.key] || []) {
      const domain = String(record && record.domain || '').toLowerCase();
      if (!domain || safe.has(domain) || byDomain.has(domain)) continue;
      byDomain.set(domain, {
        domain,
        threat_type: section.type,
        severity: section.severity(record || {}),
        status: 'active',
      });
    }
  }
  return [...byDomain.values()];
}

// Alerts derive from the exact threats this scan persists — one definition
// of "new" for both the threat list and the alert feed, including a brand's
// first scan.
function alertsForThreats(added) {
  return added.map((threat) => ({
    type: 'new_threat',
    severity: threat.threat_type === 'typosquatting' || threat.threat_type === 'homograph' ? 'high' : 'medium',
    message: `New ${threat.threat_type} detected: ${threat.domain}`,
    timestamp: new Date().toISOString(),
    domain: threat.domain,
  }));
}

async function performBrandScan(brand, orgId, { requireDue = false } = {}) {
  const claim = crypto.randomUUID();
  const claimed = await db.claimBrandScan(brand.id, orgId, claim);
  if (!claimed) return { skipped: 'already_running', domain: brand.domain, brand_id: brand.id };

  try {
    // Re-read under the claim: schedule/alerts/status may have changed since
    // the caller loaded the row (e.g. user switched to Manual mid-flight).
    const fresh = await db.getBrand(brand.id, orgId);
    if (!fresh || fresh.status !== 'active') {
      return { skipped: 'inactive', domain: brand.domain, brand_id: brand.id };
    }
    if (requireDue && !isBrandDue(fresh)) {
      return { skipped: 'not_due', domain: brand.domain, brand_id: brand.id };
    }

    const service = new BrandProtectionService();
    const result = await service.checkBrandProtection(fresh.domain, fresh.last_results);

    // The service reports partial failures as result.error instead of
    // throwing. Never record those as successful scans or advance the
    // schedule — the brand stays due so the scheduler retries.
    if (result.error) {
      const err = new Error(result.error);
      err.brand_id = fresh.id;
      throw err;
    }

    const scannedAt = new Date().toISOString();
    let added = [];

    await db.withTransaction(async (tx) => {
      // Read the brand again inside the transaction: the user may have
      // changed the schedule or alerts while the probe was running.
      const current = await db.getBrand(fresh.id, orgId, tx);
      if (!current) return;
      const nextScan = nextScanFor(current.scan_schedule);

      const [safeList, existing] = await Promise.all([
        db.getBrandSafeList(fresh.id, orgId, tx),
        db.getBrandThreats(fresh.id, orgId, tx),
      ]);
      const known = new Set(existing.map((t) => String(t.domain).toLowerCase()));
      added = collectThreats(result, current.domain, safeList).filter((t) => !known.has(t.domain));

      for (const threat of added) {
        await db.addBrandThreat({ ...threat, notes: 'Detected by brand scan' }, fresh.id, orgId, tx);
      }
      await db.updateBrand(fresh.id, {
        last_scan: scannedAt,
        next_scan: nextScan,
        last_results: result,
      }, orgId, tx);
      await db.addBrandScan({ brand_id: fresh.id, scanned_at: scannedAt, ...result }, orgId, tx);

      if (current.alerts_enabled) {
        for (const alert of alertsForThreats(added)) {
          await db.addBrandAlert({ ...alert, brand_id: fresh.id, brand_name: current.domain }, orgId, tx);
        }
      }
    });

    const currentSchedule = (await db.getBrand(fresh.id, orgId)) || fresh;
    return {
      ...result,
      next_scan: nextScanFor(currentSchedule.scan_schedule),
      threats_persisted: added.length,
    };
  } finally {
    await db.releaseBrandScan(brand.id, claim).catch(() => {});
  }
}

function isBrandDue(brand, now = Date.now()) {
  if (!brand || brand.status !== 'active') return false;
  // Unknown schedule strings are inert rather than perpetually due.
  if (!SCHEDULE_DAYS[brand.scan_schedule]) return false;
  if (!brand.next_scan) return true;
  return Date.parse(brand.next_scan) <= now;
}

module.exports = {
  performBrandScan,
  nextScanFor,
  collectThreats,
  alertsForThreats,
  isBrandDue,
  SCHEDULE_DAYS,
  ALLOWED_SCHEDULES,
};
