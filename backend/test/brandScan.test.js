const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { nextScanFor, collectThreats, isBrandDue } = require('../src/services/brandScan');

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
      homographs: [{ domain: 'sеgbytes.xyz' }],
    };
    const threats = collectThreats(result, 'segbytes.xyz', ['login.segbytes.xyz']);
    const domains = threats.map((t) => t.domain).sort();
    assert.deepEqual(domains, ['segbvtes.xyz', 'segbytes-signin.com', 'sеgbytes.xyz'].sort());
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
