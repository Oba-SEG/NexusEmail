const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseTldResponse, cleanTlds } = require('../src/services/tldRegistry');
const { orderedTlds, normalizeTldList, typoVariants, SCAN_TLDS } = require('../src/services/brandProtection');

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
