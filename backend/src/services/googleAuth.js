const crypto = require('crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

let jwksCache = { keys: null, expiresAt: 0 };

function googleConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  const appRedirect = (process.env.GOOGLE_APP_REDIRECT || '').trim();
  return {
    clientId,
    clientSecret,
    redirectUri,
    appRedirect,
    enabled: !!(clientId && clientSecret && redirectUri)
  };
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function codeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function buildAuthUrl({ clientId, redirectUri, state, nonce, verifier }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri, verifier, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier
  });
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id_token) {
    const err = new Error('Google code exchange failed');
    err.code = 'exchange_failed';
    throw err;
  }
  return data.id_token;
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function parseMaxAge(header, fallback = 3600) {
  const match = /max-age=(\d+)/i.exec(header || '');
  return match ? Number(match[1]) : fallback;
}

async function getGoogleKeys({ force = false, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (!force && jwksCache.keys && now < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetchImpl(JWKS_ENDPOINT, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Google key fetch failed');
  const data = await res.json();
  if (!Array.isArray(data?.keys) || data.keys.length === 0) throw new Error('Google key response was empty');
  const ttl = parseMaxAge(res.headers.get('cache-control'));
  jwksCache = { keys: data.keys, expiresAt: now + Math.max(60, ttl) * 1000 };
  return jwksCache.keys;
}

function verifyIdToken(idToken, { clientId, nonce, keys, now = Math.floor(Date.now() / 1000) }) {
  if (typeof idToken !== 'string') throw new Error('Missing ID token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');

  const header = decodeSegment(parts[0]);
  if (header?.alg !== 'RS256' || !header.kid) throw new Error('Unexpected signature algorithm');
  const key = (keys || []).find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!key) throw new Error('Unknown signing key');

  const signature = Buffer.from(parts[2], 'base64url');
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key, format: 'jwk' }),
    signature
  );
  if (!valid) throw new Error('Invalid ID token signature');

  const payload = decodeSegment(parts[1]);
  if (!GOOGLE_ISSUERS.has(payload?.iss)) throw new Error('Unexpected token issuer');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) throw new Error('Unexpected token audience');
  if (!Number.isInteger(payload.exp) || payload.exp <= now - 60) throw new Error('ID token expired');
  if (!Number.isInteger(payload.iat) || payload.iat > now + 60) throw new Error('ID token issued in the future');
  if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch');
  if (!payload.email || typeof payload.email !== 'string') throw new Error('ID token has no email');
  if (!(payload.email_verified === true || payload.email_verified === 'true')) {
    const err = new Error('Google email is not verified');
    err.code = 'email_unverified';
    throw err;
  }
  return payload;
}

async function verifyGoogleIdToken(idToken, { clientId, nonce }) {
  let keys = await getGoogleKeys();
  try {
    return verifyIdToken(idToken, { clientId, nonce, keys });
  } catch (err) {
    if (!/signing key/i.test(err.message)) throw err;
    keys = await getGoogleKeys({ force: true });
    return verifyIdToken(idToken, { clientId, nonce, keys });
  }
}

module.exports = {
  googleConfig,
  randomToken,
  codeChallenge,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
  verifyGoogleIdToken,
  getGoogleKeys
};
