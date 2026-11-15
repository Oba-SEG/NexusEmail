const { test, describe } = require('node:test');
const assert = require('node:assert');
const { TyposquatDetector, generateCandidates, generateTldSwaps, splitDomain } = require('../src/services/typosquatDetector');

const POLICY = { status: 200, body: '' };

describe('splitDomain', () => {
  test('splits sld and tld', () => {
    assert.deepEqual(splitDomain('mail.acme.test'), { tld: 'test', sld: 'acme', base: 'mail.acme' });
  });
  test('rejects single-label domains', () => {
    assert.equal(splitDomain('localhost'), null);
  });
});

describe('generateCandidates', () => {
  test('generates typos, homoglyphs, and prefix/suffix variants', () => {
    const c = generateCandidates('acme');
    assert.ok(c.includes('acm'), 'char drop');
    assert.ok(c.includes('acem'), 'char swap');
    assert.ok(c.includes('acm3'), 'homoglyph e->3');
    assert.ok(c.includes('secureacme') || c.includes('acmesecure'), 'prefix/suffix');
    assert.ok(!c.includes('acme'), 'never includes the original');
  });
  test('rn -> m and 0 -> o homoglyphs', () => {
    const c = generateCandidates('rn0');
    assert.ok(c.includes('m0') || c.includes('rno'));
  });
  test('all candidates are DNS-safe and different', () => {
    for (const c of generateCandidates('acme')) {
      assert.match(c, /^[a-z0-9-]+$/);
      assert.notEqual(c, 'acme');
    }
  });
});

describe('generateTldSwaps', () => {
  test('swaps exclude the current tld', () => {
    const s = generateTldSwaps('com');
    assert.ok(s.includes('net'));
    assert.ok(!s.includes('com'));
  });
});

describe('TyposquatDetector', () => {
  const fakeAnalyzer = (registrations) => {
    const rdapFetch = async (url) => {
      const domain = url.replace('https://rdap.org/domain/', '');
      if (!(domain in registrations)) throw new Error('unexpected target: ' + domain);
      return { status: registrations[domain], body: '' };
    };
    return new TyposquatDetector({ rdapFetch });
  };

  test('registered lookalikes are threats, unregistered are info', async () => {
    const detector = fakeAnalyzer({
      'acm.test': 200,          // typo, registered -> threat
      'acme.io': 200,           // tld swap, registered -> threat
      'acm3.test': 404,         // homoglyph, unregistered
      'acme-secure.test': 404,
    });
    // only probe targets the fake knows about; others error out and are skipped
    const r = await detector.analyze('acme.test');
    assert.ok(r.threats.some((t) => t.message.includes('acm.test')));
    assert.ok(r.threats.some((t) => t.message.includes('acme.io')));
    assert.ok(r.candidates.some((c) => c.domain === 'acm3.test' && c.status === 'unregistered'));
    assert.match(r.summary, /registered lookalike/);
  });

  test('RDAP errors are skipped silently', async () => {
    const detector = fakeAnalyzer({});
    const r = await detector.analyze('acme.test');
    assert.equal(r.threats.length, 0);
    assert.equal(r.candidates.length, 0);
  });

  test('short slds are skipped', async () => {
    const detector = fakeAnalyzer({});
    const r = await detector.analyze('ab.test');
    assert.match(r.summary, /too short/);
  });
});
