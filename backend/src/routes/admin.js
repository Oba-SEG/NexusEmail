const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requirePlatformAdmin, hashPassword } = require('../auth');

// Every route in this module reads customer data. Gate the whole router so
// a route added later can never ship ungated — the mount in index.js only
// adds requireAuth on top.
router.use(requirePlatformAdmin);

// Fail-closed audit: the access row is awaited BEFORE the response. A failed
// audit write fails the request instead of serving unaudited customer data.
async function audit(req, action, targetOrgId, detail) {
  await db.insertAuditLog({
    actorUserId: req.user.id,
    actorEmail: req.user.email,
    action,
    targetOrgId,
    detail
  });
}

function maskSecret(value) {
  if (value && typeof value === 'string' && value.length > 4) return value.substring(0, 4) + '****';
  return value ? '****' : null;
}

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
    const safe = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      platform_role: u.platform_role || null,
      status: u.status,
      created_at: u.created_at,
      updated_at: u.updated_at
    }));
    await audit(req, 'admin.organization.users', org.id, { count: safe.length });
    res.json(safe);
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
    await db.setUserPassword(user.id, hashPassword(password));
    await audit(req, 'admin.user.password_set', org.id, { user_id: user.id, user_email: user.email });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
