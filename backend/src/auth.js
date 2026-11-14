const crypto = require('crypto');
const db = require('./db/database');

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXUSEMAIL_JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS || '86400', 10);

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('Set JWT_SECRET or NEXUSEMAIL_JWT_SECRET before running NexusEmail in production');
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS };
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
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    // Any base64 / JSON parse failure on a malformed token = no auth.
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!password || !stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
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
    const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
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
    req.user = user;
    req.orgId = user.org_id;
    next();
  } catch (err) {
    // Express 4 does not forward rejected async middleware — forward manually.
    next(err);
  }
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

module.exports = { sign, verifyToken, hashPassword, verifyPassword, publicUser, requireAuth, requireRole, requirePlatformAdmin };
