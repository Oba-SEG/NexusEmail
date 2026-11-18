const db = require('../db/database');
const { BrandProtectionService } = require('./brandProtection');

// Shared brand-scan pipeline used by the manual routes and the scheduled
// scanner. Persists everything a reload needs: the snapshot (brand_scans
// history), the detected threats (brand_threats rows), the brand's
// last_scan/next_scan, and alerts for genuinely new threats.

const SCHEDULE_DAYS = { daily: 1, weekly: 7, monthly: 30 };

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

async function syncThreats(brand, result, orgId) {
  const [existing, safeList] = await Promise.all([
    db.getBrandThreats(brand.id, orgId),
    db.getBrandSafeList(brand.id, orgId),
  ]);
  const known = new Set(existing.map((t) => String(t.domain).toLowerCase()));
  const detected = collectThreats(result, brand.domain, safeList);
  const added = [];
  for (const threat of detected) {
    if (known.has(threat.domain)) continue;
    await db.addBrandThreat({ ...threat, notes: 'Detected by scheduled/manual brand scan' }, brand.id, orgId);
    added.push(threat);
  }
  return added;
}

async function performBrandScan(brand, orgId) {
  const service = new BrandProtectionService();
  const result = await service.checkBrandProtection(brand.domain, brand.last_results);
  const scannedAt = new Date().toISOString();

  // A successful scan schedules the next one; manual brands keep no next_scan.
  const nextScan = brand.scan_schedule && brand.scan_schedule !== 'manual'
    ? nextScanFor(brand.scan_schedule)
    : null;

  await db.updateBrand(brand.id, {
    last_scan: scannedAt,
    next_scan: nextScan,
    last_results: result,
  }, orgId);

  await db.addBrandScan({ brand_id: brand.id, scanned_at: scannedAt, ...result }, orgId);

  const addedThreats = await syncThreats(brand, result, orgId);

  if (brand.alerts_enabled) {
    for (const alert of (result.alerts || [])) {
      await db.addBrandAlert({ ...alert, brand_id: brand.id, brand_name: brand.domain }, orgId);
    }
  }

  return { ...result, next_scan: nextScan, threats_persisted: addedThreats.length };
}

function isBrandDue(brand, now = Date.now()) {
  if (!brand || brand.status !== 'active') return false;
  if (!brand.scan_schedule || brand.scan_schedule === 'manual') return false;
  if (!brand.next_scan) return true;
  return Date.parse(brand.next_scan) <= now;
}

module.exports = { performBrandScan, nextScanFor, collectThreats, isBrandDue, SCHEDULE_DAYS };
