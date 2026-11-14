const crypto = require('crypto');

// Encryption for secret-bearing settings rows (provider credentials, SMTP
// password, Resend API key, Slack webhook). Values at rest are
//   v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
// encrypted with AES-256-GCM under a key derived from NEXUSEMAIL_ENCRYPTION_KEY.
//
// The derived key is cached at module scope. This is key material, not
// application state: it is derived only from the env var and never holds
// customer data, so it does not conflict with the no-in-memory-state rule.

const SECRET_SETTING_KEYS = new Set([
  'provider_credentials',
  'smtp_config',
  'resend_config',
  'slack_webhook'
]);

const DERIVATION_SALT = 'nexusemail:secrets:v1';

function isSecretKey(key) {
  return SECRET_SETTING_KEYS.has(key);
}

function hasEncryptionKey() {
  return Boolean(process.env.NEXUSEMAIL_ENCRYPTION_KEY);
}

let derivedKeyCache = null;
function deriveKey() {
  if (derivedKeyCache) return derivedKeyCache;
  const secret = process.env.NEXUSEMAIL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('NEXUSEMAIL_ENCRYPTION_KEY is not configured');
  }
  derivedKeyCache = crypto.scryptSync(secret, DERIVATION_SALT, 32);
  return derivedKeyCache;
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ct.toString('base64')
  ].join(':');
}

function decryptSecret(stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognized secret envelope');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

// True when the stored value carries the v1 envelope.
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('v1:');
}

module.exports = {
  SECRET_SETTING_KEYS,
  isSecretKey,
  hasEncryptionKey,
  encryptSecret,
  decryptSecret,
  isEncrypted
};
