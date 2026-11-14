const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { sign, verifyPassword, publicUser, requireAuth, requireRole, requirePlatformAdmin, hashPassword } = require('../auth');
const { captureException } = require('../capture');
const rateLimit = require('express-rate-limit');

// Credential endpoints get their own tight budget so password guessing
// cannot ride the shared global limit, and so an IP hammering login cannot
// lock everyone out by exhausting the global bucket behind shared egress.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, try again later' }
});

router.post('/login', credentialLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await db.getUserByEmail(email || '');
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = sign({ sub: user.id, org_id: user.org_id, role: user.role, tv: user.token_version ?? 1 });
    res.json({ token, user: await publicUser(user) });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: await publicUser(req.user) });
  } catch (err) { next(err); }
});

// Logout / session revocation: bumps the user's token_version so every
// previously issued JWT (on any device) stops verifying immediately.
router.post('/revoke', requireAuth, async (req, res, next) => {
  try {
    await db.bumpUserTokenVersion(req.user.id);
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
    const { email, name, role, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'User already exists' });
    const user = await db.addUser({
      org_id: req.orgId,
      email: email.toLowerCase().trim(),
      name: name || email,
      role: ['owner', 'admin', 'member'].includes(role) ? role : 'member',
      password_hash: hashPassword(password)
    });
    res.status(201).json(await publicUser(user));
  } catch (err) { next(err); }
});

// Segbytes-hosted admin: create a client organization and first owner.
router.post('/organizations', requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { name, slug, owner_email, owner_name, owner_password } = req.body;
    if (!name || !slug || !owner_email || !owner_password) {
      return res.status(400).json({ error: 'name, slug, owner_email and owner_password are required' });
    }
    if (await db.getOrganization(slug)) return res.status(409).json({ error: 'Organization already exists' });
    if (await db.getUserByEmail(owner_email)) return res.status(409).json({ error: 'Owner user already exists' });

    try {
      // Org + owner in one transaction: a failed owner insert must not leave
      // an ownerless organization behind.
      const { org, owner } = await db.withTransaction(async (tx) => {
        const org = await db.addOrganization({ slug: slug.toLowerCase().trim(), name: name.trim() }, tx);
        const owner = await db.addUser({
          org_id: org.id,
          email: owner_email.toLowerCase().trim(),
          name: owner_name || owner_email,
          role: 'owner',
          password_hash: hashPassword(owner_password)
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
