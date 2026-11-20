const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auditIdentity, requirePlatformAdmin, hashPassword, sign, publicUser } = require('../auth');
const provisioning = require('../services/provisioning');

// Every route in this module reads customer data. Gate the whole router so
// a route added later can never ship ungated — the mount in index.js only
// adds requireAuth on top.
router.use(requirePlatformAdmin);

// Fail-closed audit: the access row is awaited BEFORE the response. A failed
// audit write fails the request instead of serving unaudited customer data.
async function audit(req, action, targetOrgId, detail, tx) {
  await db.insertAuditLog({
    ...auditIdentity(req, detail),
    action,
    targetOrgId
  }, tx);
}

function maskSecret(value) {
  if (value && typeof value === 'string' && value.length > 4) return value.substring(0, 4) + '****';
  return value ? '****' : null;
}

function safeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    platform_role: u.platform_role || null,
    status: u.status,
    created_at: u.created_at,
    updated_at: u.updated_at
  };
}

const requestedImpersonationTtl = parseInt(process.env.IMPERSONATION_TTL_SECONDS || '1800', 10);
const IMPERSONATION_TTL_SECONDS = Number.isFinite(requestedImpersonationTtl)
  ? Math.min(Math.max(requestedImpersonationTtl, 60), 86400)
  : 1800;

async function requireOrg(req, res) {
  const org = await db.getOrganization(req.params.orgId);
  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return null;
  }
  return org;
}

router.get('/organizations', async (req, res, next) => {
  try {
    const orgs = await db.getOrganizationsWithCounts();
    // Record WHICH orgs were exposed, not just how many — otherwise two
    // different org sets produce identical audit rows.
    await audit(req, 'admin.organizations.list', null, { count: orgs.length, org_ids: orgs.map((o) => o.id) });
    res.json(orgs);
  } catch (err) { next(err); }
});

// Platform admin provisioning: create a tenant, optionally with its first
// owner. Both rows and the audit record commit together.
router.post('/organizations', async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const requestedSlug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
    const ownerEmail = typeof req.body?.owner_email === 'string' ? req.body.owner_email.trim().toLowerCase() : '';
    const ownerName = typeof req.body?.owner_name === 'string' ? req.body.owner_name.trim() : '';
    const ownerPassword = typeof req.body?.owner_password === 'string' ? req.body.owner_password : '';

    const hasOwner = !!(ownerEmail || ownerName || ownerPassword);
    const error = provisioning.tenantNameError(name)
      || (requestedSlug && !provisioning.isValidSlug(requestedSlug) ? 'Slug must be 2-40 lowercase letters, numbers, or hyphens.' : null)
      || provisioning.ownerNameError(ownerName)
      || (hasOwner && !provisioning.isValidEmail(ownerEmail) ? 'Enter a valid owner email.' : null)
      || (hasOwner ? provisioning.passwordError(ownerPassword) : null);
    if (error) return res.status(400).json({ error });

    let slug = requestedSlug;
    if (slug) {
      if (await db.getOrganization(slug)) return res.status(409).json({ error: 'That workspace slug is already taken' });
    } else {
      slug = await provisioning.uniqueSlug(name);
    }
    if (hasOwner && await db.getUserByEmail(ownerEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    try {
      const result = await db.withTransaction(async (tx) => {
        const org = await db.addOrganization({ name, slug }, tx);
        let owner = null;
        if (hasOwner) {
          owner = await db.addUser({
            org_id: org.id,
            email: ownerEmail,
            name: ownerName || ownerEmail,
            role: 'owner',
            password_hash: hashPassword(ownerPassword)
          }, tx);
        }
        await audit(req, 'admin.organization.create', org.id, {
          slug: org.slug,
          name: org.name,
          owner_email: hasOwner ? owner.email : null
        }, tx);
        return { org, owner };
      });
      res.status(201).json({
        organization: { ...result.org, domain_count: 0, user_count: result.owner ? 1 : 0, scan_count: 0, last_activity: null },
        owner: result.owner ? safeUser(result.owner) : null
      });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Duplicate organization, user, or email' });
      throw e;
    }
  } catch (err) { next(err); }
});

router.get('/organizations/:orgId', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const counts = await db.getOrganizationsWithCounts(org.id);
    await audit(req, 'admin.organization.detail', org.id, {});
    res.json({ ...org, counts: counts[0] || null });
  } catch (err) { next(err); }
});

router.get('/organizations/:orgId/domains', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const domains = await db.getDomains(org.id);
    // Same enrichment as the user-facing list: the hydrated domain record
    // carries no score — it lives on the latest scan.
    const result = await Promise.all(domains.map(async (d) => {
      const lastScan = await db.getLatestScan(d.id, org.id);
      return {
        ...d,
        // ?? not ||: a real score of 0 must survive (|| would coerce it to
        // null and the badge would show '—' instead of '0').
        last_score: lastScan?.score ?? null,
        last_scan: lastScan?.scanned_at || null,
        verified: d.verified || false,
        verified_at: d.verified_at || null,
        verification_method: d.verification_method || null
      };
    }));
    await audit(req, 'admin.organization.domains', org.id, { count: result.length });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/organizations/:orgId/users', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const users = await db.getUsers(org.id);
    // Explicit allowlist — never forward the raw row (it carries
    // password_hash and token_version).
    const safe = users.map(safeUser);
    await audit(req, 'admin.organization.users', org.id, { count: safe.length });
    res.json(safe);
  } catch (err) { next(err); }
});

// Create a tenant user. The same global email uniqueness as /auth applies;
// platform_role is deliberately not settable here.
router.post('/organizations/:orgId/users', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = ['owner', 'admin', 'member'].includes(req.body?.role) ? req.body.role : 'member';

    const error = (!provisioning.isValidEmail(email) ? 'Enter a valid email.' : null)
      || provisioning.ownerNameError(name)
      || provisioning.passwordError(password);
    if (error) return res.status(400).json({ error });
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });

    try {
      const user = await db.withTransaction(async (tx) => {
        const created = await db.addUser({
          org_id: org.id,
          email,
          name: name || email,
          role,
          password_hash: hashPassword(password)
        }, tx);
        await audit(req, 'admin.user.create', org.id, { user_id: created.id, user_email: created.email, role }, tx);
        return created;
      });
      res.status(201).json(safeUser(user));
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' });
      throw e;
    }
  } catch (err) { next(err); }
});

// Support impersonation: issue a short-lived token for a tenant user and
// audit the hand-off before the token leaves the server. Platform admins
// cannot be impersonation targets, which keeps the admin identity singular.
router.post('/organizations/:orgId/users/:userId/impersonate', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const user = await db.getUser(req.params.userId);
    if (!user || user.org_id !== org.id) {
      return res.status(404).json({ error: 'User not found in this organization' });
    }
    if (user.status !== 'active') return res.status(400).json({ error: 'User is not active' });
    if (user.platform_role === 'platform_admin') {
      return res.status(400).json({ error: 'Platform administrators cannot be impersonated' });
    }
    await audit(req, 'admin.user.impersonate', org.id, {
      user_id: user.id,
      user_email: user.email,
      expires_in: IMPERSONATION_TTL_SECONDS
    });
    const token = sign({
      sub: user.id,
      org_id: user.org_id,
      role: user.role,
      tv: user.token_version ?? 1,
      imp: true,
      act: { sub: req.user.id, email: req.user.email, tv: req.user.token_version ?? 1 }
    }, IMPERSONATION_TTL_SECONDS);
    res.json({
      token,
      expires_in: IMPERSONATION_TTL_SECONDS,
      user: {
        ...(await publicUser(user)),
        impersonated_by: { id: req.user.id, email: req.user.email, name: req.user.name }
      }
    });
  } catch (err) { next(err); }
});

router.get('/organizations/:orgId/scans', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const scans = await db.getOrgScans(org.id, 100);
    await audit(req, 'admin.organization.scans', org.id, { count: scans.length });
    res.json(scans);
  } catch (err) { next(err); }
});

router.get('/organizations/:orgId/notifications', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const [smtpRaw, resendRaw, slackRaw] = await Promise.all([
      db.getSetting('smtp_config', org.id),
      db.getSetting('resend_config', org.id),
      db.getSetting('slack_webhook', org.id)
    ]);
    let smtp = null;
    if (smtpRaw) {
      try {
        const s = JSON.parse(smtpRaw);
        smtp = { host: s.host || null, port: s.port || null, user: s.user || null, from: s.from || null, pass_configured: !!s.pass };
      } catch { smtp = { parse_error: true }; }
    }
    let resend = null;
    if (resendRaw) {
      try {
        const r = JSON.parse(resendRaw);
        resend = { from: r.from || null, api_key_masked: maskSecret(r.api_key), api_key_configured: !!r.api_key };
      } catch { resend = { parse_error: true }; }
    }
    const slack = slackRaw ? { webhook_masked: maskSecret(slackRaw), configured: true } : { configured: false };
    await audit(req, 'admin.organization.notifications', org.id, {});
    res.json({
      smtp,
      resend,
      slack,
      prefs: {
        notify_scan_completed: await db.getSetting('notify_scan_completed', org.id) !== '0',
        notify_critical_alerts: await db.getSetting('notify_critical_alerts', org.id) !== '0',
        notify_weekly_report: await db.getSetting('notify_weekly_report', org.id) === '1'
      }
    });
  } catch (err) { next(err); }
});

// Admin-initiated password set (issue #43): the recovery path for accounts
// with forgotten or unknown passwords (e.g. admin-provisioned random
// credentials). Path-scoped: the target user must belong to :orgId.
// Sets the hash and bumps token_version (all existing sessions end).
router.post('/organizations/:orgId/users/:userId/password', async (req, res, next) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const user = await db.getUser(req.params.userId);
    if (!user || user.org_id !== org.id) {
      return res.status(404).json({ error: 'User not found in this organization' });
    }
    // Password change + audit row are one transaction: a failed audit
    // insert rolls the password change back, so a 500 can never mean
    // 'password changed but unaudited'.
    await db.withTransaction(async (tx) => {
      await db.setUserPassword(user.id, hashPassword(password), tx);
      await audit(req, 'admin.user.password_set', org.id, { user_id: user.id, user_email: user.email }, tx);
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
