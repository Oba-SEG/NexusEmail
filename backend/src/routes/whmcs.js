const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const { publicUser, hashPassword } = require('../auth');
const { captureException } = require('../capture');

function configuredToken() {
  return process.env.WHMCS_API_TOKEN || process.env.NEXUSEMAIL_WHMCS_API_TOKEN || '';
}

function configuredHmacSecret() {
  return process.env.WHMCS_WEBHOOK_SECRET || process.env.NEXUSEMAIL_WHMCS_WEBHOOK_SECRET || '';
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function authorized(req) {
  const configured = configuredToken();
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (configured && token && safeEqual(token, configured)) return true;

  const secret = configuredHmacSecret();
  if (!secret) return false;
  const timestamp = req.headers['x-whmcs-timestamp'];
  const nonce = req.headers['x-whmcs-nonce'];
  const signature = String(req.headers['x-whmcs-signature'] || '').replace(/^sha256=/, '');
  if (!timestamp || !nonce || !signature) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;

  const body = JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  const ok = safeEqual(signature, expected);
  if (!ok) return false;
  // Replay protection: claim the nonce atomically (unique constraint). Two
  // copies of the same signed request can no longer both pass.
  return db.claimNonce(nonce);
}

async function requireWhmcs(req, res, next) {
  if (process.env.NODE_ENV === 'production' && !configuredToken() && !configuredHmacSecret()) {
    return res.status(500).json({ success: false, error: 'WHMCS server-to-server auth is not configured' });
  }
  try {
    const authed = await authorized(req);
    if (!authed) return res.status(401).json({ success: false, error: 'Unauthorized' });
    next();
  } catch (err) {
    next(err);
  }
}

function slugify(value) {
  return String(value || 'client').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || `client-${Date.now()}`;
}

async function orgForClient(clientId) {
  if (!clientId) return null;
  return await db.getOrganizationByWhmcsClient(String(clientId));
}

function validateUserOrg(user, org) {
  if (!user) return null;
  if (user.org_id !== org.id) {
    const err = new Error('Email is already linked to a different organization');
    err.status = 409;
    throw err;
  }
  return user;
}

async function ensureOrganization(payload) {
  const clientId = String(payload.clientId || payload.client_id || '').trim();
  if (!clientId) throw new Error('Missing field: clientId');
  const updates = {
    whmcs_service_id: payload.serviceId || payload.service_id || null,
    plan: payload.plan || 'trial',
    name: payload.companyName || payload.company || `WHMCS Client ${clientId}`,
    status: 'active'
  };
  const existing = await orgForClient(clientId);
  if (existing) return await db.updateOrganization(existing.id, { ...updates, whmcs_client_id: clientId, slug: existing.slug });

  const baseSlug = slugify(payload.slug || payload.companyName || payload.company || `whmcs-${clientId}`);
  const slug = await db.getOrganization(baseSlug) ? slugify(`${baseSlug}-${clientId}`) : baseSlug;
  return await db.addOrganization({
    slug,
    name: updates.name,
    whmcs_client_id: clientId,
    whmcs_service_id: updates.whmcs_service_id,
    plan: updates.plan,
    status: 'active'
  });
}

async function ensureOwner(org, payload) {
  const email = String(payload.adminEmail || payload.email || '').toLowerCase().trim();
  if (!email) return null;
  const contactId = payload.contactId || payload.contact_id || null;
  const existing = validateUserOrg((await db.getUserByWhmcsContact(org.whmcs_client_id, contactId, email)) || (await db.getUserByEmail(email)), org);
  if (existing) return existing;
  return await db.addUser({
    org_id: org.id,
    email,
    name: payload.adminName || payload.contactName || email,
    role: 'owner',
    whmcs_client_id: org.whmcs_client_id,
    whmcs_contact_id: contactId,
    password_hash: hashPassword(crypto.randomBytes(24).toString('base64url'))
  });
}

function requestPayload(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

async function lifecycle(req, res, status) {
  try {
    const payload = requestPayload(req);
    const org = await orgForClient(payload.clientId || payload.client_id);
    if (!org) return res.status(404).json({ success: false, error: 'Organization not found' });
    const updated = await db.updateOrganization(org.id, { status });
    res.json({ success: true, organization: updated });
  } catch (err) {
    captureException(err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
}

router.post('/provision', requireWhmcs, async (req, res) => {
  try {
    const payload = requestPayload(req);
    const org = await ensureOrganization(payload);
    const owner = await ensureOwner(org, payload);
    res.json({ success: true, organization: org, owner: owner ? await publicUser(owner) : null });
  } catch (error) {
    captureException(error);
    res.status(error.status || 400).json({ success: false, error: error.message });
  }
});

router.post('/suspend', requireWhmcs, async (req, res) => lifecycle(req, res, 'suspended'));
router.post('/unsuspend', requireWhmcs, async (req, res) => lifecycle(req, res, 'active'));
router.post('/terminate', requireWhmcs, async (req, res) => lifecycle(req, res, 'cancelled'));

router.post('/login-token', requireWhmcs, async (req, res) => {
  try {
    const payload = requestPayload(req);
    const org = await ensureOrganization(payload);
    const email = String(payload.email || payload.adminEmail || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ success: false, error: 'Missing field: email' });

    const contactId = payload.contactId || payload.contact_id || null;
    const contactUser = await db.getUserByWhmcsContact(org.whmcs_client_id, contactId, email);
    let user = validateUserOrg(contactUser || (await db.getUserByEmail(email)), org);
    if (!user) {
      user = await db.addUser({
        org_id: org.id,
        email,
        name: payload.name || payload.contactName || email,
        role: ['owner', 'admin', 'member'].includes(payload.role) ? payload.role : 'member',
        whmcs_client_id: org.whmcs_client_id,
        whmcs_contact_id: contactId,
        password_hash: hashPassword(crypto.randomBytes(24).toString('base64url'))
      });
    }

    if (org.status && org.status !== 'active') return res.status(403).json({ success: false, error: 'Organization is not active' });
    const exchangeToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(exchangeToken).digest('hex');
    await db.setSetting(`whmcs_login:${tokenHash}`, JSON.stringify({ userId: user.id, expiresAt: Date.now() + 2 * 60 * 1000 }));
    res.json({ success: true, token: exchangeToken, expiresIn: 120, user: await publicUser(user) });
  } catch (error) {
    captureException(error);
    res.status(error.status || 400).json({ success: false, error: error.message });
  }
});

router.get('/status/:clientId', requireWhmcs, async (req, res, next) => {
  try {
    const org = await orgForClient(req.params.clientId);
    if (!org) return res.status(404).json({ success: false, error: 'Organization not found' });
    const users = await db.getUsers(org.id);
    const domains = await db.getDomains(org.id);
    res.json({ success: true, organization: org, users: await Promise.all(users.map((u) => publicUser(u))), domains: domains.length });
  } catch (err) { next(err); }
});

module.exports = router;
