const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { nextScanFor, collectThreats, isBrandDue, alertsForThreats, ALLOWED_SCHEDULES } = require('../src/services/brandScan');
const { canonicalDomain, typoProbeCandidates } = require('../src/services/brandProtection');

describe('brand scan scheduling helpers', () => {
  test('nextScanFor maps schedules to future timestamps', () => {
    const from = Date.parse('2026-01-01T00:00:00.000Z');
    assert.equal(nextScanFor('daily', from), '2026-01-02T00:00:00.000Z');
    assert.equal(nextScanFor('weekly', from), '2026-01-08T00:00:00.000Z');
    assert.equal(nextScanFor('monthly', from), '2026-01-31T00:00:00.000Z');
    assert.equal(nextScanFor('manual', from), null);
    assert.equal(nextScanFor(undefined, from), null);
  });

  test('isBrandDue only fires scheduled brands whose next_scan passed', () => {
    const now = Date.parse('2026-01-10T00:00:00.000Z');
    assert.equal(isBrandDue({ status: 'active', scan_schedule: 'daily', next_scan: null }, now), true);
    assert.equal(isBrandDue({ status: 'active', scan_schedule: 'daily', next_scan: '2026-01-09T00:00:00.000Z' }, now), true);
    assert.equal(isBrandDue({ status: 'active', scan_schedule: 'daily', next_scan: '2026-01-11T00:00:00.000Z' }, now), false);
    assert.equal(isBrandDue({ status: 'active', scan_schedule: 'manual', next_scan: null }, now), false);
    assert.equal(isBrandDue({ status: 'paused', scan_schedule: 'daily', next_scan: null }, now), false);
  });

  test('collectThreats dedupes by domain, skips safe list and the brand itself', () => {
    const result = {
      typosquatting: [{ domain: 'segbvtes.xyz', registered: true }, { domain: 'segbytes-signin.com', registered: false }],
      lookalikes: [{ domain: 'segbvtes.xyz' }, { domain: 'segbytes.xyz' }],
      impersonation: [{ domain: 'login.segbytes.xyz' }],
      homographs: [{ domain: canonicalDomain('sеgbytes.xyz') }],
    };
    const threats = collectThreats(result, 'segbytes.xyz', ['login.segbytes.xyz']);
    const domains = threats.map((t) => t.domain).sort();
    assert.deepEqual(domains, ['segbvtes.xyz', 'segbytes-signin.com', canonicalDomain('sеgbytes.xyz')].sort());
    const typo = threats.find((t) => t.domain === 'segbvtes.xyz');
    assert.equal(typo.threat_type, 'typosquatting');
    assert.equal(typo.severity, 'high');
    const unregistered = threats.find((t) => t.domain === 'segbytes-signin.com');
    assert.equal(unregistered.severity, 'low');
  });

  test('collectThreats tolerates malformed sections', () => {
    assert.deepEqual(collectThreats({}, 'segbytes.xyz'), []);
    assert.deepEqual(collectThreats({ typosquatting: [null, 'junk', { domain: '' }] }, 'segbytes.xyz'), []);
  });
});

test('unknown schedule strings are inert, not perpetually due', () => {
  const now = Date.parse('2026-01-10T00:00:00.000Z');
  assert.equal(isBrandDue({ status: 'active', scan_schedule: 'weeky', next_scan: null }, now), false);
  assert.equal(isBrandDue({ status: 'active', scan_schedule: 'daily', next_scan: 'garbage' }, now), false);
  assert.deepEqual(ALLOWED_SCHEDULES, ['manual', 'daily', 'weekly', 'monthly']);
});

test('alertsForThreats mirrors persisted threats (first-scan included)', () => {
  const alerts = alertsForThreats([
    { domain: 'segbvtes.xyz', threat_type: 'typosquatting' },
    { domain: 'login.segbytes.co', threat_type: 'subdomain_abuse' },
  ]);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].severity, 'high');
  assert.equal(alerts[1].severity, 'medium');
  assert.match(alerts[0].message, /typosquatting detected: segbvtes\.xyz/);
  assert.equal(alerts[0].domain, 'segbvtes.xyz');
});

describe('typo probe candidates', () => {
  test('the brand name on other TLDs is probed, the main domain is not', () => {
    const { candidates } = typoProbeCandidates('segbytes', 'segbytes.xyz', ['xyz', 'com', 'co.za']);
    const sameName = candidates.filter((c) => c.sameName).map((c) => c.domain);
    assert.deepEqual(sameName, ['segbytes.com', 'segbytes.co.za']);
    assert.equal(candidates.some((c) => c.domain === 'segbytes.xyz'), false);
    const other = candidates.find((c) => c.domain === 'segbytes.co.za');
    assert.equal(other.tld, 'co.za');
    assert.equal(other.sameName, true);
  });

  test('typo variants keep the main exclusion and stay sameName=false', () => {
    const { candidates } = typoProbeCandidates('segbytes', 'segbytes.xyz', ['com']);
    const typos = candidates.filter((c) => !c.sameName);
    assert.ok(typos.length > 0);
    assert.equal(typos.every((c) => c.domain.endsWith('.com') || c.domain.endsWith('.xyz')), true);
    assert.equal(typos.some((c) => c.domain === 'segbytes.xyz'), false);
    assert.equal(candidates.some((c) => c.domain === 'segbytes.com'), true);
  });
});
