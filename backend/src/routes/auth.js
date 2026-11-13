const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { sign, verifyPassword, publicUser, requireAuth, requireRole, requirePlatformAdmin, hashPassword } = require('../auth');
const { captureException } = require('../capture');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.getUserByEmail(email || '');
  if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (process.env.AUTH_MODE === 'whmcs' && user.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Hosted clients must sign in through WHMCS' });
  }
  const token = sign({ sub: user.id, org_id: user.org_id, role: user.role });
  res.json({ token, user: await publicUser(user) });
});

router.post('/whmcs-exchange', async (req, res) => {
  const crypto = require('crypto');
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const settingKey = `whmcs_login:${tokenHash}`;
  const stored = await db.getSetting(settingKey);
  await db.deleteSetting(settingKey);

  if (!stored) return res.status(401).json({ error: 'Invalid or expired login token' });
  let exchange;
  try { exchange = JSON.parse(stored); } catch { return res.status(401).json({ error: 'Invalid or expired login token' }); }
  if (!exchange?.userId || exchange.expiresAt < Date.now()) return res.status(401).json({ error: 'Invalid or expired login token' });

  const user = await db.getUser(exchange.userId);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid user' });
  const org = await db.getOrganization(user.org_id);
  if (!org || (org.status && org.status !== 'active')) return res.status(403).json({ error: 'Organization is not active' });

  const jwt = sign({ sub: user.id, org_id: user.org_id, role: user.role, source: 'whmcs' });
  res.json({ token: jwt, user: await publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await publicUser(req.user) });
});

router.get('/organization/users', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const users = await db.getUsers(req.orgId);
  res.json(await Promise.all(users.map((u) => publicUser(u))));
});

router.post('/organization/users', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
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
});

// Segbytes-hosted admin: create a client organization and first owner.
router.post('/organizations', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { name, slug, owner_email, owner_name, owner_password } = req.body;
  if (!name || !slug || !owner_email || !owner_password) {
    return res.status(400).json({ error: 'name, slug, owner_email and owner_password are required' });
  }
  if (await db.getOrganization(slug)) return res.status(409).json({ error: 'Organization already exists' });
  if (await db.getUserByEmail(owner_email)) return res.status(409).json({ error: 'Owner user already exists' });

  const org = await db.addOrganization({ slug: slug.toLowerCase().trim(), name: name.trim() });
  const owner = await db.addUser({
    org_id: org.id,
    email: owner_email.toLowerCase().trim(),
    name: owner_name || owner_email,
    role: 'owner',
    password_hash: hashPassword(owner_password)
  });
  res.status(201).json({ organization: org, owner: await publicUser(owner) });
});

module.exports = router;
