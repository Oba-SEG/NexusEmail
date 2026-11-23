const express = require('express');
const router = express.Router();
const db = require('../db/database');
const {
  sign, verifyPassword, publicUser, requireAuth, requireRole, requirePlatformAdmin,
  hashPassword, setSessionCookie, clearSessionCookie, TOKEN_TTL_SECONDS
} = require('../auth');
const { needsRehash, DUMMY_HASH } = require('../utils/passwords');
const { captureException } = require('../capture');
const provisioning = require('../services/provisioning');
const rateLimit = require('express-rate-limit');

// Credential endpoints get their own tight budget so password guessing
// cannot ride the shared global limit, and so an IP hammering login cannot
// lock everyone out by exhausting the global bucket behind shared egress.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, try again later' }
});

// Self-serve workspaces are far more expensive than a login and are the
// easiest endpoint to farm, so they get their own hourly budget.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many workspace registrations, try again later' }
});

router.post('/login', credentialLimiter, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = email ? await db.getUserByEmail(email) : null;
    // Verify against a dummy hash for unknown accounts so response timing
    // does not reveal whether the email exists.
    const passwordOk = verifyPassword(password, user?.password_hash || DUMMY_HASH);
    if (!user || user.status !== 'active' || !passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (needsRehash(user.password_hash)) {
      await db.updatePasswordHash(user.id, hashPassword(password));
    }
    const token = sign({ sub: user.id, org_id: user.org_id, role: user.role, tv: user.token_version ?? 1 });
    setSessionCookie(req, res, token);
    // The session lives in an httpOnly cookie; never hand the JWT to JS.
    res.json({ user: await publicUser(user) });
  } catch (err) { next(err); }
});

// Self-serve registration: one workspace + its first owner. The org and
// owner are created in a single transaction so a duplicate email or slug can
// never leave an ownerless tenant behind.
router.post('/register', registrationLimiter, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (process.env.REGISTRATION_ENABLED === 'false') {
      return res.status(403).json({ error: 'Self-serve registration is disabled' });
    }
    const organizationName = typeof req.body?.organization_name === 'string' ? req.body.organization_name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const error = provisioning.tenantNameError(organizationName)
      || (!provisioning.isValidEmail(email) ? 'Enter a valid work email.' : null)
      || provisioning.ownerNameError(name)
      || provisioning.passwordError(password);
    if (error) return res.status(400).json({ error });

    if (await db.getUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const slug = await provisioning.uniqueSlug(organizationName);
    let user;
    try {
      user = await db.withTransaction(async (tx) => {
        const org = await db.addOrganization({ name: organizationName, slug }, tx);
        const owner = await db.addUser({
          org_id: org.id,
          email,
          name: name || email,
          role: 'owner',
          password_hash: hashPassword(password)
        }, tx);
        await db.insertAuditLog({
          actorUserId: owner.id,
          actorEmail: email,
          action: 'auth.workspace.registered',
          targetOrgId: org.id,
          detail: { slug: org.slug, name: org.name }
        }, tx);
        return owner;
      });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That workspace or email is already taken' });
      throw e;
    }

    const fresh = await db.getUser(user.id);
    const token = sign({ sub: fresh.id, org_id: fresh.org_id, role: fresh.role, tv: fresh.token_version ?? 1 });
    setSessionCookie(req, res, token);
    res.status(201).json({ user: await publicUser(fresh) });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: await publicUser(req.user) });
  } catch (err) { next(err); }
});

// Logout / session revocation: bumps the user's token_version so every
// previously issued JWT (on any device) stops verifying immediately.
router.post('/revoke', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    // Support signing out of an impersonation session must not revoke the
    // target customer's long-lived sessions. Discard the short-lived
    // impersonation token instead; normal-session revocation is unchanged.
    if (req.actor) {
      return res.json({ success: true, impersonation_ended: true });
    }
    await db.bumpUserTokenVersion(req.user.id);
    clearSessionCookie(req, res);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/organization/users', requireAuth, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const users = await db.getUsers(req.orgId);
    res.json(await Promise.all(users.map((u) => publicUser(u))));
  } catch (err) { next(err); }
});

router.post('/organization/users', requireAuth, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const requestedRole = req.body?.role;
    if (!provisioning.isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const pwError = provisioning.passwordError(password);
    if (pwError) return res.status(400).json({ error: pwError });
    if (provisioning.ownerNameError(name)) return res.status(400).json({ error: 'Name must be 80 characters or fewer.' });
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'User already exists' });
    // An admin must not mint peers or owners above their own role.
    const allowedRoles = req.user.role === 'owner' ? ['owner', 'admin', 'member'] : ['member'];
    const role = allowedRoles.includes(requestedRole) ? requestedRole : 'member';
    const user = await db.addUser({
      org_id: req.orgId,
      email,
      name: name || email,
      role,
      password_hash: hashPassword(password)
    });
    res.status(201).json(await publicUser(user));
  } catch (err) { next(err); }
});

// Segbytes-hosted admin: create a client organization and first owner.
router.post('/organizations', requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const requestedSlug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
    const ownerEmail = typeof req.body?.owner_email === 'string' ? req.body.owner_email.trim().toLowerCase() : '';
    const ownerName = typeof req.body?.owner_name === 'string' ? req.body.owner_name.trim() : '';
    const ownerPassword = typeof req.body?.owner_password === 'string' ? req.body.owner_password : '';
    const error = provisioning.tenantNameError(name)
      || (!provisioning.isValidEmail(ownerEmail) ? 'Enter a valid owner email.' : null)
      || provisioning.ownerNameError(ownerName)
      || provisioning.passwordError(ownerPassword);
    if (error) return res.status(400).json({ error });
    if (requestedSlug && !provisioning.isValidSlug(requestedSlug)) {
      return res.status(400).json({ error: 'Slug must be 2-40 lowercase letters, numbers or hyphens' });
    }
    // The admin UI leaves the slug blank unless an operator overrides it.
    const slug = requestedSlug || await provisioning.uniqueSlug(name);
    if (requestedSlug && await db.getOrganization(slug)) return res.status(409).json({ error: 'Organization already exists' });
    if (await db.getUserByEmail(ownerEmail)) return res.status(409).json({ error: 'Owner user already exists' });

    try {
      // Org + owner in one transaction: a failed owner insert must not leave
      // an ownerless organization behind.
      const { org, owner } = await db.withTransaction(async (tx) => {
        const org = await db.addOrganization({ slug, name }, tx);
        const owner = await db.addUser({
          org_id: org.id,
          email: ownerEmail,
          name: ownerName || ownerEmail,
          role: 'owner',
          password_hash: hashPassword(ownerPassword)
        }, tx);
        return { org, owner };
      });
      res.status(201).json({ organization: org, owner: await publicUser(owner) });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Duplicate organization, user, or email' });
      throw e;
    }
  } catch (err) { next(err); }
});

module.exports = router;
