const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyIdToken, buildAuthUrl, codeChallenge } = require('../src/services/googleAuth');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const keys = [jwk];
const clientId = 'client-123';
const nonce = 'nonce-abc';
const now = 1_800_000_000;

function b64(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function signToken(payload, header = { alg: 'RS256', typ: 'JWT', kid: 'test-key' }) {
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}
function claims(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'google-sub-1',
    email: 'owner@example.test',
    email_verified: true,
    nonce,
    iat: now - 10,
    exp: now + 300,
    ...overrides
  };
}

test('a valid Google ID token verifies and returns its claims', () => {
  const payload = verifyIdToken(signToken(claims()), { clientId, nonce, keys, now });
  assert.equal(payload.email, 'owner@example.test');
  assert.equal(payload.sub, 'google-sub-1');
});

test('a tampered signature is rejected', () => {
  const token = signToken(claims());
  const parts = token.split('.');
  parts[2] = `${parts[2].slice(0, -2)}AA`;
  assert.throws(() => verifyIdToken(parts.join('.'), { clientId, nonce, keys, now }), /signature/);
});

test('expired, wrong-audience, wrong-nonce and forged-issuer tokens are rejected', () => {
  assert.throws(() => verifyIdToken(signToken(claims({ exp: now - 120 })), { clientId, nonce, keys, now }), /expired/);
  assert.throws(() => verifyIdToken(signToken(claims({ aud: 'other-client' })), { clientId, nonce, keys, now }), /audience/);
  assert.throws(() => verifyIdToken(signToken(claims({ nonce: 'other' })), { clientId, nonce, keys, now }), /nonce/);
  assert.throws(() => verifyIdToken(signToken(claims({ iss: 'https://evil.example' })), { clientId, nonce, keys, now }), /issuer/);
});

test('an unverified Google email is rejected with a distinct code', () => {
  assert.throws(
    () => verifyIdToken(signToken(claims({ email_verified: false })), { clientId, nonce, keys, now }),
    (err) => err.code === 'email_unverified'
  );
});

test('the consent URL carries state, nonce and an S256 PKCE challenge', () => {
  const url = new URL(buildAuthUrl({ clientId, redirectUri: 'https://api.example/auth/google/callback', state: 'state-1', nonce, verifier: 'verifier-1' }));
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('nonce'), nonce);
  assert.equal(url.searchParams.get('code_challenge'), codeChallenge('verifier-1'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
});
