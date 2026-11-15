const { test, describe } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { TyposquatDetector, generateCandidates, generateTldSwaps, splitDomain, defaultRdapFetch } = require('../src/services/typosquatDetector');

describe('splitDomain', () => {
  test('splits sld and tld', () => {
    assert.deepEqual(splitDomain('mail.acme.test'), { tld: 'test', sld: 'acme', base: 'mail.acme' });
  });
  test('rejects single-label domains', () => {
    assert.equal(splitDomain('localhost'), null);
  });
  test('public suffix: registrant label is above the two-level suffix', () => {
    assert.deepEqual(splitDomain('acme.co.uk'), { tld: 'co.uk', sld: 'acme', base: 'acme' });
    assert.deepEqual(splitDomain('mail.acme.com.au'), { tld: 'com.au', sld: 'acme', base: 'mail.acme' });
  });
  test('suffixes beyond any hand-maintained set parse correctly (full PSL)', () => {
    // co.id is in the Public Suffix List but was missing from the old
    // hardcoded two-level set — the psl library must handle it
    assert.deepEqual(splitDomain('acme.co.id'), { tld: 'co.id', sld: 'acme', base: 'acme' });
    assert.deepEqual(splitDomain('shop.acme.com.br'), { tld: 'com.br', sld: 'acme', base: 'shop.acme' });
  });
  test('suffix-only input has no registrant label', () => {
    assert.equal(splitDomain('co.uk'), null);
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
  test('first 24 candidates include every mutation family', () => {
    // for a long sld, swaps+drops alone would exceed the budget; the
    // round-robin merge must keep homoglyph and affix candidates in
    const first = generateCandidates('abcdefghijklm').slice(0, 24);
    assert.ok(first.includes('abcd3fghijklm'), 'homoglyph present in first 24');
    assert.ok(first.includes('secureabcdefghijklm'), 'affix present in first 24');
    assert.ok(first.includes('bcdefghijklm'), 'drop present in first 24');
    assert.ok(first.includes('bacdefghijklm'), 'swap present in first 24');
  });
});

describe('generateTldSwaps', () => {
  test('swaps exclude the current tld', () => {
    const s = generateTldSwaps('com');
    assert.ok(s.includes('net'));
    assert.ok(!s.includes('com'));
  });
  test('multi-label public suffixes keep their suffix', () => {
    assert.deepEqual(generateTldSwaps('co.uk'), []);
  });
});

describe('TyposquatDetector', () => {
  const fakeAnalyzer = (registrations) => {
    const rdapFetch = async (url) => {
      const domain = url.replace('https://rdap.org/domain/', '');
      if (!(domain in registrations)) throw new Error('unexpected target: ' + domain);
      return { status: registrations[domain], body: '', redirects: 1 };
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
    const r = await detector.analyze('acme.test');
    assert.ok(r.threats.some((t) => t.message.includes('acm.test')));
    assert.ok(r.threats.some((t) => t.message.includes('acme.io')));
    assert.ok(r.candidates.some((c) => c.domain === 'acm3.test' && c.status === 'unregistered'));
    assert.match(r.summary, /registered lookalike/);
  });

  test('bootstrap 404 (no redirect) is an error, not unregistered', async () => {
    const detector = new TyposquatDetector({ rdapFetch: async () => ({ status: 404, body: '', redirects: 0 }) });
    const r = await detector.checkRegistration('acm.test');
    assert.equal(r, 'error');
  });

  test('authoritative 404 (after redirect) is unregistered', async () => {
    const detector = new TyposquatDetector({ rdapFetch: async () => ({ status: 404, body: '', redirects: 1 }) });
    assert.equal(await detector.checkRegistration('acm.test'), 'unregistered');
  });

  test('public suffix domains generate candidates under the same suffix', async () => {
    const detector = fakeAnalyzer({ 'acm.co.uk': 200, 'acme.io': 200 });
    const r = await detector.analyze('acme.co.uk');
    assert.ok(r.threats.some((t) => t.message.includes('acm.co.uk')));
    // tld swaps are skipped for multi-label suffixes: no acme.io probe
    assert.ok(!r.candidates.some((c) => c.domain === 'acme.io'));
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

describe('defaultRdapFetch — redirect transport', () => {
  test('follows rdap.org-style 302 bootstrap redirects to the registry', async () => {
    const key = fs.readFileSync(path.join(__dirname, 'fixtures/rdap/key.pem'));
    const cert = fs.readFileSync(path.join(__dirname, 'fixtures/rdap/cert.pem'));
    const ca = cert; // self-signed, its own trust anchor
    const hits = [];
    let closes = 0; // sockets closed server-side for dead-end paths
    const streamUntilClose = (req, res, loc) => {
      // a valid Location makes the hop a genuine redirect-limit dead-end;
      // omitting it (noloc) instead tests the missing-Location dead-end
      res.writeHead(302, loc ? { Location: loc } : {});
      const iv = setInterval(() => res.write('x'), 50);
      req.socket.on('close', () => { closes += 1; });
      req.on('close', () => clearInterval(iv));
    };
    const server = https.createServer({ key, cert }, (req, res) => {
      hits.push(req.url);
      if (req.url === '/domain/boot.test') {
        res.writeHead(302, { Location: '/registry/boot.test' });
        res.end();
      } else if (req.url === '/registry/boot.test') {
        res.writeHead(200, { 'Content-Type': 'application/rdap+json' });
        res.end('{"objectClassName":"domain"}');
      } else if (req.url === '/domain/noservice.test') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"errorCode":404}');
      } else if (req.url === '/domain/badloc.test') {
        res.writeHead(302, { Location: 'http://' });
        res.end();
      } else if (req.url === '/domain/noloc.test') {
        // 302 with no Location — streams forever until the client destroys it
        streamUntilClose(req, res, null);
      } else if (req.url.startsWith('/loop')) {
        const n = Number(req.url.slice(5)) || 0;
        if (n < 4) {
          // hops 0-3 are followed; the 5th response (n=4) is the
          // MAX_REDIRECTS dead-end and must be destroyed by the client
          res.writeHead(302, { Location: `/loop${n + 1}` });
          res.end();
        } else {
          // dead-end hop with a VALID Location — the redirect limit,
          // not a missing header, is what stops the chain here
          streamUntilClose(req, res, `/loop${n + 1}`);
        }
      } else if (req.url === '/domain/flood.test') {
        res.writeHead(302, { Location: '/registry/boot.test' });
        // slow-drip a huge redirect body; the size cap must cut it off
        res.write('x'.repeat(300 * 1024));
        const iv = setInterval(() => res.write('x'.repeat(64 * 1024)), 50);
        req.on('close', () => clearInterval(iv));
      } else {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `https://localhost:${server.address().port}`;
    try {
      const ok = await defaultRdapFetch(`${base}/domain/boot.test`, { ca });
      assert.equal(ok.status, 200);
      assert.equal(ok.redirects, 1);
      assert.deepEqual(hits, ['/domain/boot.test', '/registry/boot.test']);

      const miss = await defaultRdapFetch(`${base}/domain/noservice.test`, { ca });
      assert.equal(miss.status, 404);
      assert.equal(miss.redirects, 0); // bootstrap miss, never redirected

      await assert.rejects(
        () => defaultRdapFetch(`${base}/domain/badloc.test`, { ca }),
        Error,
        'malformed Location must reject, not crash'
      );

      await assert.rejects(
        () => defaultRdapFetch(`${base}/domain/noloc.test`, { ca }),
        /missing Location/,
        '302 without Location must destroy the request and reject'
      );

      await assert.rejects(
        () => defaultRdapFetch(`${base}/loop0`, { ca }),
        /redirect chain too long/,
        'chains beyond MAX_REDIRECTS must destroy the request and reject'
      );

      // both dead-end responses streamed forever; the client must have
      // destroyed their connections, which the server observes as closes
      const t0 = Date.now();
      while (closes < 2 && Date.now() - t0 < 2000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(closes >= 2, `dead-end sockets must be destroyed (observed ${closes} closes)`);

      await assert.rejects(
        () => defaultRdapFetch(`${base}/domain/flood.test`, { ca }),
        /redirect body too large/,
        'redirect body must respect the size cap'
      );
    } finally {
      server.close();
    }
  });
});
