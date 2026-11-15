const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { SpfValidator } = require('../src/services/spfValidator');

// Fake zone: TXT records keyed by name, shape matches dns.resolveTxt
// (array of records, each an array of <=255-byte string chunks).
function fakeValidator(zone, opts = {}) {
  const a = new Set(opts.a || []);
  const aaaa = new Set(opts.aaaa || []);
  const mx = new Set(opts.mx || []);
  let txtCalls = 0;
  const mkErr = (name, code) => {
    const e = new Error(`${code} ${name}`);
    e.code = code;
    return e;
  };
  const txtResolver = async (name) => {
    txtCalls += 1;
    if (!(name in zone)) throw mkErr(name, 'ENOTFOUND');
    if (zone[name] === 'SERVFAIL') throw mkErr(name, 'ESERVFAIL');
    return zone[name];
  };
  const aResolver = async (name) => {
    if (opts.aFail) throw mkErr(name, opts.aFail);
    if (!a.has(name)) throw mkErr(name, 'ENOTFOUND');
    return ['192.0.2.1'];
  };
  const aaaaResolver = async (name) => {
    if (!aaaa.has(name)) throw mkErr(name, 'ENOTFOUND');
    return ['2001:db8::1'];
  };
  const mxResolver = async (name) => {
    if (!mx.has(name)) throw mkErr(name, 'ENOTFOUND');
    return [{ exchange: 'mx1.example.com', priority: 10 }];
  };
  const v = new SpfValidator({
    txtResolver, aResolver, aaaaResolver, mxResolver,
    ...opts.constructor,
  });
  v.txtCallCount = () => txtCalls;
  return v;
}

describe('SpfValidator — apex record resolution', () => {
  test('finds SPF at the domain apex, not _spf.<domain>', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:_spf.google.com ~all']],
      '_spf.google.com': [['v=spf1 ~all']],
      '_spf.example.com': [['v=spf1 +all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.policy, 'softfail');
    assert.equal(r.lookupCount, 1);
    assert.equal(r.valid, true);
  });

  test('apex TXT without SPF record -> not found, clear error', async () => {
    const v = fakeValidator({ 'example.com': [['some other txt=1']] });
    const r = await v.validate('example.com');
    assert.equal(r.found, false);
    assert.deepEqual(r.errors, ['No SPF record found']);
  });

  test('duplicate apex SPF records -> permerror', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 ~all'], ['v=spf1 -all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.duplicateRecords, 1);
    assert.match(r.errors.join(' '), /Multiple SPF records/);
    assert.equal(r.valid, false);
  });

  test('v=spf10 is not an SPF record (version token needs a boundary)', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf10 -all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, false);
    assert.deepEqual(r.errors, ['No SPF record found']);
  });

  test('apex SERVFAIL is a DNS failure, not "No SPF record found"', async () => {
    const v = fakeValidator({ 'example.com': 'SERVFAIL' });
    const r = await v.validate('example.com');
    assert.equal(r.found, false);
    assert.match(r.errors.join(' '), /DNS lookup failed/);
    assert.doesNotMatch(r.errors.join(' '), /No SPF record found/);
  });
});

describe('SpfValidator — chunked TXT reconstruction', () => {
  test('byte-chunked records concatenate without inserted spaces', async () => {
    // A >255-byte record split by the wire format mid-token: the record
    // is the plain concatenation of its chunks.
    const v = fakeValidator({
      'example.com': [[
        'v=spf1 ip4:198.51.100.1 ip4:198.51.100.2 ip4:198.51.1',
        '00.3 -all',
      ]],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.policy, 'hardfail');
    assert.equal(r.mechanisms.length, 3);
    assert.equal(r.valid, true);
  });

  test('author-split chunks are NOT space-repaired into records the domain did not publish', async () => {
    // One record chunked as "v=spf1" + "-all" concatenates to "v=spf1-all",
    // which does not satisfy the version grammar (v=spf1 must be followed
    // by SP) — so the validator must NOT fabricate a valid hardfail record.
    const v = fakeValidator({
      'example.com': [['v=spf1', '-all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, false);
    assert.equal(r.policy, null);
  });
});

describe('SpfValidator — include chain recursion', () => {
  test('follows includes recursively and counts each hop', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:one.example.com include:one.example.com ~all']],
      'one.example.com': [['v=spf1 include:two.example.com ~all']],
      'two.example.com': [['v=spf1 ~all']],
    });
    const r = await v.validate('example.com');
    // Same include used twice: counted twice (RFC), but not a "loop".
    assert.equal(r.lookupCount, 4);
    assert.equal(r.includes.filter((i) => i.domain === 'one.example.com').length, 2);
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  test('11 include hops exceed the 10-lookup limit', async () => {
    const zone = { 'example.com': [['v=spf1 include:h1.example.com ~all']] };
    for (let i = 1; i <= 11; i++) {
      zone[`h${i}.example.com`] = [['v=spf1', ` include:h${i + 1}.example.com ~all`]];
    }
    const v = fakeValidator(zone);
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 11);
    assert.match(r.errors.join(' '), /exceeds 10 DNS lookup limit \(found 11\)/);
    assert.equal(r.valid, false);
  });

  test('include pointing at nonexistent domain -> dead include error + void', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:dead.example.com ~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /include:dead\.example\.com domain does not exist/);
    assert.equal(r.voidLookups, 1);
    assert.equal(r.valid, false);
  });

  test('include target SERVFAIL is a DNS failure, not a void lookup', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:broken.example.com ~all']],
      'broken.example.com': 'SERVFAIL',
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /DNS lookup failed/);
    assert.equal(r.voidLookups, 0);
    assert.equal(r.valid, false);
  });

  test('include target without an SPF record -> permerror', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:nospf.example.com ~all']],
      'nospf.example.com': [['some=txt but not spf']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /does not contain an SPF record/);
    assert.equal(r.valid, false);
  });

  test('include loop is detected along the recursion path', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:a.example.com ~all']],
      'a.example.com': [['v=spf1 include:b.example.com ~all']],
      'b.example.com': [['v=spf1 include:a.example.com ~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /loop detected/);
    assert.equal(r.valid, false);
  });

  test('legitimate DAG (two branches include the same record) is NOT a loop', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:a.example.com include:b.example.com ~all']],
      'a.example.com': [['v=spf1 include:shared.example.com ~all']],
      'b.example.com': [['v=spf1 include:shared.example.com ~all']],
      'shared.example.com': [['v=spf1 ~all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
    // Lookups count per evaluation, not per unique target: include:a (1),
    // include:b (1), shared evaluated from both branches (2) = 4.
    assert.equal(r.lookupCount, 4);
  });

  test('DNS work stops once the lookup budget is exhausted (no exponential storm)', async () => {
    const zone = { 'example.com': [['v=spf1 include:i1.example.com include:i2.example.com include:i3.example.com include:i4.example.com include:i5.example.com include:i6.example.com include:i7.example.com include:i8.example.com include:i9.example.com include:i10.example.com ~all']] };
    for (let i = 1; i <= 10; i++) {
      const tokens = [];
      for (let c = 1; c <= 10; c++) {
        const leaf = `i${i}c${c}.example.com`;
        tokens.push(`include:${leaf}`);
        zone[leaf] = [['v=spf1 ~all']];
      }
      zone[`i${i}.example.com`] = [['v=spf1 ' + tokens.join(' ') + ' ~all']];
    }
    const v = fakeValidator(zone);
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /exceeds 10 DNS lookup limit/);
    // 100 distinct include targets exist; a naive evaluator would query
    // all of them (plus root). Budget guard must keep DNS work near the
    // limit instead of exploding.
    assert.ok(v.txtCallCount() < 20, `txt calls: ${v.txtCallCount()}`);
    assert.equal(r.valid, false);
  });
});

describe('SpfValidator — policies and mechanisms', () => {
  test('-all hardfail / ~all softfail / ?all neutral warning', async () => {
    const hard = await fakeValidator({ 'a.com': [['v=spf1 -all']] }).validate('a.com');
    assert.equal(hard.policy, 'hardfail');
    const soft = await fakeValidator({ 'b.com': [['v=spf1 ~all']] }).validate('b.com');
    assert.equal(soft.policy, 'softfail');
    const neutral = await fakeValidator({ 'c.com': [['v=spf1 ?all']] }).validate('c.com');
    assert.match(neutral.warnings.join(' '), /Neutral policy/);
    assert.equal(neutral.policy, null);
  });

  test('bare all is +all (qualifier defaults to +)', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 all']] });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /CRITICAL: \+all/);
    assert.equal(r.valid, false);
  });

  test('+all is a critical error anywhere in the chain', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:evil.example.com ~all']],
      'evil.example.com': [['v=spf1 +all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /CRITICAL: \+all/);
    assert.equal(r.valid, false);
  });

  test('-all followed by +all: first all wins, no duplicate critical error', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 -all +all']] });
    const r = await v.validate('example.com');
    assert.equal(r.policy, 'hardfail');
    const criticals = r.errors.filter((e) => e.includes('CRITICAL'));
    assert.equal(criticals.length, 0);
    assert.match(r.warnings.join(' '), /Later all mechanism/);
  });

  test('parsing is case-insensitive (INCLUDE: and -ALL)', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 INCLUDE:dead.example.com -ALL']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /include:dead\.example\.com domain does not exist/);
    assert.equal(r.policy, 'hardfail');
  });

  test('unknown mechanism is a permerror, not silently skipped', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 frobnicate -all']] });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /Unknown SPF mechanism "frobnicate"/);
    assert.equal(r.valid, false);
  });

  test('unknown modifiers are ignored (RFC 7208 section 6)', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 audit=trace -all']] });
    const r = await v.validate('example.com');
    assert.equal(r.valid, true);
    assert.equal(r.policy, 'hardfail');
  });

  test('malformed ip4/ip6 are permerrors', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 ip4:garbage ip6:notanip -all']] });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /Invalid ip4 mechanism "ip4:garbage"/);
    assert.match(r.errors.join(' '), /Invalid ip6 mechanism "ip6:notanip"/);
    assert.equal(r.valid, false);
  });

  test('valid ip4 with CIDR mask is accepted', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 ip4:198.51.100.0/24 -all']] });
    const r = await v.validate('example.com');
    assert.equal(r.valid, true);
    assert.equal(r.mechanisms[0].value, '198.51.100.0/24');
  });

  test('CIDR-only a/24 and mx/24 use the current domain, not an empty name', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1 a/24 mx/24 ~all']],
      },
      { a: ['example.com'], mx: ['example.com'] }
    );
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 2);
    assert.equal(r.voidLookups, 0);
    assert.equal(r.valid, true);
  });

  test('a/mx/exists count lookups and void lookups accumulate', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1 a mx exists:mailhost.example.com ~all']],
        'mailhost.example.com': [['v=spf1 -all']],
      },
      { a: ['example.com'], mx: ['example.com'] }
    );
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 3);
    assert.equal(r.valid, true);
  });

  test('exists performs an A query only (AAAA-only target still counts as void)', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1 exists:host.example.com ~all']],
      },
      { aaaa: ['host.example.com'] }
    );
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 1);
    assert.equal(r.voidLookups, 1);
    assert.match(r.warnings.join(' '), /void lookup/);
  });

  test('a mechanism dual lookup: AAAA answers prevent a false void', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1 a ~all']],
      },
      { aaaa: ['example.com'] }
    );
    const r = await v.validate('example.com');
    assert.equal(r.voidLookups, 0);
    assert.equal(r.valid, true);
  });

  test('a mechanism SERVFAIL on both families is an error, not a void', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1 a:brokenhost.example.com ~all']],
      },
      { aFail: 'ESERVFAIL' }
    );
    const r = await v.validate('example.com');
    assert.equal(r.voidLookups, 0);
    assert.match(r.errors.join(' '), /temporary DNS failure/);
    assert.equal(r.valid, false);
  });

  test('redirect is followed when no all is present and its policy wins', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 redirect=other.example.com']],
      'other.example.com': [['v=spf1 -all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 1);
    assert.equal(r.policy, 'hardfail');
  });

  test('too many void lookups -> permerror', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 a:void1.example.com a:void2.example.com a:void3.example.com ~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /Too many void DNS lookups/);
    assert.equal(r.valid, false);
  });

  test('implicit fallback is neutral ?all, not +all', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1 ip4:198.51.100.7']] });
    const r = await v.validate('example.com');
    assert.match(r.warnings.join(' '), /implicit \?all \(neutral\)/);
    assert.doesNotMatch(r.warnings.join(' '), /\+all allows spoofing/);
    assert.equal(r.policy, null);
  });
});

describe('SpfValidator — include policy isolation', () => {
  test("an include's all never overrides the parent's policy", async () => {
    // Root is ?all (neutral, after the include — all must be last); the
    // included record ends in -all. The parent's all decides (RFC 7208
    // section 5.2): overall policy stays neutral.
    const v = fakeValidator({
      'example.com': [['v=spf1 include:strict.example.com ?all']],
      'strict.example.com': [['v=spf1 -all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.policy, null);
    assert.equal(r.valid, true);
    assert.equal(r.lookupCount, 1);
  });

  test('included record policy is reported per include for visibility', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1 include:strict.example.com ~all']],
      'strict.example.com': [['v=spf1 -all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.policy, 'softfail'); // root's own ~all
    assert.equal(r.includes[0].policy, 'hardfail');
  });
});
