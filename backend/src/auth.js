const crypto = require('crypto');
const db = require('./db/database');
const { hashPassword, verifyPassword } = require('./utils/passwords');

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXUSEMAIL_JWT_SECRET || 'dev-secret-change-me';
// Short-lived bearer/cookie sessions. Every request re-checks token_version,
// so revocation is immediate; 12h bounds the damage of a leaked token.
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS || '43200', 10);
const JWT_ISSUER = 'nexus-brand-protection';
const JWT_AUDIENCE = 'nexus-console';
const SESSION_COOKIE = 'nexus_session';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('Set JWT_SECRET or NEXUSEMAIL_JWT_SECRET before running NexusEmail in production');
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

// AUTH_DISABLED auto-authenticates every request as the first user — a dev
// convenience that must never exist in production.
if (process.env.NODE_ENV === 'production' && process.env.AUTH_DISABLED === 'true') {
  throw new Error('AUTH_DISABLED=true is not allowed in production');
}

if (process.env.AUTH_DISABLED === 'true') {
  console.warn('[auth] AUTH_DISABLED=true: every request authenticates as the first user. Dev use only.');
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, ttlSeconds = TOKEN_TTL_SECONDS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + ttlSeconds };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
    const provided = Buffer.from(parts[2]);
    const expectedBuf = Buffer.from(expected);
    // T163 — crypto.timingSafeEqual throws RangeError on length mismatch,
    // which used to bubble to HTTP 500. Reject malformed tokens cleanly.
    if (provided.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(provided, expectedBuf)) return null;
    let header;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (header?.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.iat > Math.floor(Date.now() / 1000) + 60) return null;
    return payload;
  } catch (e) {
    // Any base64 / JSON parse failure on a malformed token = no auth.
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // A malformed cookie must fail authentication, never 500 the request.
      continue;
    }
  }
  return out;
}

function sessionCookieOptions(req, maxAgeSeconds = TOKEN_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure,
    path: '/',
    maxAge: maxAgeSeconds * 1000
  };
}

function setSessionCookie(req, res, token, maxAgeSeconds = TOKEN_TTL_SECONDS) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req, maxAgeSeconds));
}

function clearSessionCookie(req, res) {
  const { maxAge, ...opts } = sessionCookieOptions(req, 0);
  res.clearCookie(SESSION_COOKIE, opts);
}

async function publicUser(user) {
  if (!user) return null;
  const org = await db.getOrganization(user.org_id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    platform_role: user.platform_role || null,
    has_password: !!user.password_hash,
    org_id: user.org_id,
    organization: org ? { id: org.id, name: org.name, slug: org.slug } : null
  };
}

async function requireAuth(req, res, next) {
  try {
    if (process.env.AUTH_DISABLED === 'true') {
      req.user = (await db.getUsers())[0];
      req.orgId = req.user?.org_id || 'segbytes';
      return next();
    }

    const bearer = req.headers.authorization || '';
    // A bearer token (CLI, tests, impersonation) always wins. Falling back
    // to the cookie after an invalid bearer would silently switch identity.
    const token = bearer.startsWith('Bearer ')
      ? bearer.slice(7)
      : (parseCookies(req.headers.cookie)[SESSION_COOKIE] || null);
    const payload = verifyToken(token);
    if (!payload?.sub) return res.status(401).json({ error: 'Authentication required' });

    const user = await db.getUser(payload.sub);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid user' });
    // Session revocation: tokens carry the user's token_version at issue
    // time; bumping users.token_version (e.g. POST /auth/revoke, password
    // change) invalidates every previously issued token.
    const issuedTv = Number(payload.tv);
    if (!Number.isInteger(issuedTv) || issuedTv !== Number(user.token_version ?? 1)) {
      return res.status(401).json({ error: 'Session revoked; sign in again' });
    }
    req.actor = null;
    if (payload.act) {
      const actor = await db.getUser(payload.act.sub);
      if (!actor || actor.status !== 'active' || actor.platform_role !== 'platform_admin') {
        return res.status(401).json({ error: 'Invalid acting administrator' });
      }
      req.actor = actor;
      req.impersonationExpiresAt = payload.exp;
      if (Number.isInteger(payload.act.tv) && payload.act.tv !== Number(actor.token_version ?? 1)) {
        return res.status(401).json({ error: 'Impersonation session revoked; sign in again' });
      }
    }
    req.user = user;
    req.orgId = user.org_id;
    next();
  } catch (err) {
    // Express 4 does not forward rejected async middleware — forward manually.
    next(err);
  }
}

function auditIdentity(req, detail = {}) {
  return {
    actorUserId: (req.actor || req.user).id,
    actorEmail: (req.actor || req.user).email,
    detail: req.actor ? {
      ...detail,
      impersonated_user: { id: req.user.id, email: req.user.email }
    } : detail
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user || req.user.platform_role !== 'platform_admin') return res.status(403).json({ error: 'Platform admin required' });
  next();
}

module.exports = { auditIdentity, sign, verifyToken, hashPassword, verifyPassword, publicUser, requireAuth, requireRole, requirePlatformAdmin, setSessionCookie, clearSessionCookie, parseCookies, SESSION_COOKIE, TOKEN_TTL_SECONDS, JWT_ISSUER, JWT_AUDIENCE };
