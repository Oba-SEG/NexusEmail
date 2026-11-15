const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { MtaStsAnalyzer, parsePolicyFile, isPrivateIp } = require('../src/services/mtaStsAnalyzer');

function analyzer(zone, policyResponse) {
  const txtResolver = async (name) => {
    if (!(name in zone)) {
      const e = new Error(`NXDOMAIN ${name}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return zone[name];
  };
  const fetchPolicy = policyResponse instanceof Error
    ? async () => { throw policyResponse; }
    : async () => policyResponse;
  return new MtaStsAnalyzer({ txtResolver, fetchPolicy });
}

const DNS = [['v=STSv1; id=2024a; mode=enforce; max_age=86400']];
const POLICY = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 86400\nmx: mail.acme.test\n' };

describe('parsePolicyFile', () => {
  test('parses version, mode, max_age and multiple mx lines', () => {
    const p = parsePolicyFile('version: STSv1\nmode: testing\nmax_age: 604800\nmx: a.test\nmx: b.test\n');
    assert.equal(p.version, 'STSv1');
    assert.equal(p.mode, 'testing');
    assert.equal(p.maxAge, '604800');
    assert.deepEqual(p.mx, ['a.test', 'b.test']);
  });

  test('flags unknown fields', () => {
    const p = parsePolicyFile('version: STSv1\nmode: enforce\nmax_age: 604800\nmx: a.test\nwat: yes\n');
    assert.deepEqual(p.unknown, ['wat: yes']);
  });
});

describe('isPrivateIp — SSRF address blocklist', () => {
  test('blocks private, loopback, link-local, CGNAT and v4-mapped forms', () => {
    for (const ip of [
      '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '127.0.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
      '::1', '0:0:0:0:0:0:0:1', '::',
      'fe80::1', 'fe90::1', 'febf::1', 'fec0::1',
      'fc00::1', 'fd12:3456::1',
      '::ffff:169.254.169.254', '::ffff:10.0.0.5',
      '::ffff:a00:1', '::ffff:0a00:0001', '0:0:0:0:0:ffff:0a00:0001',
      'not-an-ip', '::ffff:zz:zz', '2001:db8:',
    ]) {
      assert.equal(isPrivateIp(ip), true, `expected ${ip} to be blocked`);
    }
  });

  test('allows public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', 'fe7f::1', '2001:db8::1']) {
      assert.equal(isPrivateIp(ip), false, `expected ${ip} to be allowed`);
    }
  });
});

describe('MtaStsAnalyzer — DNS + policy fetch', () => {
  test('no DNS record -> found false with the same error as before', async () => {
    const r = await analyzer({}, POLICY).analyze('acme.test');
    assert.equal(r.found, false);
    assert.match(r.errors[0], /No MTA-STS record found/);
    assert.equal(r.score, 0);
  });

  test('DNS record present, policy reachable and consistent -> score 15, no warnings', async () => {
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, POLICY).analyze('acme.test');
    assert.equal(r.found, true);
    assert.equal(r.score, 15);
    assert.equal(r.mode, 'enforce');
    assert.equal(r.maxAge, 86400);
    assert.equal(r.policyFetch.fetched, true);
    assert.deepEqual(r.policyFetch.mx, ['mail.acme.test']);
    assert.equal(r.warnings.length, 0);
    assert.equal(r.errors.length, 0);
  });

  test('testing mode scores 10', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x; mode=testing; max_age=604800']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: testing\nmax_age: 604800\nmx: a.test\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.score, 10);
  });

  test('policy 404 is an error telling the operator to publish or remove the record', async () => {
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, { status: 404, body: '' }).analyze('acme.test');
    assert.equal(r.found, true);
    assert.equal(r.policyFetch.fetched, false);
    assert.equal(r.policyFetch.httpStatus, 404);
    assert.match(r.errors.join(' '), /RFC 8460 §10\.1/);
  });

  test('fetch failure (timeout/DNS) is an unreachable error', async () => {
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, new Error('fetch timeout')).analyze('acme.test');
    assert.equal(r.policyFetch.status, 'unreachable');
    assert.match(r.errors.join(' '), /policy fetch failed/);
  });

  test('policy mode differs from DNS record mode -> warning', async () => {
    const policy = { status: 200, body: 'version: STSv1\nmode: testing\nmax_age: 86400\nmx: a.test\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.warnings.join(' '), /policy file mode \(testing\) differs from DNS record mode \(enforce\)/);
  });

  test('minimal DNS record (v+id only, RFC 8460 shape) scores from the policy file', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=2024a;']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 86400\nmx: a.test\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.mode, 'enforce');
    assert.equal(r.maxAge, 86400);
    assert.equal(r.score, 15);
    assert.equal(r.warnings.length, 0);
  });

  test('policy max_age differs from DNS record max_age -> warning', async () => {
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 604800\nmx: a.test\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.warnings.join(' '), /max_age \(604800s\) differs from DNS record max_age \(86400s\)/);
  });

  test('wrong policy version is an error', async () => {
    const policy = { status: 200, body: 'version: STSv2\nmode: enforce\nmax_age: 86400\nmx: a.test\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.errors.join(' '), /version must be STSv1/);
    // a failed policy earns no points
    assert.equal(r.score, 0);
  });

  test('max_age 0 is a valid zero-lifetime policy (RFC 8461 §3.2)', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x;']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 0\nmx: a.test\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.errors.length, 0);
    assert.equal(r.maxAge, 0);
    assert.equal(r.score, 0); // enforce but under the 86400 scoring threshold
  });

  test('mode none does not require mx lines', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x;']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: none\nmax_age: 86400\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.errors.length, 0);
    assert.equal(r.mode, 'none');
    assert.equal(r.score, 0);
  });

  test('multiple v=STSv1 TXT records are rejected (RFC 8461 §3.1)', async () => {
    const zone = {
      '_mta-sts.acme.test': [
        ['v=STSv1; id=a;'],
        ['v=STSv1; id=b;'],
      ],
    };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.equal(r.found, true);
    assert.match(r.errors.join(' '), /2 MTA-STS TXT records/);
    assert.equal(r.policyFetch.status, 'skipped');
  });

  test('repeated non-mx fields keep their first value (RFC 8461 §3.2)', async () => {
    const p = parsePolicyFile('version: STSv1\nmode: none\nmode: enforce\nmax_age: 604800\nmx: a.test\n');
    assert.equal(p.mode, 'none');
  });

  test('invalid policy mode is an error', async () => {
    const policy = { status: 200, body: 'version: STSv1\nmode: chaos\nmax_age: 86400\nmx: a.test\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.errors.join(' '), /mode must be one of/);
  });

  test('max_age over the 31557600 limit is an error', async () => {
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 31557601\nmx: a.test\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.errors.join(' '), /between 0 and 31557600/);
  });

  test('policy without mx lines is an error', async () => {
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 86400\n' };
    const r = await analyzer({ '_mta-sts.acme.test': DNS }, policy).analyze('acme.test');
    assert.match(r.errors.join(' '), /no mx: lines/);
  });

  test('DNS record without id is an error and stops discovery', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; mode=enforce; max_age=86400']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.equal(r.found, true);
    assert.match(r.errors.join(' '), /id= of 1-32 ASCII alphanumeric/);
    assert.equal(r.policyFetch.status, 'skipped');
    assert.equal(r.score, 0);
  });

  test('id with invalid characters stops discovery', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=bad value!']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.match(r.errors.join(' '), /id= of 1-32 ASCII alphanumeric/);
    assert.equal(r.policyFetch.status, 'skipped');
  });

  test('id over 32 characters stops discovery', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.match(r.errors.join(' '), /id= of 1-32 ASCII alphanumeric/);
  });

  test('v=STSv1 must start the record: mid-record versions are discarded', async () => {
    const zone = { '_mta-sts.acme.test': [['note=example; v=STSv1; id=b;']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.equal(r.found, false);
    assert.match(r.errors.join(' '), /No MTA-STS record found/);
  });

  test('v=STSv1 garbage is not a valid version field', async () => {
    // the garbage record must be discarded without tripping the
    // duplicate-record guard, so the valid record fetches its policy
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=2024a;'], ['v=STSv1 garbage; id=b;']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.equal(r.found, true);
    assert.equal(r.policyFetch.fetched, true);
    assert.equal(r.score, 15);
  });

  test('invalid mx values are policy errors', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x;']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 86400\nmx: bad host!\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.match(r.errors.join(' '), /invalid mx value/);
    assert.equal(r.score, 0);
  });

  test('wildcard mx values are valid', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x;']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 86400\nmx: *.mail.acme.test\nmx: mail.acme.test\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.errors.length, 0);
    assert.equal(r.score, 15);
  });

  test('defaultFetchPolicy rejects a malformed URL without leaking the timer', async () => {
    const { defaultFetchPolicy } = require('../src/services/mtaStsAnalyzer');
    await assert.rejects(() => defaultFetchPolicy('not a url'), Error);
  });

  test('multi-chunk TXT records concatenate', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=2024a; mode=enforce; max_age=8', '6400']] };
    const r = await analyzer(zone, POLICY).analyze('acme.test');
    assert.equal(r.maxAge, 86400);
    assert.equal(r.score, 15);
  });

  test('enforce with max_age below 86400 scores 0', async () => {
    const zone = { '_mta-sts.acme.test': [['v=STSv1; id=x; mode=enforce; max_age=3600']] };
    const policy = { status: 200, body: 'version: STSv1\nmode: enforce\nmax_age: 3600\nmx: a.test\n' };
    const r = await analyzer(zone, policy).analyze('acme.test');
    assert.equal(r.score, 0);
  });
});
