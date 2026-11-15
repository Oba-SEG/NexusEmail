// Regression coverage for the HTML report's DNS-result normalizer.
// Run with: npm test  (node --test test/)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDnsResults,
  passClass,
  spfPassClass,
  dmarcPassClass
} = require('../src/routes/reports');

// ---------------------------------------------------------------------------
// Writer A: audit routes (domains.js bulk-scan /:id/scan) — flat *_status
// fields (always 'UNKNOWN', auditEngine objects carry no status) plus
// *_record JSON strings of the audit objects.
// ---------------------------------------------------------------------------

test('flat writer: absent record (ENOTFOUND error) is NOT_FOUND, not ERROR', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    dkim_status: 'UNKNOWN',
    dmarc_status: 'UNKNOWN',
    spf_record: '{"found":false,"record":null,"errors":["queryTxt ENOTFOUND _spf.example.com"],"warnings":[]}',
    dkim_selectors: '[]',
    dmarc_record: '{"found":false,"record":null,"errors":["queryTxt ENOTFOUND _dmarc.example.com"],"warnings":[]}'
  });
  assert.equal(r.spf.status, 'NOT_FOUND');
  assert.equal(r.dmarc.status, 'NOT_FOUND');
  assert.equal(r.dkim.status, 'NOT_FOUND');
  assert.equal(passClass(r.spf.status), 'fail');
});

test('flat writer: audit "No SPF/DMARC record found" messages are NOT_FOUND', () => {
  // auditEngine checkSPF/checkDMARC push these when the TXT lookup
  // succeeds but contains no record (auditEngine.js lines 81 / 213).
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    dmarc_status: 'UNKNOWN',
    spf_record: '{"found":false,"record":null,"errors":["No SPF record found"],"warnings":[]}',
    dmarc_record: '{"found":false,"record":null,"errors":["No DMARC record found"],"warnings":[]}'
  });
  assert.equal(r.spf.status, 'NOT_FOUND');
  assert.equal(r.dmarc.status, 'NOT_FOUND');
  assert.equal(spfPassClass(r.spf), 'fail');
  assert.equal(dmarcPassClass(r.dmarc), 'fail');
});

test('flat writer: a non-absent lookup failure is still ERROR', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    spf_record: '{"found":false,"record":null,"errors":["queryTxt SERVFAIL"],"warnings":[]}'
  });
  assert.equal(r.spf.status, 'ERROR');
});

test('flat writer: found record with validation errors (+all) is ERROR, never green', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    spf_record: '{"found":true,"record":"v=spf1 +all","errors":["Permissive +all policy"],"warnings":[]}'
  });
  assert.equal(r.spf.status, 'ERROR');
  assert.equal(spfPassClass(r.spf), 'fail');
});

test('flat writer: found record with no errors and hardfail policy passes', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    dkim_status: 'UNKNOWN',
    dmarc_status: 'UNKNOWN',
    spf_record: '{"found":true,"record":"v=spf1 -all","policy":"hardfail","errors":[],"warnings":[]}',
    dkim_selectors: '[{"selector":"google","record":"v=DKIM1; k=rsa; p=x"}]',
    dmarc_record: '{"found":true,"record":"v=DMARC1; p=reject","policy":"reject","errors":[],"warnings":[]}'
  });
  assert.equal(r.spf.status, 'FOUND');
  assert.equal(spfPassClass(r.spf), 'pass');
  assert.equal(r.dkim.status, 'FOUND');
  assert.equal(r.dkim.selector, 'google');
  assert.equal(passClass(r.dkim.status), 'pass');
  assert.equal(r.dmarc.status, 'FOUND');
  assert.equal(dmarcPassClass(r.dmarc), 'pass');
});

test('flat writer: warnings only stay FOUND (warnings are advisory)', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    spf_record: '{"found":true,"record":"v=spf1 ~all","policy":"softfail","errors":[],"warnings":["weak"]}'
  });
  assert.equal(r.spf.status, 'FOUND');
  assert.equal(spfPassClass(r.spf), 'pass');
});

test('flat writer: softfail SPF passes, p=none DMARC fails', () => {
  const softfail = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    spf_record: '{"found":true,"record":"v=spf1 ~all","policy":"softfail","errors":[]}'
  });
  assert.equal(spfPassClass(softfail.spf), 'pass');

  const pNone = normalizeDnsResults({
    dmarc_status: 'UNKNOWN',
    dmarc_record: '{"found":true,"record":"v=DMARC1; p=none","policy":"none","errors":[]}'
  });
  assert.equal(pNone.dmarc.status, 'FOUND');
  assert.equal(dmarcPassClass(pNone.dmarc), 'fail');
});

test('flat writer: found SPF with no policy (no -all/~all) is not passing', () => {
  const r = normalizeDnsResults({
    spf_status: 'UNKNOWN',
    spf_record: '{"found":true,"record":"v=spf1 include:x","policy":null,"errors":[]}'
  });
  assert.equal(r.spf.status, 'FOUND');
  assert.equal(spfPassClass(r.spf), 'fail');
});

// ---------------------------------------------------------------------------
// Writer B: scheduler + /scans/run — spf/dkim/dmarc objects with explicit
// status, mirrored as *_record JSON strings.
// ---------------------------------------------------------------------------

test('object writer: explicit statuses are used as-is', () => {
  const r = normalizeDnsResults({
    spf: { found: false, error: 'queryTxt ENOTFOUND _spf.example.com', status: 'ERROR' },
    dkim: { found: false, status: 'NOT_FOUND', selectors: [] },
    dmarc: { found: false, error: 'queryTxt ENOTFOUND _dmarc.example.com', status: 'ERROR' }
  });
  assert.equal(r.spf.status, 'ERROR');
  assert.equal(r.dkim.status, 'NOT_FOUND');
  assert.equal(r.dmarc.status, 'ERROR');
});

test('object writer: FOUND SPF with policy none (+all) is not passing', () => {
  const r = normalizeDnsResults({
    spf: { found: true, record: 'v=spf1 +all', status: 'FOUND', policy: 'none' }
  });
  assert.equal(r.spf.status, 'FOUND');
  assert.equal(spfPassClass(r.spf), 'fail');
});

test('object writer: FOUND SPF hardfail and DMARC quarantine pass', () => {
  const r = normalizeDnsResults({
    spf: { found: true, record: 'v=spf1 -all', status: 'FOUND', policy: 'hardfail' },
    dkim: { found: true, status: 'FOUND', selectors: [{ selector: 'google', record: 'k=rsa' }] },
    dmarc: { found: true, status: 'FOUND', policy: 'quarantine' }
  });
  assert.equal(spfPassClass(r.spf), 'pass');
  assert.equal(passClass(r.dkim.status), 'pass');
  assert.equal(r.dkim.selector, 'google');
  assert.equal(dmarcPassClass(r.dmarc), 'pass');
});

test('object writer: DMARC p=none is not passing', () => {
  const r = normalizeDnsResults({
    dmarc: { found: true, status: 'FOUND', policy: 'none' }
  });
  assert.equal(dmarcPassClass(r.dmarc), 'fail');
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

test('no scan -> empty results (table falls back to Not checked)', () => {
  assert.deepEqual(normalizeDnsResults(undefined), {});
  assert.deepEqual(normalizeDnsResults(null), {});
});

test('MTA-STS and TLS-RPT are absent from both writers -> undefined rows', () => {
  const r = normalizeDnsResults({
    spf: { found: true, record: 'v=spf1 -all', status: 'FOUND', policy: 'hardfail' }
  });
  assert.equal(r.mta_sts, undefined);
  assert.equal(r.tls_rpt, undefined);
});

test('passClass accepts FOUND and pass, rejects everything else', () => {
  assert.equal(passClass('FOUND'), 'pass');
  assert.equal(passClass('pass'), 'pass');
  assert.equal(passClass('NOT_FOUND'), 'fail');
  assert.equal(passClass('ERROR'), 'fail');
  assert.equal(passClass('UNKNOWN'), 'fail');
  assert.equal(passClass(undefined), 'fail');
});

test('invalid JSON in *_record falls back gracefully instead of throwing', () => {
  const r = normalizeDnsResults({ spf_status: 'UNKNOWN', spf_record: 'not-json' });
  // parse fails -> no object -> flat UNKNOWN surfaced, still not passing
  assert.equal(r.spf.status, 'UNKNOWN');
  assert.equal(spfPassClass(r.spf), 'fail');
});
