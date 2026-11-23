const crypto = require('crypto');

// OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256, 600,000 iterations.
const ITERATIONS = 600000;
const KEYLEN = 32;
const DIGEST = 'sha256';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = ITERATIONS) {
  const hash = crypto.pbkdf2Sync(password, salt, iterations, KEYLEN, DIGEST).toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function parseStored(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length === 4 && parts[0] === 'pbkdf2') {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1000) return null;
    return { iterations, salt: parts[2], hash: parts[3] };
  }
  // Legacy format: <salt>:<hash> at the original 120,000 iterations.
  if (stored.includes(':')) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return null;
    return { iterations: 120000, salt, hash };
  }
  return null;
}

function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const candidate = crypto
    .pbkdf2Sync(password, parsed.salt, parsed.iterations, KEYLEN, DIGEST)
    .toString('hex');
  const a = Buffer.from(parsed.hash);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function needsRehash(stored) {
  const parsed = parseStored(stored);
  return !parsed || parsed.iterations < ITERATIONS || !stored.startsWith('pbkdf2$');
}

// Equal-cost verification for unknown accounts: keeps login timing from
// revealing whether an email exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

module.exports = { hashPassword, verifyPassword, needsRehash, DUMMY_HASH, ITERATIONS };
