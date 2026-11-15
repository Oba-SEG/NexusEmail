// Regression coverage for domain TXT verification locations.
// Run with: npm test  (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { DomainVerificationService } = require('../src/services/domainVerification');

const DOMAIN = 'example.com';
const PREFIXED = `_nexusemail-verification.${DOMAIN}`;
const TOKEN = 'a'.repeat(32);

// resolveTxt returns one entry per record, each an array of string chunks.
function makeService(txt, cname) {
  return new DomainVerificationService({
    txtResolver: async (name) => {
      if (!(name in (txt || {}))) throw new Error(`queryTxt ENOTFOUND ${name}`);
      return txt[name];
    },
    cnameResolver: async (name) => {
      if (!(name in (cname || {}))) throw new Error(`queryCname ENOTFOUND ${name}`);
      return cname[name];
    }
  });
}

test('TXT record at the instructed name with full "<prefix>=<token>" value verifies', async () => {
  const svc = makeService({ [PREFIXED]: [[`${'_nexusemail-verification'}=${TOKEN}`]] });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, true);
  assert.equal(r.method, 'TXT');
});

test('TXT record at the instructed name with bare-token value verifies', async () => {
  const svc = makeService({ [PREFIXED]: [[TOKEN]] });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, true);
});

test('apex fallback: token-containing TXT on the apex still verifies', async () => {
  const svc = makeService({ [DOMAIN]: [['v=spf1 -all'], [TOKEN]] });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, true);
});

test('instructed-name lookup may fail while the apex verifies', async () => {
  const svc = makeService({ [DOMAIN]: [[`_nexusemail-verification=${TOKEN}`]] });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, true);
});

test('wrong token anywhere -> not verified', async () => {
  const svc = makeService({
    [PREFIXED]: [['_nexusemail-verification=deadbeef']],
    [DOMAIN]: [['deadbeef']]
  });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'TXT record not found');
});

test('both lookups fail -> reason is the DNS error', async () => {
  const svc = makeService({});
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, false);
  assert.match(r.reason, /ENOTFOUND/);
});

test('no record at either location -> TXT record not found', async () => {
  const svc = makeService({
    [PREFIXED]: [['v=spf1 -all']],
    [DOMAIN]: [['v=spf1 -all']]
  });
  const r = await svc.verifyTXTRecord(DOMAIN, TOKEN);
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'TXT record not found');
});

test('CNAME verification at verify.<domain> accepts the token target', async () => {
  const svc = makeService({}, { [`verify.${DOMAIN}`]: [`${TOKEN}.verification.nexusemail.local`] });
  const r = await svc.verifyCNAMERecord(`verify.${DOMAIN}`, TOKEN);
  assert.equal(r.verified, true);
  assert.equal(r.method, 'CNAME');
});

test('AUTO method: TXT miss falls through to CNAME', async () => {
  const svc = makeService(
    { [DOMAIN]: [['v=spf1 -all']] },
    { [`verify.${DOMAIN}`]: [`${TOKEN}.verification.nexusemail.local`] }
  );
  const r = await svc.verify(DOMAIN, TOKEN, 'AUTO');
  assert.equal(r.verified, true);
  assert.equal(r.method, 'CNAME');
});

test('AUTO method: TXT hit at the instructed name returns TXT immediately', async () => {
  const svc = makeService({ [PREFIXED]: [[`_nexusemail-verification=${TOKEN}`]] });
  const r = await svc.verify(DOMAIN, TOKEN, 'AUTO');
  assert.equal(r.verified, true);
  assert.equal(r.method, 'TXT');
  assert.ok(r.verified_at);
});

test('generateVerification instructions reference the name that verifyTXTRecord checks', async () => {
  const svc = new DomainVerificationService({});
  const v = svc.generateVerification(DOMAIN);
  assert.equal(v.instructions.txt.includes('_nexusemail-verification'), true);
  assert.equal(v.record, `_nexusemail-verification=${v.token}`);
});
