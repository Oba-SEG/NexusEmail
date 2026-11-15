const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DkimAnalyzer, DEFAULT_SELECTORS, parseSubjectPublicKeyInfo } = require('../src/services/dkimAnalyzer');

function spkiB64(keyPair) {
  return keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

function dkimRecord(pB64, extra = '') {
  return `v=DKIM1; k=rsa; ${extra ? extra + '; ' : ''}p=${pB64}`;
}

function fakeAnalyzer(zone, selectors = DEFAULT_SELECTORS) {
  const txtResolver = async (name) => {
    if (!(name in zone)) {
      const e = new Error(`NXDOMAIN ${name}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return zone[name];
  };
  return new DkimAnalyzer({ txtResolver, selectors });
}

describe('parseSubjectPublicKeyInfo — DER key decoding', () => {
  test('decodes a real 2048-bit RSA key', () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const parsed = parseSubjectPublicKeyInfo(Buffer.from(spkiB64(kp), 'base64'));
    assert.equal(parsed.algorithm, 'rsa');
    assert.equal(parsed.bits, 2048);
  });

  test('decodes a real 1024-bit RSA key', () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const parsed = parseSubjectPublicKeyInfo(Buffer.from(spkiB64(kp), 'base64'));
    assert.equal(parsed.algorithm, 'rsa');
    assert.equal(parsed.bits, 1024);
  });

  test('decodes an Ed25519 key', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const parsed = parseSubjectPublicKeyInfo(Buffer.from(spkiB64(kp), 'base64'));
    assert.equal(parsed.algorithm, 'ed25519');
    assert.equal(parsed.bits, 256);
  });

  test('rejects garbage DER', () => {
    assert.equal(parseSubjectPublicKeyInfo(Buffer.from('deadbeefdeadbeef', 'hex')), null);
    assert.equal(parseSubjectPublicKeyInfo(Buffer.alloc(0)), null);
  });
});

describe('DkimAnalyzer — selector probing', () => {
  test('finds a 2048-bit RSA key and scores it', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[dkimRecord(spkiB64(kp))]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.found, true);
    assert.equal(r.errors.length, 0);
    assert.equal(r.selectors[0].keySize, '2048-bit');
    assert.equal(r.selectors[0].algorithm, 'RSA');
    assert.equal(r.score, 30); // 20 base + 10 strong key
  });

  test('flags 1024-bit keys as below recommendation', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const v = fakeAnalyzer({
      's1._domainkey.example.com': [[dkimRecord(spkiB64(kp))]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].keySize, '1024-bit');
    assert.match(r.warnings.join(' '), /below recommended 2048-bit/);
    assert.equal(r.score, 25); // 20 + 5 weak
  });

  test('multi-byte chunked TXT records concatenate without spaces', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const b64 = spkiB64(kp);
    // simulate a >255-byte TXT split at a byte boundary mid-base64
    const chunks = [`v=DKIM1; k=rsa; p=${b64.slice(0, 200)}`, b64.slice(200)];
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [chunks],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.found, true);
    assert.equal(r.selectors[0].keySize, '2048-bit');
  });

  test('revoked key (empty p=) is an error', async () => {
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [['v=DKIM1; k=rsa; p=']],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].valid, false);
    assert.match(r.errors.join(' '), /key revoked/);
    assert.equal(r.score, 25); // 20 + 5 unparseable
  });

  test('invalid base64 is an error', async () => {
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [['v=DKIM1; k=rsa; p=@@notbase64@@']],
    });
    const r = await v.analyze('example.com');
    assert.match(r.errors.join(' '), /not valid base64/);
  });

  test('valid base64 garbage DER is an error', async () => {
    const junk = Buffer.from('this is not der at all').toString('base64');
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[dkimRecord(junk)]],
    });
    const r = await v.analyze('example.com');
    assert.match(r.errors.join(' '), /could not be parsed/);
  });

  test('Ed25519 keys are recognized as strong', async () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; k=ed25519; p=${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].algorithm, 'Ed25519');
    assert.equal(r.selectors[0].keySize, '256-bit');
    assert.equal(r.score, 30);
  });

  test('missing v= tag warns, missing k= defaults to rsa', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`k=rsa; p=${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].algorithm, 'RSA');
    assert.match(r.warnings.join(' '), /missing v=DKIM1/);
  });

  test('k= mismatch with the actual key type warns', async () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; k=rsa; p=${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].algorithm, 'Ed25519');
    assert.match(r.warnings.join(' '), /does not match the parsed key type/);
  });

  test('t=y test mode and t=s strict mode are surfaced', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[dkimRecord(spkiB64(kp), 't=y:s')]],
    });
    const r = await v.analyze('example.com');
    const notes = r.selectors[0].notes.join(' ');
    assert.match(notes, /Test mode/);
    assert.match(notes, /Strict mode/);
  });

  test('no DKIM records anywhere -> found false with clear error', async () => {
    const v = fakeAnalyzer({});
    const r = await v.analyze('example.com');
    assert.equal(r.found, false);
    assert.deepEqual(r.errors, ['No DKIM records found']);
    assert.equal(r.score, 0);
  });

  test('multiple selectors each contribute to the score', async () => {
    const k2048 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const k1024 = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const v = fakeAnalyzer({
      'google._domainkey.example.com': [[dkimRecord(spkiB64(k2048))]],
      'default._domainkey.example.com': [[dkimRecord(spkiB64(k1024))]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors.length, 2);
    assert.equal(r.score, 35); // 20 + 10 + 5
  });

  test('selector TXT without p= is ignored (not a DKIM record)', async () => {
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [['some unrelated txt']],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.found, false);
  });
});
