const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { SpfValidator } = require('../src/services/spfValidator');

// Fake zone: TXT records keyed by name, shape matches dns.resolveTxt
// (array of records, each an array of string chunks).
function fakeValidator(zone, opts = {}) {
  const a = new Set(opts.a || []);
  const mx = new Set(opts.mx || []);
  const txtResolver = async (name) => {
    if (!(name in zone)) {
      const e = new Error(`NXDOMAIN ${name}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return zone[name];
  };
  const aResolver = async (name) => {
    if (!a.has(name)) {
      const e = new Error(`NXDOMAIN ${name}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return ['192.0.2.1'];
  };
  const mxResolver = async (name) => {
    if (!mx.has(name)) {
      const e = new Error(`NXDOMAIN ${name}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return [{ exchange: 'mx1.example.com', priority: 10 }];
  };
  return new SpfValidator({ txtResolver, aResolver, mxResolver, ...opts });
}

describe('SpfValidator — chunked TXT reconstruction', () => {
  test('records split at word boundaries are space-joined, not fused', async () => {
    // Zone authors writing quoted strings split at word boundaries; joining
    // with '' would fuse "v=spf1include:...~all" into unparseable garbage.
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:one.example.com', '~all']],
      'one.example.com': [['v=spf1', '-all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.record, 'v=spf1 include:one.example.com ~all');
    assert.equal(r.lookupCount, 1);
    assert.equal(r.valid, true);
  });
});

describe('SpfValidator — apex record resolution', () => {
  test('finds SPF at the domain apex, not _spf.<domain>', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:_spf.google.com', '~all']],
      '_spf.google.com': [['v=spf1', '~all']],
      '_spf.example.com': [['v=spf1', '+all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.policy, 'softfail');
    assert.equal(r.lookupCount, 1); // the google include, nothing else
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
      'example.com': [['v=spf1', '~all'], ['v=spf1', '-all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.found, true);
    assert.equal(r.duplicateRecords, 1);
    assert.match(r.errors.join(' '), /Multiple SPF records/);
    assert.equal(r.valid, false);
  });
});

describe('SpfValidator — include chain recursion', () => {
  test('follows includes recursively and counts each hop', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:one.example.com', 'include:one.example.com', '~all']],
      'one.example.com': [['v=spf1', 'include:two.example.com', '~all']],
      'two.example.com': [['v=spf1', '~all']],
    });
    const r = await v.validate('example.com');
    // Same include used twice: counted twice (RFC), but not a "loop".
    assert.equal(r.lookupCount, 4);
    assert.equal(r.includes.filter((i) => i.domain === 'one.example.com').length, 2);
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  test('11 include hops exceed the 10-lookup limit', async () => {
    const zone = { 'example.com': [['v=spf1', 'include:h1.example.com', '~all']] };
    for (let i = 1; i <= 11; i++) {
      zone[`h${i}.example.com`] = [['v=spf1', `include:h${i + 1}.example.com`, '~all']];
    }
    const v = fakeValidator(zone);
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 11);
    assert.match(r.errors.join(' '), /exceeds 10 DNS lookup limit \(found 11\)/);
    assert.equal(r.valid, false);
  });

  test('include pointing at nonexistent domain -> dead include error + void', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:dead.example.com', '~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /include:dead\.example\.com domain does not exist/);
    assert.equal(r.voidLookups, 1);
    assert.equal(r.valid, false);
  });

  test('include target without an SPF record -> permerror', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:nospf.example.com', '~all']],
      'nospf.example.com': [['some=txt', 'but not spf']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /does not contain an SPF record/);
    assert.equal(r.valid, false);
  });

  test('include loop is detected along the recursion path', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:a.example.com', '~all']],
      'a.example.com': [['v=spf1', 'include:b.example.com', '~all']],
      'b.example.com': [['v=spf1', 'include:a.example.com', '~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /loop detected/);
    assert.equal(r.valid, false);
  });

  test('legitimate DAG (two branches include the same record) is NOT a loop', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:a.example.com', 'include:b.example.com', '~all']],
      'a.example.com': [['v=spf1', 'include:shared.example.com', '~all']],
      'b.example.com': [['v=spf1', 'include:shared.example.com', '~all']],
      'shared.example.com': [['v=spf1', '~all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
    // Lookups count per evaluation, not per unique target: include:a (1),
    // include:b (1), shared evaluated from both branches (2) = 4.
    assert.equal(r.lookupCount, 4);
  });
});

describe('SpfValidator — policies and mechanisms', () => {
  test('-all hardfail / ~all softfail / ?all neutral warning', async () => {
    const hard = await fakeValidator({ 'a.com': [['v=spf1', '-all']] }).validate('a.com');
    assert.equal(hard.policy, 'hardfail');
    const soft = await fakeValidator({ 'b.com': [['v=spf1', '~all']] }).validate('b.com');
    assert.equal(soft.policy, 'softfail');
    const neutral = await fakeValidator({ 'c.com': [['v=spf1', '?all']] }).validate('c.com');
    assert.match(neutral.warnings.join(' '), /Neutral policy/);
  });

  test('+all is a critical error anywhere in the chain', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'include:evil.example.com', '~all']],
      'evil.example.com': [['v=spf1', '+all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /CRITICAL: \+all/);
    assert.equal(r.valid, false);
  });

  test('record with no all and no redirect -> implicit +all warning', async () => {
    const v = fakeValidator({ 'example.com': [['v=spf1', 'ip4:198.51.100.7']] });
    const r = await v.validate('example.com');
    assert.match(r.warnings.join(' '), /implicit \+all/);
  });

  test('a/mx/exists count lookups and void lookups accumulate', async () => {
    const v = fakeValidator(
      {
        'example.com': [['v=spf1', 'a', 'mx', 'exists:mailhost.example.com', '~all']],
        'mailhost.example.com': [['v=spf1', '-all']],
      },
      { a: ['example.com'], mx: ['example.com'] }
    );
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 3);
    assert.equal(r.valid, true);
  });

  test('redirect is followed when no all is present', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'redirect=other.example.com']],
      'other.example.com': [['v=spf1', '-all']],
    });
    const r = await v.validate('example.com');
    assert.equal(r.lookupCount, 1);
    assert.equal(r.policy, 'hardfail');
  });

  test('too many void lookups -> permerror', async () => {
    const v = fakeValidator({
      'example.com': [['v=spf1', 'a:void1.example.com', 'a:void2.example.com', 'a:void3.example.com', '~all']],
    });
    const r = await v.validate('example.com');
    assert.match(r.errors.join(' '), /Too many void DNS lookups/);
    assert.equal(r.valid, false);
  });
});
