const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db/database');
const { sign, verifyToken, setSessionCookie, parseCookies } = require('../auth');
const provisioning = require('../services/provisioning');
const {
  googleConfig, randomToken, buildAuthUrl, exchangeCode, verifyGoogleIdToken
} = require('../services/googleAuth');

const OAUTH_COOKIE = 'nexus_oauth';
const OAUTH_PATH = '/api/auth/google';
const OAUTH_TTL_SECONDS = 600;

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Google sign-in attempts, try again later' }
});

function stateCookieOptions(req, maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure,
    path: OAUTH_PATH,
    maxAge
  };
}

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3002', 'http://localhost:3000'])
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function parseHttpUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return parseHttpUrl(origin)?.origin || null;
  const referer = req.get('referer');
  if (referer) return parseHttpUrl(referer)?.origin || null;
  return null;
}

// Pick the frontend to return to. Only origins that are already trusted by
// CORS may be used, so this cannot become an open redirect.
function resolveAppRedirect(req, config) {
  const allowed = allowedOrigins();
  const requested = parseHttpUrl(typeof req.query.return_to === 'string' ? req.query.return_to : '')?.origin;
  if (requested && allowed.includes(requested)) return requested;
  const fromRequest = requestOrigin(req);
  if (fromRequest && allowed.includes(fromRequest)) return fromRequest;
  const explicit = parseHttpUrl(config.appRedirect);
  if (explicit) return explicit.toString();
  if (allowed[0]) return allowed[0];
  return null;
}

function appRedirectUrl(config) {
  return parseHttpUrl(config.appRedirect) || parseHttpUrl(allowedOrigins()[0]);
}

function failRedirect(res, config, code) {
  const target = appRedirectUrl(config);
  if (!target) return res.status(503).send('Google sign-in is not configured');
  target.searchParams.set('auth_error', code);
  return res.redirect(302, target.toString());
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.get('/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ enabled: googleConfig().enabled });
});

router.get('/start', oauthLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const config = googleConfig();
  const appRedirect = resolveAppRedirect(req, config);
  if (!config.enabled || !appRedirect) {
    return res.status(503).json({ error: 'Google sign-in is not configured' });
  }
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const stateToken = sign({ kind: 'google_oauth', state, verifier, nonce, appRedirect }, OAUTH_TTL_SECONDS);
  res.cookie(OAUTH_COOKIE, stateToken, stateCookieOptions(req, OAUTH_TTL_SECONDS * 1000));
  const url = buildAuthUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state, nonce, verifier });
  res.redirect(302, url);
});

router.get('/callback', oauthLimiter, async (req, res, next) => {
  const config = googleConfig();
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!config.enabled) return failRedirect(res, config, 'google_unavailable');
    if (req.query.error) return failRedirect(res, config, 'google_cancelled');

    const stateCookie = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: OAUTH_PATH, httpOnly: true, sameSite: 'lax', secure: !!req.secure });
    const saved = verifyToken(stateCookie);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!saved || saved.kind !== 'google_oauth' || !code || !safeEqual(saved.state, state)) {
      return failRedirect(res, config, 'google_failed');
    }

    let payload;
    try {
      const idToken = await exchangeCode({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        verifier: saved.verifier
      });
      payload = await verifyGoogleIdToken(idToken, { clientId: config.clientId, nonce: saved.nonce });
    } catch (err) {
      if (err.code === 'email_unverified') return failRedirect(res, config, 'google_email_unverified');
      console.warn('[google-auth] sign-in failed:', err.message);
      return failRedirect(res, config, 'google_failed');
    }

    const email = payload.email.trim().toLowerCase();
    const googleSub = String(payload.sub || '');
    if (!googleSub) return failRedirect(res, config, 'google_failed');

    let user = await db.getUserByGoogleSub(googleSub);
    if (!user) {
      const existing = await db.getUserByEmail(email);
      if (existing) {
        // Never attach Google to a password account silently: account
        // pre-hijacking would otherwise survive the link.
        return failRedirect(res, config, 'google_account_exists');
      }
      const name = String(payload.name || email.split('@')[0]).trim().slice(0, 80);
      const workspaceName = `${name}'s workspace`.slice(0, 80);
      const slug = await provisioning.uniqueSlug(workspaceName);
      try {
        user = await db.withTransaction(async (tx) => {
          const org = await db.addOrganization({ name: workspaceName, slug }, tx);
          const owner = await db.addUser({
            org_id: org.id,
            email,
            name,
            role: 'owner',
            password_hash: null,
            google_sub: googleSub
          }, tx);
          await db.insertAuditLog({
            actorUserId: owner.id,
            actorEmail: email,
            action: 'auth.google.registered',
            targetOrgId: org.id,
            detail: { slug: org.slug, name: org.name }
          }, tx);
          return owner;
        });
      } catch (e) {
        if (e.code !== '23505') throw e;
        user = await db.getUserByGoogleSub(googleSub);
        if (!user) return failRedirect(res, config, 'google_account_exists');
      }
    }

    if (user.status !== 'active') return failRedirect(res, config, 'google_suspended');

    const token = sign({ sub: user.id, org_id: user.org_id, role: user.role, tv: user.token_version ?? 1 });
    setSessionCookie(req, res, token);
    // The redirect target was chosen from the allowlist at /start and is
    // carried in the signed state token; re-validate before using it.
    const target = parseHttpUrl(saved.appRedirect);
    if (!target) return failRedirect(res, config, 'google_failed');
    return res.redirect(302, target.toString());
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
