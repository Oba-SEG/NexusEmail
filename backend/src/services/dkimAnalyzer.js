const dns = require('dns').promises;

/**
 * RFC 6376 §5.4/§6.1.2: rsaEncryption and Ed25519 public key OIDs/shapes.
 */
const DEFAULT_SELECTORS = [
  'default', 'google', 'selector1', 'selector2', 'selector3', 'mail',
  'dkim', 'dkim1', 'dkim2', 'smtp', 'mx', 's1', 's2',
  'k1', 'k2', 'brevo1', 'brevo2', 'sendgrid', 'mandrill', 'mailgun',
  'zoho', 'mte1', 'mte2', 'smtp2go', 'svc',
];

/**
 * DKIM analyzer: probes selectors, parses the DKIM key record tags
 * (v/k/h/t flags) and decodes the public key to report its real bit
 * length — replacing the record-length heuristic. DNS access is
 * injectable so tests can run against fake zones.
 */
class DkimAnalyzer {
  constructor({ txtResolver = (name) => dns.resolveTxt(name), selectors = DEFAULT_SELECTORS } = {}) {
    this.txtResolver = txtResolver;
    this.selectors = selectors;
  }

  /** Analyze every known selector for a domain.
   *  Returns { found, selectors, warnings, errors, score }. */
  async analyze(domain) {
    const warnings = [];
    const errors = [];
    const foundSelectors = [];

    await Promise.all(this.selectors.map(async (selector) => {
      let records;
      try {
        records = await this.txtResolver(`${selector}._domainkey.${domain}`);
      } catch (err) {
        return; // selector not published — normal
      }
      if (!records || records.length === 0) return;
      // Chunks are wire-format byte segments; base64 concatenates with ''.
      const candidates = records.map((chunks) => (chunks || []).map(String).join(''));
      const record = candidates.find((r) => this.isDkimRecord(r));
      if (!record) return;
      foundSelectors.push(this.analyzeSelector(selector, record));
    }));

    foundSelectors.sort((a, b) => a.selector.localeCompare(b.selector));
    const result = { found: foundSelectors.length > 0, selectors: foundSelectors, warnings, errors, score: 0 };

    if (!result.found) {
      errors.push('No DKIM records found');
      return result;
    }

    for (const sel of foundSelectors) {
      warnings.push(...sel.warnings.map((w) => `${sel.selector}: ${w}`));
      errors.push(...sel.errors.map((e) => `${sel.selector}: ${e}`));
    }

    // Scoring policy (kept consistent with the audit engine): 20 base
    // points once any selector is found, +10 per strong key (>=2048-bit
    // or Ed25519), +5 for weak or unparseable keys.
    result.score = 20;
    for (const sel of foundSelectors) {
      if (sel.keySize === '2048-bit' || sel.keySize === '3072-bit' || sel.keySize === '4096-bit' || sel.algorithm === 'Ed25519') {
        result.score += 10;
      } else {
        result.score += 5;
      }
    }
    return result;
  }

  /** Parse one selector's DKIM key record into tag/key information. */
  analyzeSelector(selector, record) {
    const info = {
      selector,
      record,
      valid: true,
      keySize: null,
      algorithm: null,
      notes: [],
      warnings: [],
      errors: [],
    };

    const { tags, duplicates } = this.parseTags(record);
    // RFC 6376 §3.2: a tag name occurring twice makes the tag list invalid.
    if (duplicates.length > 0) {
      info.valid = false;
      info.errors.push(`duplicate tag(s) ${duplicates.join(', ')} — record invalid (permerror)`);
      return info;
    }

    if (!tags.v) info.warnings.push('missing v=DKIM1 version tag');
    else if (!/^dkim1$/i.test(tags.v.trim())) info.warnings.push(`unusual version tag v=${tags.v}`);

    const keyType = (tags.k || 'rsa').trim().toLowerCase();
    if (!('p' in tags)) {
      info.valid = false;
      info.errors.push('record has no p= public key tag');
      return info;
    }
    const p = (tags.p || '').replace(/\s+/g, '');

    if (p === '') {
      info.valid = false;
      info.errors.push('key revoked (p= is empty)');
      return info;
    }

    // Base64 padding is only valid at the end of the value.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p)) {
      info.valid = false;
      info.errors.push('public key is not valid base64 (permerror)');
      return info;
    }
    const pBuf = Buffer.from(p, 'base64');
    if (pBuf.length === 0) {
      info.valid = false;
      info.errors.push('public key is not valid base64 (permerror)');
      return info;
    }

    if (keyType === 'ed25519') {
      // RFC 8463: Ed25519 DKIM keys are published as the raw 32-byte
      // public key, not SPKI-wrapped.
      if (pBuf.length === 32) {
        info.algorithm = 'Ed25519';
        info.keySize = '256-bit';
      } else {
        const parsed = parseSubjectPublicKeyInfo(pBuf);
        if (parsed && parsed.algorithm === 'ed25519') {
          info.algorithm = 'Ed25519';
          info.keySize = `${parsed.bits}-bit`;
          info.warnings.push('Ed25519 key is SPKI-wrapped (RFC 8463 expects the raw 32-byte key)');
        } else {
          info.valid = false;
          info.errors.push('public key could not be parsed (permerror)');
        }
      }
      this.applyTimeFlags(info, tags);
      return info;
    }

    if (keyType !== 'rsa') {
      info.warnings.push(`unsupported key type k=${keyType}`);
      info.algorithm = 'Unknown';
      return info;
    }

    const parsed = parseSubjectPublicKeyInfo(pBuf);
    if (!parsed || parsed.algorithm !== 'rsa') {
      info.valid = false;
      info.errors.push('public key could not be parsed (permerror)');
      return info;
    }

    info.algorithm = 'RSA';
    info.keySize = `${parsed.bits}-bit`;
    if (parsed.bits < 2048) {
      info.warnings.push('Key size below recommended 2048-bit');
    }

    this.applyTimeFlags(info, tags);
    return info;
  }

  /** Surface t=y / t=s flags. */
  applyTimeFlags(info, tags) {
    if (!tags.t) return;
    const flags = tags.t.split(':').map((f) => f.trim());
    if (flags.includes('y')) info.notes.push('Test mode (t=y) - not for production');
    if (flags.includes('s')) info.notes.push('Strict mode (t=s) - subdomains not allowed to sign');
  }

  /** True when a TXT value is a DKIM key record (whitespace-tolerant). */
  isDkimRecord(record) {
    const { tags } = this.parseTags(record);
    return 'p' in tags || (!!tags.v && /^dkim1$/i.test(tags.v.trim()));
  }

  /** Split a DKIM key record into lowercase tags; duplicates tracked
   *  separately (RFC 6376 §3.2 makes a tag list with repeats invalid). */
  parseTags(record) {
    const tags = {};
    const seen = new Set();
    const duplicates = [];
    for (const part of record.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      if (!key) continue;
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
      tags[key] = value;
    }
    return { tags, duplicates };
  }
}

/**
 * Parse an X.509 SubjectPublicKeyInfo DER blob.
 * Returns { algorithm: 'rsa'|'ed25519', bits } or null when unparseable.
 */
function parseSubjectPublicKeyInfo(buf) {
  let i = 0;
  const readLen = () => {
    let l = buf[i++];
    if (l & 0x80) {
      const n = l & 0x7f;
      if (n === 0 || n > 2) return null;
      l = 0;
      for (let k = 0; k < n; k++) l = (l << 8) | buf[i++];
    }
    return l;
  };
  if (buf[i++] !== 0x30) return null;
  if (readLen() === null) return null;
  // AlgorithmIdentifier SEQUENCE
  if (buf[i++] !== 0x30) return null;
  if (readLen() === null) return null;
  // Algorithm OID
  if (buf[i++] !== 0x06) return null;
  const oidLen = readLen();
  if (oidLen === null) return null;
  const oid = buf.slice(i, i + oidLen);
  i += oidLen;
  // Optional parameters (RSA: NULL 05 00)
  if (i < buf.length && buf[i] === 0x05) {
    i += 1;
    const pl = readLen();
    if (pl === null) return null;
    i += pl;
  }
  // subjectPublicKey BIT STRING
  if (buf[i++] !== 0x03) return null;
  const bitLen = readLen();
  if (bitLen === null || i >= buf.length) return null;
  const unusedBits = buf[i++];
  if (unusedBits > 7) return null;
  const keyData = buf.slice(i, i + bitLen - 1);
  if (keyData.length === 0) return null;

  if (isEd25519Oid(oid)) {
    return { algorithm: 'ed25519', bits: keyData.length * 8 - unusedBits };
  }
  // Only rsaEncryption keys are decoded as RSA structures.
  if (!isRsaOid(oid)) return null;

  // RSA: subjectPublicKey is SEQUENCE { INTEGER modulus, INTEGER exponent }
  if (keyData[0] !== 0x30) return null;
  let j = 1;
  const readKeyLen = () => {
    let l = keyData[j++];
    if (l & 0x80) {
      const n = l & 0x7f;
      if (n === 0 || n > 2) return null;
      l = 0;
      for (let k = 0; k < n; k++) l = (l << 8) | keyData[j++];
    }
    return l;
  };
  if (readKeyLen() === null) return null;
  if (keyData[j++] !== 0x02) return null;
  const modLen = readKeyLen();
  if (modLen === null || modLen <= 0 || j + modLen > keyData.length) return null;
  let modulus = keyData.slice(j, j + modLen);
  j += modLen;
  // The public exponent INTEGER must be present and fit the key data.
  if (keyData[j++] !== 0x02) return null;
  const expLen = readKeyLen();
  if (expLen === null || expLen <= 0 || j + expLen > keyData.length) return null;
  // DER positive INTEGERs may carry a leading zero byte.
  while (modulus.length > 1 && modulus[0] === 0x00) modulus = modulus.slice(1);
  const first = modulus[0];
  let lead = 0;
  while (lead < 8 && !(first & (0x80 >> lead))) lead += 1;
  const bits = modulus.length * 8 - lead;
  return { algorithm: 'rsa', bits };
}

function isRsaOid(oid) {
  // 1.2.840.113549.1.1.1 — DER content bytes: 2a 86 48 86 f7 0d 01 01 01
  return oid.length === 9 &&
    oid[0] === 0x2a && oid[1] === 0x86 && oid[2] === 0x48 && oid[3] === 0x86 &&
    oid[4] === 0xf7 && oid[5] === 0x0d && oid[6] === 0x01 && oid[7] === 0x01 && oid[8] === 0x01;
}

function isEd25519Oid(oid) {
  // 1.3.101.112 — DER content bytes: 2b 65 70
  return oid.length === 3 && oid[0] === 0x2b && oid[1] === 0x65 && oid[2] === 0x70;
}

module.exports = { DkimAnalyzer, DEFAULT_SELECTORS, parseSubjectPublicKeyInfo };
