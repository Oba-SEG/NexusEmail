const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DkimAnalyzer, DEFAULT_SELECTORS, parseSubjectPublicKeyInfo } = require('../src/services/dkimAnalyzer');

function spkiB64(keyPair) {
  return keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// RFC 8463 §3: Ed25519 DKIM keys publish the RAW 32-byte public key.
function rawEd25519B64(keyPair) {
  const der = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  return der.slice(-32).toString('base64');
}

// Minimal DER length encoding (short + long form)
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, n >> 8, n & 0xff]);
}

// Assemble a hand-built SPKI DER: SEQ { SEQ { OID oidBytes, NULL }, BITSTRING keyData }
function customSpki(oidBytes, keyData) {
  const oidTlv = Buffer.concat([Buffer.from([0x06, oidBytes.length]), Buffer.from(oidBytes)]);
  const algBody = Buffer.concat([oidTlv, Buffer.from([0x05, 0x00])]);
  const algSeq = Buffer.concat([Buffer.from([0x30]), derLen(algBody.length), algBody]);
  const bitBody = Buffer.concat([Buffer.from([0x00]), keyData]);
  const bitString = Buffer.concat([Buffer.from([0x03]), derLen(bitBody.length), bitBody]);
  const inner = Buffer.concat([algSeq, bitString]);
  return Buffer.concat([Buffer.from([0x30]), derLen(inner.length), inner]);
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

  test('rejects a valid RSA structure with an unsupported algorithm OID', () => {
    const modulus = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(256, 0xc1)]);
    const modInt = Buffer.concat([Buffer.from([0x02]), derLen(modulus.length), modulus]);
    const expInt = Buffer.from([0x02, 0x03, 0x01, 0x00, 0x01]);
    const intBody = Buffer.concat([modInt, expInt]);
    const intSeq = Buffer.concat([Buffer.from([0x30]), derLen(intBody.length), intBody]);
    // OID 1.2 (content bytes 2a) — well-formed RSA payload, wrong OID
    const der = customSpki([0x2a], intSeq);
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects a BIT STRING whose declared length exceeds the buffer', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const der = Buffer.from(spkiB64(kp), 'base64');
    // layout: 30 2a 30 05 06 03 2b 65 70 | 03 21 00 <32 key bytes>
    assert.equal(der[9], 0x03);
    assert.equal(der[10], 0x21); // 1 unused byte + 32 key bytes
    der[10] = 0x22; // declare one byte more than exists
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects an exponent tag with no length bytes', () => {
    // SEQ { INTEGER modulus, INTEGER tag only — buffer ends after 0x02 }
    const modulus = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(256, 0xc1)]);
    const modInt = Buffer.concat([Buffer.from([0x02]), derLen(modulus.length), modulus]);
    const intBody = Buffer.concat([modInt, Buffer.from([0x02])]);
    const intSeq = Buffer.concat([Buffer.from([0x30]), derLen(intBody.length), intBody]);
    const der = customSpki(
      [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
      intSeq
    );
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects an RSA key with no public exponent INTEGER', () => {
    // SEQ { INTEGER modulus } — exponent removed. High bit set → exactly
    // one 0x00 sign byte, so the fixture is otherwise well-formed DER.
    const modulus = Buffer.alloc(256, 0xc1);
    const intBody = Buffer.concat([Buffer.from([0x00]), modulus]);
    const modInt = Buffer.concat([Buffer.from([0x02]), derLen(intBody.length), intBody]);
    const intSeq = Buffer.concat([Buffer.from([0x30]), derLen(modInt.length), modInt]);
    const der = customSpki(
      [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
      intSeq
    );
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects a zero-length outer SEQUENCE followed by a full body', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const valid = Buffer.from(spkiB64(kp), 'base64');
    // `30 00` claims an empty outer SEQUENCE, then a complete SPKI body
    const der = Buffer.concat([Buffer.from([0x30, 0x00]), valid.slice(2)]);
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects an outer SEQUENCE that excludes the BIT STRING', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const der = Buffer.from(spkiB64(kp), 'base64');
    der[1] = 0x07; // outer len 7 stops before the BIT STRING field
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects an outer SEQUENCE length that excludes a trailing key byte', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const der = Buffer.from(spkiB64(kp), 'base64');
    der[1] = 0x29; // outer len 41 — last key byte now outside the SEQUENCE
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('rejects an AlgorithmIdentifier that swallows the BIT STRING', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const der = Buffer.from(spkiB64(kp), 'base64');
    der[3] = 0x28; // AlgId len 40 extends over the BIT STRING field
    assert.equal(parseSubjectPublicKeyInfo(der), null);
  });

  test('parses a hand-built RSA SPKI with modulus and exponent', () => {
    const modulus = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(256, 0xc1)]);
    const exponent = Buffer.from([0x01, 0x00, 0x01]);
    const modInt = Buffer.concat([Buffer.from([0x02]), derLen(modulus.length), modulus]);
    const expInt = Buffer.concat([Buffer.from([0x02, 0x03]), exponent]);
    const intBody = Buffer.concat([modInt, expInt]);
    const intSeq = Buffer.concat([Buffer.from([0x30]), derLen(intBody.length), intBody]);
    const der = customSpki(
      [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
      intSeq
    );
    const parsed = parseSubjectPublicKeyInfo(der);
    assert.equal(parsed.algorithm, 'rsa');
    assert.equal(parsed.bits, 2048);
  });

  test('rejects an SPKI-wrapped Ed25519 key that is not exactly 32 bytes', () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const raw = kp.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const short = customSpki([0x2b, 0x65, 0x70], raw.slice(0, 31));
    assert.equal(parseSubjectPublicKeyInfo(short), null);
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
      'default._domainkey.example.com': [[`v=DKIM1; k=ed25519; p=${rawEd25519B64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].algorithm, 'Ed25519');
    assert.equal(r.selectors[0].keySize, '256-bit');
    assert.equal(r.score, 30);
  });

  test('SPKI-wrapped Ed25519 still parses with an RFC 8463 warning', async () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; k=ed25519; p=${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].algorithm, 'Ed25519');
    assert.equal(r.selectors[0].keySize, '256-bit');
    assert.match(r.warnings.join(' '), /SPKI-wrapped/);
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

  test('k=rsa with Ed25519 key data is an error (wrong key type)', async () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; k=rsa; p=${rawEd25519B64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].valid, false);
    assert.match(r.errors.join(' '), /could not be parsed/);
  });

  test('duplicate tag names make the record invalid (RFC 6376 §3.2)', async () => {
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [['v=DKIM1; p=; p=']],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].valid, false);
    assert.match(r.errors.join(' '), /duplicate tag/);
  });

  test('tag names are case-sensitive: P= is not p=', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; P=extension; k=rsa; p=${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].valid, true);
    assert.equal(r.selectors[0].keySize, '2048-bit');
  });

  test('whitespace before the p= separator is accepted', async () => {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [[`v=DKIM1; k=rsa; p =${spkiB64(kp)}`]],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.found, true);
    assert.equal(r.selectors[0].keySize, '2048-bit');
  });

  test('base64 padding not at the end of p= is rejected', async () => {
    const v = fakeAnalyzer({
      'default._domainkey.example.com': [['v=DKIM1; k=rsa; p==AAAA']],
    });
    const r = await v.analyze('example.com');
    assert.equal(r.selectors[0].valid, false);
    assert.match(r.errors.join(' '), /not valid base64/);
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
