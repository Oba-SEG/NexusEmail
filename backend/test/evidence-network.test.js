const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateIp, validateTargetUrl, resolveSafeTarget } = require('../src/services/evidence/network');
const { collectDns, collectRdap } = require('../src/services/evidence/collectors');

test('evidence isPrivateIp blocks internal address ranges', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
    '2002:7f00:1::',
    'fec0::1',
  ]) {
    assert.equal(isPrivateIp(address), true, `expected ${address} to be blocked`);
  }
});

test('evidence isPrivateIp allows public addresses', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808']) {
    assert.equal(isPrivateIp(address), false, `expected ${address} to be allowed`);
  }
});

test('validateTargetUrl rejects unsupported and internal targets', () => {
  for (const value of [
    'ftp://example.com/file',
    'http://user:pass@example.com/',
    'http://example.com:8080/',
    'http://localhost/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://metadata.google.internal/',
    'http://foo.internal/',
  ]) {
    assert.throws(() => validateTargetUrl(value), `expected ${value} to be rejected`);
  }
  assert.equal(validateTargetUrl('https://example.com/path?q=1').hostname, 'example.com');
});

test('resolveSafeTarget rejects localhost before any network request', async () => {
  await assert.rejects(() => resolveSafeTarget('http://localhost/'));
});

test('DNS and RDAP collectors refuse internal hostnames without querying them', async () => {
  for (const collector of [collectDns, collectRdap]) {
    const result = await collector({ domain: 'localhost' });
    assert.equal(result.status, 'skipped');
    assert.match(result.metadata.reason, /not allowed/);
  }
});
