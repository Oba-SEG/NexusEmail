const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseTldResponse, cleanTlds } = require('../src/services/tldRegistry');
const { orderedTlds, normalizeTldList, typoVariants, canonicalDomain, SCAN_TLDS } = require('../src/services/brandProtection');
const { collectThreats } = require('../src/services/brandScan');
const { applySafeListToResult } = require('../src/services/brandProtection');

describe('tld registry parsing', () => {
  test('parseTldResponse extracts, lowercases and dedupes the TLD map keys', () => {
    const payload = {
      intReturnCode: 1,
      arrTLDs: {
        'co.za': { code: 0 },
        COM: { code: 1 },
        com: { code: 1 },
        '': { code: 1 },
        'bad tld': { code: 1 },
        'xyz': { code: 1 },
      },
    };
    assert.deepEqual(parseTldResponse(payload), ['co.za', 'com', 'xyz']);
  });

  test('parseTldResponse tolerates malformed payloads', () => {
    assert.deepEqual(parseTldResponse(null), []);
    assert.deepEqual(parseTldResponse({}), []);
    assert.deepEqual(parseTldResponse({ arrTLDs: ['com'] }), []);
    assert.deepEqual(parseTldResponse({ arrTLDs: 'nope' }), []);
  });

  test('cleanTlds drops invalid and oversized entries', () => {
    assert.deepEqual(cleanTlds(['com', 'co.za', '-bad', 'a'.repeat(70), 'ok-tld']), ['com', 'co.za', 'ok-tld']);
    assert.deepEqual(cleanTlds(null), []);
  });
});

describe('scan tld selection', () => {
  test('orderedTlds puts the brand TLD first, dedupes and lowercases', () => {
    const tlds = orderedTlds('CO.ZA', ['com', 'co.za', 'NET']);
    assert.equal(tlds[0], 'co.za');
    assert.ok(tlds.includes('com'));
    assert.ok(tlds.includes('net'));
    assert.equal(new Set(tlds).size, tlds.length);
  });

  test('orderedTlds falls back to the bundled list when no registry list is given', () => {
    assert.deepEqual(orderedTlds('com'), [...new Set(['com', ...SCAN_TLDS])]);
  });

  test('normalizeTldList rejects junk and falls back safely', () => {
    assert.deepEqual(normalizeTldList(['COM', 'co.za', '', null]), ['com', 'co.za']);
    assert.deepEqual(normalizeTldList([]), SCAN_TLDS);
    assert.deepEqual(normalizeTldList('com'), SCAN_TLDS);
    assert.deepEqual(normalizeTldList(null), SCAN_TLDS);
  });

  test('typoVariants generates deletion, keyboard and dash variants without the base', () => {
    const variants = [...typoVariants('segbytes')];
    assert.ok(variants.includes('segbyte'), 'single-character deletion');
    assert.ok(variants.includes('aegbytes'), 'keyboard-adjacent substitution');
    assert.ok(variants.includes('zegbytes'), 's→z keyboard substitution survives the table extraction');
    assert.ok(variants.includes('seg-bytes'), 'dash insertion');
    assert.ok(!variants.includes('segbytes'), 'does not include the base name');
  });
});

describe('canonical threat domains', () => {
  test('canonicalDomain produces lowercase punycode', () => {
    assert.equal(canonicalDomain('ExAmple.COM.'), 'example.com');
    assert.equal(canonicalDomain('\u0455egbytes.com'), 'xn--egbytes-iog.com');
    assert.equal(canonicalDomain(''), '');
    assert.equal(canonicalDomain(null), '');
  });

  test('collectThreats prefers raw detections over display-capped records', () => {
    const result = {
      typosquatting: [{ domain: 'known-search-hit.com' }],
      lookalikes: [{ domain: 'visible.com' }],
      impersonation: [],
      homographs: [],
    };
    Object.defineProperty(result, 'detections', {
      value: {
        typosquatting: [{ domain: 'known-search-hit.com' }, { domain: 'only-in-detections.net' }],
        lookalikes: [],
        impersonation: [],
        homographs: [],
      },
      enumerable: false,
    });
    const threats = collectThreats(result, 'segbytes.com', []);
    assert.deepEqual(threats.map((t) => t.domain).sort(), ['known-search-hit.com', 'only-in-detections.net']);
  });

  test('collectThreats matches safe-list entries canonically', () => {
    const unicode = '\u0455egbytes.com';
    const result = {
      typosquatting: [{ domain: unicode }],
      lookalikes: [],
      impersonation: [],
      homographs: [],
    };
    assert.equal(collectThreats(result, 'segbytes.com', [canonicalDomain(unicode)]).length, 0);
  });
});

describe('safe-list summary rebuild', () => {
  test('applySafeListToResult rebuilds records, counts, score and issues', () => {
    const result = {
      typosquatting: [{ domain: 'segbvtes.com' }, { domain: 'safe.example.com' }],
      lookalikes: [{ domain: 'mailsegbytes.net' }],
      impersonation: [],
      homographs: [],
      socialMedia: [{ platform: 'Twitter/X', handle: 'segbytes' }],
      score: 100 - 2 * 15 - 1 * 10 - 1 * 8,
      issues: [
        { type: 'typosquatting', count: 2, severity: 'high' },
        { type: 'lookalike', count: 1, severity: 'medium' },
        { type: 'social_media', count: 1, severity: 'medium' },
      ],
      recommendations: ['Consider registering common typosquatting domains to prevent abuse'],
    };
    Object.defineProperty(result, 'detections', {
      value: {
        typosquatting: [{ domain: 'segbvtes.com' }, { domain: 'safe.example.com' }, { domain: 'only-raw.com' }],
        lookalikes: [{ domain: 'mailsegbytes.net' }],
        impersonation: [],
        homographs: [],
      },
      enumerable: false,
    });

    const out = applySafeListToResult(result, ['safe.example.com']);
    assert.deepEqual(out.typosquatting.map((r) => r.domain), ['segbvtes.com', 'only-raw.com']);
    assert.equal(out.issues.find((i) => i.type === 'typosquatting').count, 2);
    assert.equal(out.score, 100 - 2 * 15 - 1 * 10 - 1 * 8);
    assert.ok(!('detections' in out) || out.detections === undefined);
    assert.equal(result.typosquatting.length, 2, 'original result not mutated');
  });

  test('applySafeListToResult with a removal keeps previously hidden hits', () => {
    const result = { typosquatting: [], lookalikes: [{ domain: 'mailsegbytes.net' }], impersonation: [], homographs: [], socialMedia: [], score: 100, issues: [], recommendations: [] };
    Object.defineProperty(result, 'detections', {
      value: { typosquatting: [], lookalikes: [{ domain: 'mailsegbytes.net' }, { domain: 'safe.example.com' }], impersonation: [], homographs: [] },
      enumerable: false,
    });
    const out = applySafeListToResult(result, []);
    assert.deepEqual(out.lookalikes.map((r) => r.domain), ['mailsegbytes.net', 'safe.example.com']);
    assert.equal(out.score, 80);
  });
});
