const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Postgres data layer (Render free Postgres in production, a local/Compose
// Postgres in staging). All helpers are async and preserve the exact call
// signatures and response shapes of the previous SQLite layer, so routes and
// services only need `await`.
//
// Connection: DATABASE_URL (Render injects "Internal Database URL" here).
// Set PGSSLREQUIRED=1 when connecting over the public internet.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.INTERNAL_DATABASE_URL,
  max: 10,
  ...(process.env.PGSSLREQUIRED ? { ssl: { rejectUnauthorized: false } } : {}),
});

function now() { return new Date().toISOString(); }
function nextId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; }
let _numericIdCounter = 0;
// Collision-safe numeric primary key. Uses Date.now() * 1000 + a 0-999
// process-local counter so tight loops in the same millisecond (e.g. POST
// /api/domains/bulk) produce monotonically-increasing unique IDs.
function nextNumericId() {
  _numericIdCounter = (_numericIdCounter + 1) % 1000;
  return Date.now() * 1000 + _numericIdCounter;
}
function json(value) { return JSON.stringify(value ?? null); }
function parse(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }

async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}
async function one(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] ?? null;
}
async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function initSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      whmcs_client_id TEXT UNIQUE,
      whmcs_service_id TEXT,
      plan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      platform_role TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      password_hash TEXT,
      whmcs_client_id TEXT,
      whmcs_contact_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS domains (
      id BIGINT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scans (
      id BIGINT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain_id BIGINT NOT NULL,
      data TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id BIGINT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      org_id TEXT NOT NULL DEFAULT 'global',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (org_id, key)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id BIGINT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain_id BIGINT,
      data TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brands (
      id BIGINT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      brand_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      scan_schedule TEXT NOT NULL DEFAULT 'manual',
      alerts_enabled INTEGER NOT NULL DEFAULT 1,
      last_scan TEXT,
      next_scan TEXT,
      last_results TEXT,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brands_org ON brands(org_id);
    CREATE INDEX IF NOT EXISTS idx_brands_org_domain ON brands(org_id, domain);

    CREATE TABLE IF NOT EXISTS brand_threats (
      id BIGINT PRIMARY KEY,
      brand_id BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      threat_type TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      detected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brand_threats_brand ON brand_threats(brand_id);
    CREATE INDEX IF NOT EXISTS idx_brand_threats_org ON brand_threats(org_id);

    CREATE TABLE IF NOT EXISTS brand_takedowns (
      id BIGINT PRIMARY KEY,
      brand_id BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      threat_type TEXT,
      evidence TEXT,
      contact_email TEXT,
      sender_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT,
      abuse_email TEXT,
      email_template TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      notes TEXT,
      submitted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brand_takedowns_brand ON brand_takedowns(brand_id);
    CREATE INDEX IF NOT EXISTS idx_brand_takedowns_org ON brand_takedowns(org_id);

    CREATE TABLE IF NOT EXISTS brand_takedown_replies (
      id BIGINT PRIMARY KEY,
      takedown_id BIGINT NOT NULL REFERENCES brand_takedowns(id) ON DELETE CASCADE,
      brand_id BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      from_email TEXT,
      subject TEXT,
      body TEXT,
      direction TEXT NOT NULL DEFAULT 'incoming',
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brand_replies_takedown ON brand_takedown_replies(takedown_id);

    CREATE TABLE IF NOT EXISTS brand_safe_entries (
      id BIGINT PRIMARY KEY,
      brand_id BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE(brand_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_brand_safe_brand ON brand_safe_entries(brand_id);

    CREATE TABLE IF NOT EXISTS brand_alerts (
      id BIGINT PRIMARY KEY,
      brand_id BIGINT REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      brand_name TEXT,
      alert_type TEXT,
      severity TEXT,
      message TEXT,
      data TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brand_alerts_brand ON brand_alerts(brand_id);
    CREATE INDEX IF NOT EXISTS idx_brand_alerts_org ON brand_alerts(org_id);
  `);
}

function hydrateDomain(row) { return row ? { ...parse(row.data, {}), id: row.id, org_id: row.org_id, created_at: row.created_at, updated_at: row.updated_at } : null; }
function hydrateScan(row) { return row ? { ...parse(row.data, {}), id: row.id, org_id: row.org_id, domain_id: row.domain_id, scanned_at: row.scanned_at } : null; }
function hydrateIntegration(row) { return row ? { ...parse(row.data, {}), id: row.id, org_id: row.org_id, created_at: row.created_at, updated_at: row.updated_at } : null; }
function hydrateReport(row) { return row ? { ...parse(row.data, {}), id: row.id, org_id: row.org_id, domain_id: row.domain_id, generated_at: row.generated_at } : null; }

async function getOrganizations() { return all('SELECT * FROM organizations ORDER BY created_at DESC'); }
async function getOrganization(idOrSlug) { return one('SELECT * FROM organizations WHERE id = $1 OR slug = $1', [idOrSlug]); }
async function getOrganizationByWhmcsClient(clientId) { return one('SELECT * FROM organizations WHERE whmcs_client_id = $1', [String(clientId)]); }
async function addOrganization(org) {
  const created = { id: org.id || nextId('org'), slug: org.slug, name: org.name, status: org.status || 'active', whmcs_client_id: org.whmcs_client_id || null, whmcs_service_id: org.whmcs_service_id || null, plan: org.plan || null, created_at: org.created_at || now(), updated_at: org.updated_at || now() };
  await q('INSERT INTO organizations (id, slug, name, status, whmcs_client_id, whmcs_service_id, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [created.id, created.slug, created.name, created.status, created.whmcs_client_id, created.whmcs_service_id, created.plan, created.created_at, created.updated_at]);
  return created;
}
async function updateOrganization(id, updates) {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  await q('UPDATE organizations SET slug=$2, name=$3, status=$4, whmcs_client_id=$5, whmcs_service_id=$6, plan=$7, updated_at=$8 WHERE id=$1',
    [id, next.slug, next.name, next.status, next.whmcs_client_id, next.whmcs_service_id, next.plan, next.updated_at]);
  return getOrganization(id);
}

async function getUsers(orgId) { return all(orgId ? 'SELECT * FROM users WHERE org_id = $1 ORDER BY created_at DESC' : 'SELECT * FROM users ORDER BY created_at DESC', orgId ? [orgId] : []); }
async function getUser(id) { return one('SELECT * FROM users WHERE id = $1', [id]); }
async function getUserByEmail(email) { return one('SELECT * FROM users WHERE lower(email) = lower($1)', [email || '']); }
async function getUserByWhmcsContact(clientId, contactId, email) {
  if (contactId) {
    return one('SELECT * FROM users WHERE whmcs_client_id = $1 AND whmcs_contact_id = $2', [String(clientId), String(contactId)]);
  }
  return one('SELECT * FROM users WHERE whmcs_client_id = $1 AND lower(email) = lower($2)', [String(clientId), email || '']);
}
async function addUser(user) {
  const created = { id: user.id || nextId('usr'), org_id: user.org_id, email: user.email, name: user.name || user.email, role: user.role || 'member', platform_role: user.platform_role || null, status: user.status || 'active', password_hash: user.password_hash || null, whmcs_client_id: user.whmcs_client_id || null, whmcs_contact_id: user.whmcs_contact_id || null, created_at: user.created_at || now(), updated_at: user.updated_at || now() };
  await q('INSERT INTO users (id, org_id, email, name, role, platform_role, status, password_hash, whmcs_client_id, whmcs_contact_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
    [created.id, created.org_id, created.email, created.name, created.role, created.platform_role, created.status, created.password_hash, created.whmcs_client_id, created.whmcs_contact_id, created.created_at, created.updated_at]);
  return created;
}

async function getDomains(orgId) {
  const rows = await all(orgId ? 'SELECT * FROM domains WHERE org_id = $1 ORDER BY created_at DESC' : 'SELECT * FROM domains ORDER BY created_at DESC', orgId ? [orgId] : []);
  return rows.map(hydrateDomain);
}
async function addDomain(domain, orgId) {
  const created = { ...domain, id: domain.id || nextNumericId(), org_id: orgId || domain.org_id || 'segbytes', created_at: domain.created_at || now(), updated_at: now() };
  await q('INSERT INTO domains (id, org_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [created.id, created.org_id, json(created), created.created_at, created.updated_at]);
  return created;
}
async function getDomain(id, orgId) {
  return hydrateDomain(await one(orgId ? 'SELECT * FROM domains WHERE id = $1 AND org_id = $2' : 'SELECT * FROM domains WHERE id = $1', orgId ? [id, orgId] : [id]));
}
async function updateDomain(id, updates, orgId) {
  const existing = await getDomain(id, orgId);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  await q('UPDATE domains SET data = $2, updated_at = $3 WHERE id = $1 AND org_id = $4', [id, json(next), next.updated_at, next.org_id]);
  return next;
}
async function deleteDomain(id, orgId) {
  if (orgId) {
    await q('DELETE FROM scans WHERE domain_id = $1 AND org_id = $2', [id, orgId]);
    await q('DELETE FROM domains WHERE id = $1 AND org_id = $2', [id, orgId]);
  } else {
    await q('DELETE FROM scans WHERE domain_id = $1', [id]);
    await q('DELETE FROM domains WHERE id = $1', [id]);
  }
}

async function addScan(scan, orgId) {
  const created = { ...scan, id: scan.id || nextNumericId(), org_id: orgId || scan.org_id || 'segbytes', scanned_at: scan.scanned_at || now() };
  await q('INSERT INTO scans (id, org_id, domain_id, data, scanned_at) VALUES ($1, $2, $3, $4, $5)', [created.id, created.org_id, created.domain_id, json(created), created.scanned_at]);
  return created;
}
async function getScans(domainId, limit = 30, orgId) {
  const rows = await all(orgId ? 'SELECT * FROM scans WHERE domain_id = $1 AND org_id = $2 ORDER BY scanned_at DESC LIMIT $3' : 'SELECT * FROM scans WHERE domain_id = $1 ORDER BY scanned_at DESC LIMIT $2', orgId ? [domainId, orgId, limit] : [domainId, limit]);
  return rows.map(hydrateScan).reverse();
}
async function getLatestScan(domainId, orgId) {
  return hydrateScan(await one(orgId ? 'SELECT * FROM scans WHERE domain_id = $1 AND org_id = $2 ORDER BY scanned_at DESC LIMIT 1' : 'SELECT * FROM scans WHERE domain_id = $1 ORDER BY scanned_at DESC LIMIT 1', orgId ? [domainId, orgId] : [domainId]));
}

async function getIntegrations(orgId) {
  const rows = await all(orgId ? 'SELECT * FROM integrations WHERE org_id = $1 ORDER BY created_at DESC' : 'SELECT * FROM integrations ORDER BY created_at DESC', orgId ? [orgId] : []);
  return rows.map(hydrateIntegration);
}
async function addIntegration(integration, orgId) {
  const created = { ...integration, id: integration.id || nextNumericId(), org_id: orgId || integration.org_id || 'segbytes', created_at: integration.created_at || now(), updated_at: now() };
  await q('INSERT INTO integrations (id, org_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [created.id, created.org_id, json(created), created.created_at, created.updated_at]);
  return created;
}
async function deleteIntegration(id, orgId) {
  if (orgId) await q('DELETE FROM integrations WHERE id = $1 AND org_id = $2', [id, orgId]);
  else await q('DELETE FROM integrations WHERE id = $1', [id]);
}

async function getSetting(key, orgId) {
  const row = (await one('SELECT value FROM settings WHERE org_id = $1 AND key = $2', [orgId || 'global', key]))
    || (await one('SELECT value FROM settings WHERE org_id = $1 AND key = $2', ['global', key]));
  return row ? row.value : undefined;
}
async function setSetting(key, value, orgId) {
  await q('INSERT INTO settings (org_id, key, value, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, key) DO UPDATE SET value = $3, updated_at = $4', [orgId || 'global', key, String(value), now()]);
}
async function deleteSetting(key, orgId) {
  await q('DELETE FROM settings WHERE org_id = $1 AND key = $2', [orgId || 'global', key]);
}

async function addReport(report, orgId) {
  const created = { ...report, id: report.id || nextNumericId(), org_id: orgId || report.org_id || 'segbytes', generated_at: report.generated_at || now() };
  await q('INSERT INTO reports (id, org_id, domain_id, data, generated_at) VALUES ($1, $2, $3, $4, $5)', [created.id, created.org_id, created.domain_id || null, json(created), created.generated_at]);
  return created;
}
async function getReports(domainId, orgId) {
  if (domainId) {
    const rows = await all('SELECT * FROM reports WHERE domain_id = $1 AND ($2 IS NULL OR org_id = $2) ORDER BY generated_at DESC', [domainId, orgId || null]);
    return rows.map(hydrateReport);
  }
  const rows = await all('SELECT * FROM reports WHERE ($1 IS NULL OR org_id = $1) ORDER BY generated_at DESC', [orgId || null]);
  return rows.map(hydrateReport);
}

async function migrateLegacyJsonIfNeeded() {
  const row = await one('SELECT COUNT(*)::int AS count FROM organizations');
  if (row.count > 0) return;
  const legacyJsonFile = path.join(process.env.NEXUSEMAIL_DATA_DIR || path.join(__dirname, '../../data'), 'nexusemail.json');
  if (!fs.existsSync(legacyJsonFile)) return;
  const legacy = parse(fs.readFileSync(legacyJsonFile, 'utf8'), {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const org of legacy.organizations || []) await addOrganization(org);
    if (!(await getOrganization('segbytes'))) await addOrganization({ id: 'segbytes', slug: 'segbytes', name: 'Segbytes Solutions' });
    for (const user of legacy.users || []) await addUser(user);
    for (const domain of legacy.domains || []) await addDomain(domain, domain.org_id || 'segbytes');
    for (const scan of legacy.scans || []) await addScan(scan, scan.org_id || 'segbytes');
    for (const integration of legacy.integrations || []) await addIntegration(integration, integration.org_id || 'segbytes');
    for (const [key, value] of Object.entries(legacy.settings || {})) {
      const idx = key.indexOf(':');
      if (idx > 0 && key.startsWith('org_')) await setSetting(key.slice(idx + 1), value, key.slice(0, idx));
      else await setSetting(key, value);
    }
    for (const report of legacy.reports || []) await addReport(report, report.org_id || 'segbytes');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[legacy json migration] failed:', e.message);
  } finally {
    client.release();
  }
}

// T162 — Brand Protection: relational storage helpers + JSON-blob -> rows
// migration. Keeps the same response shape that frontend reads, so the
// frontend doesn't need to change.

function hydrateBrand(row) {
  if (!row) return null;
  return {
    id: row.id,
    org_id: row.org_id,
    domain: row.domain,
    brand_name: row.brand_name,
    status: row.status,
    scan_schedule: row.scan_schedule,
    alerts_enabled: !!row.alerts_enabled,
    last_scan: row.last_scan,
    next_scan: row.next_scan,
    last_results: parse(row.last_results),
    added_at: row.added_at,
    updated_at: row.updated_at,
  };
}
function hydrateThreat(row) {
  if (!row) return null;
  return { id: row.id, brand_id: row.brand_id, org_id: row.org_id, domain: row.domain, threat_type: row.threat_type, severity: row.severity, notes: row.notes, status: row.status, detected_at: row.detected_at };
}
function hydrateTakedown(row) {
  if (!row) return null;
  return {
    id: row.id, brand_id: row.brand_id, org_id: row.org_id, domain: row.domain,
    threat_type: row.threat_type, evidence: parse(row.evidence, {}),
    contact_email: row.contact_email, sender_email: row.sender_email,
    status: row.status, provider: row.provider, abuse_email: row.abuse_email,
    email_template: row.email_template, sent: !!row.sent, sent_at: row.sent_at,
    notes: row.notes || '', submitted_at: row.submitted_at,
  };
}
function hydrateReply(row) {
  if (!row) return null;
  return { id: row.id, takedown_id: row.takedown_id, brand_id: row.brand_id, org_id: row.org_id, from: row.from_email, subject: row.subject, body: row.body, direction: row.direction, timestamp: row.timestamp };
}
function hydrateAlert(row) {
  if (!row) return null;
  const extras = parse(row.data, {}) || {};
  return { id: row.id, brand_id: row.brand_id, org_id: row.org_id, brand_name: row.brand_name, alert_type: row.alert_type, severity: row.severity, message: row.message, acknowledged: !!row.acknowledged, created_at: row.created_at, ...extras };
}

async function getBrands(orgId) {
  if (!orgId) return [];
  const rows = await all('SELECT * FROM brands WHERE org_id = $1 ORDER BY added_at DESC', [orgId]);
  return rows.map(hydrateBrand);
}
async function getBrand(id, orgId) {
  if (!orgId) return null;
  return hydrateBrand(await one('SELECT * FROM brands WHERE id = $1 AND org_id = $2', [id, orgId]));
}
async function getBrandFull(id, orgId) {
  const brand = await getBrand(id, orgId);
  if (!brand) return null;
  brand.threats = await getBrandThreats(id, orgId);
  brand.takedowns = await getBrandTakedowns(id, orgId);
  brand.safe_list = await getBrandSafeList(id, orgId);
  return brand;
}
async function getBrandsFull(orgId) {
  const brands = await getBrands(orgId);
  return Promise.all(brands.map(async (b) => ({
    ...b,
    threats: await getBrandThreats(b.id, orgId),
    takedowns: await getBrandTakedowns(b.id, orgId),
    safe_list: await getBrandSafeList(b.id, orgId),
  })));
}
async function addBrand(brand, orgId) {
  if (!orgId) throw new Error('orgId required to add a brand');
  const created = {
    id: brand.id || nextNumericId(),
    org_id: orgId,
    domain: brand.domain.toLowerCase(),
    brand_name: brand.brand_name || brand.domain.split('.')[0],
    status: brand.status || 'active',
    scan_schedule: brand.scan_schedule || 'manual',
    alerts_enabled: brand.alerts_enabled === false ? 0 : 1,
    last_scan: brand.last_scan || null,
    next_scan: brand.next_scan || null,
    last_results: brand.last_results ? json(brand.last_results) : null,
    added_at: brand.added_at || now(),
    updated_at: now(),
  };
  await q('INSERT INTO brands (id, org_id, domain, brand_name, status, scan_schedule, alerts_enabled, last_scan, next_scan, last_results, added_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
    [created.id, created.org_id, created.domain, created.brand_name, created.status, created.scan_schedule, created.alerts_enabled, created.last_scan, created.next_scan, created.last_results, created.added_at, created.updated_at]);
  return hydrateBrand(await one('SELECT * FROM brands WHERE id = $1', [created.id]));
}
async function updateBrand(id, updates, orgId) {
  const existing = await getBrand(id, orgId);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  await q('UPDATE brands SET domain=$3, brand_name=$4, status=$5, scan_schedule=$6, alerts_enabled=$7, last_scan=$8, next_scan=$9, last_results=$10, updated_at=$11 WHERE id=$1 AND org_id=$2',
    [id, orgId, next.domain, next.brand_name, next.status, next.scan_schedule, next.alerts_enabled ? 1 : 0, next.last_scan || null, next.next_scan || null, next.last_results ? json(next.last_results) : null, next.updated_at]);
  return getBrand(id, orgId);
}
async function deleteBrand(id, orgId) {
  if (!orgId) return false;
  const result = await q('DELETE FROM brands WHERE id = $1 AND org_id = $2', [id, orgId]);
  return result.rowCount > 0;
}

async function getBrandThreats(brandId, orgId) {
  if (!orgId) return [];
  const rows = await all('SELECT * FROM brand_threats WHERE brand_id = $1 AND org_id = $2 ORDER BY detected_at DESC', [brandId, orgId]);
  return rows.map(hydrateThreat);
}
async function addBrandThreat(threat, brandId, orgId) {
  if (!orgId) throw new Error('orgId required');
  const created = {
    id: threat.id || nextNumericId(),
    brand_id: brandId, org_id: orgId,
    domain: threat.domain, threat_type: threat.threat_type || 'manual',
    severity: threat.severity || 'medium', notes: threat.notes || '',
    status: threat.status || 'active', detected_at: threat.detected_at || now(),
  };
  await q('INSERT INTO brand_threats (id, brand_id, org_id, domain, threat_type, severity, notes, status, detected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [created.id, created.brand_id, created.org_id, created.domain, created.threat_type, created.severity, created.notes, created.status, created.detected_at]);
  return hydrateThreat(await one('SELECT * FROM brand_threats WHERE id = $1', [created.id]));
}
async function deleteBrandThreatByDomain(brandId, domain, orgId) {
  if (!orgId) return;
  await q('DELETE FROM brand_threats WHERE brand_id = $1 AND org_id = $2 AND domain = $3', [brandId, orgId, domain]);
}

async function getBrandTakedowns(brandId, orgId) {
  if (!orgId) return [];
  const rows = (await all('SELECT * FROM brand_takedowns WHERE brand_id = $1 AND org_id = $2 ORDER BY submitted_at DESC', [brandId, orgId])).map(hydrateTakedown);
  // Hydrate replies for each
  await Promise.all(rows.map(async (td) => {
    const replies = await all('SELECT * FROM brand_takedown_replies WHERE takedown_id = $1 AND org_id = $2 ORDER BY timestamp ASC', [td.id, orgId]);
    td.replies = replies.map(hydrateReply);
  }));
  return rows;
}
async function addBrandTakedown(takedown, brandId, orgId) {
  if (!orgId) throw new Error('orgId required');
  const created = {
    id: takedown.id || nextNumericId(),
    brand_id: brandId, org_id: orgId,
    domain: takedown.domain, threat_type: takedown.threat_type || 'impersonation',
    evidence: json(takedown.evidence || {}),
    contact_email: takedown.contact_email || null,
    sender_email: takedown.sender_email || null,
    status: takedown.status || 'pending',
    provider: takedown.provider || null,
    abuse_email: takedown.abuse_email || null,
    email_template: takedown.email_template || null,
    sent: takedown.sent ? 1 : 0,
    sent_at: takedown.sent_at || null,
    notes: takedown.notes || '',
    submitted_at: takedown.submitted_at || now(),
  };
  await q('INSERT INTO brand_takedowns (id, brand_id, org_id, domain, threat_type, evidence, contact_email, sender_email, status, provider, abuse_email, email_template, sent, sent_at, notes, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
    [created.id, created.brand_id, created.org_id, created.domain, created.threat_type, created.evidence, created.contact_email, created.sender_email, created.status, created.provider, created.abuse_email, created.email_template, created.sent, created.sent_at, created.notes, created.submitted_at]);
  return { ...hydrateTakedown(await one('SELECT * FROM brand_takedowns WHERE id = $1', [created.id])), replies: [] };
}
async function updateBrandTakedown(takedownId, brandId, updates, orgId) {
  if (!orgId) return null;
  const existing = await one('SELECT * FROM brand_takedowns WHERE id = $1 AND brand_id = $2 AND org_id = $3', [takedownId, brandId, orgId]);
  if (!existing) return null;
  const next = { ...hydrateTakedown(existing), ...updates };
  await q('UPDATE brand_takedowns SET status=$4, notes=$5, sent=$6, sent_at=$7, sender_email=$8 WHERE id=$1 AND brand_id=$2 AND org_id=$3',
    [takedownId, brandId, orgId, next.status, next.notes || '', next.sent ? 1 : 0, next.sent_at || null, next.sender_email || null]);
  return hydrateTakedown(await one('SELECT * FROM brand_takedowns WHERE id = $1', [takedownId]));
}
async function addTakedownReply(reply, takedownId, brandId, orgId) {
  if (!orgId) throw new Error('orgId required');
  const created = {
    id: reply.id || nextNumericId(),
    takedown_id: takedownId, brand_id: brandId, org_id: orgId,
    from_email: reply.from || null, subject: reply.subject || '',
    body: reply.body || '', direction: reply.direction || 'incoming',
    timestamp: reply.timestamp || now(),
  };
  await q('INSERT INTO brand_takedown_replies (id, takedown_id, brand_id, org_id, from_email, subject, body, direction, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [created.id, created.takedown_id, created.brand_id, created.org_id, created.from_email, created.subject, created.body, created.direction, created.timestamp]);
  return hydrateReply(await one('SELECT * FROM brand_takedown_replies WHERE id = $1', [created.id]));
}

async function getBrandSafeList(brandId, orgId) {
  if (!orgId) return [];
  const rows = await all('SELECT domain FROM brand_safe_entries WHERE brand_id = $1 AND org_id = $2 ORDER BY added_at DESC', [brandId, orgId]);
  return rows.map(r => r.domain);
}
async function addSafeEntry(brandId, domain, orgId) {
  if (!orgId) return;
  try {
    await q('INSERT INTO brand_safe_entries (id, brand_id, org_id, domain, added_at) VALUES ($1, $2, $3, $4, $5)', [nextNumericId(), brandId, orgId, domain.toLowerCase(), now()]);
  } catch (e) {
    if (!String(e.message).includes('duplicate key')) throw e;
  }
}
async function removeSafeEntry(brandId, domain, orgId) {
  if (!orgId) return;
  await q('DELETE FROM brand_safe_entries WHERE brand_id = $1 AND org_id = $2 AND domain = $3', [brandId, orgId, domain.toLowerCase()]);
}

async function getBrandAlerts(orgId, limit = 50) {
  if (!orgId) return [];
  const rows = await all('SELECT * FROM brand_alerts WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2', [orgId, limit]);
  return rows.map(hydrateAlert);
}
async function addBrandAlert(alert, orgId) {
  if (!orgId) throw new Error('orgId required');
  const { id: _, brand_id, brand_name, alert_type, severity, message, acknowledged, created_at, ...extras } = alert;
  const created = {
    id: nextNumericId(),
    brand_id: brand_id || null, org_id: orgId,
    brand_name: brand_name || null, alert_type: alert_type || null,
    severity: severity || null, message: message || null,
    data: json(extras), acknowledged: acknowledged ? 1 : 0,
    created_at: created_at || now(),
  };
  await q('INSERT INTO brand_alerts (id, brand_id, org_id, brand_name, alert_type, severity, message, data, acknowledged, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [created.id, created.brand_id, created.org_id, created.brand_name, created.alert_type, created.severity, created.message, created.data, created.acknowledged, created.created_at]);
  return hydrateAlert(await one('SELECT * FROM brand_alerts WHERE id = $1', [created.id]));
}
async function deleteBrandAlert(alertId, orgId) {
  if (!orgId) return;
  await q('DELETE FROM brand_alerts WHERE id = $1 AND org_id = $2', [alertId, orgId]);
}
async function clearBrandAlerts(orgId) {
  if (!orgId) return;
  await q('DELETE FROM brand_alerts WHERE org_id = $1', [orgId]);
}

async function migrateBrandsFromSettingsBlob() {
  // T162 — One-shot port from JSON-blob storage in settings to relational
  // tables. Idempotent: only runs while old settings rows still exist.
  const blobs = await all("SELECT org_id, key, value FROM settings WHERE key IN ('monitored_brands', 'brand_alerts')");
  if (blobs.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of blobs) {
      if (row.key === 'monitored_brands') {
        const arr = parse(row.value, []) || [];
        for (const b of arr) {
          // Skip if a brand with this id already exists for the org (avoid
          // duplicating on re-runs).
          const exists = await one('SELECT 1 FROM brands WHERE id = $1 AND org_id = $2', [b.id, row.org_id]);
          if (exists) continue;
          const created = await addBrand({
            id: b.id, domain: b.domain, brand_name: b.brand_name,
            status: b.status || 'active', scan_schedule: b.scan_schedule || 'manual',
            alerts_enabled: b.alerts_enabled !== false,
            last_scan: b.last_scan, next_scan: b.next_scan, last_results: b.last_results,
            added_at: b.added_at,
          }, row.org_id);
          for (const t of (b.threats || [])) await addBrandThreat(t, created.id, row.org_id);
          for (const td of (b.takedowns || [])) {
            const tdRow = await addBrandTakedown(td, created.id, row.org_id);
            for (const r of (td.replies || [])) await addTakedownReply(r, tdRow.id, created.id, row.org_id);
          }
          for (const sd of (b.safe_list || [])) await addSafeEntry(created.id, sd, row.org_id);
        }
      } else if (row.key === 'brand_alerts') {
        const arr = parse(row.value, []) || [];
        for (const a of arr) await addBrandAlert(a, row.org_id);
      }
    }
    // Drop the migrated blob rows so we don't re-run.
    await client.query("DELETE FROM settings WHERE key IN ('monitored_brands', 'brand_alerts')");
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[T162] brand migration failed:', e.message);
  } finally {
    client.release();
  }
}

async function initDatabase() {
  await initSchema();
  await migrateLegacyJsonIfNeeded();
  await migrateBrandsFromSettingsBlob();
  if (!(await getOrganization('segbytes'))) await addOrganization({ id: 'segbytes', slug: 'segbytes', name: 'Segbytes Solutions' });
  if (!(await getUserByEmail(process.env.SEED_ADMIN_EMAIL || 'admin@segbytes.xyz'))) {
    if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) throw new Error('Set SEED_ADMIN_PASSWORD before first production boot');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!', salt, 120000, 32, 'sha256').toString('hex');
    await addUser({ org_id: 'segbytes', email: process.env.SEED_ADMIN_EMAIL || 'admin@segbytes.xyz', name: 'Segbytes Admin', role: 'owner', platform_role: 'platform_admin', password_hash: `${salt}:${hash}` });
  }
  if ((await getSetting('notify_scan_completed')) === undefined) await setSetting('notify_scan_completed', '1');
  if ((await getSetting('notify_critical_alerts')) === undefined) await setSetting('notify_critical_alerts', '1');
  if ((await getSetting('notify_weekly_report')) === undefined) await setSetting('notify_weekly_report', '0');
}

module.exports = {
  getDomains, addDomain, getDomain, updateDomain, deleteDomain,
  addScan, getScans, getLatestScan, getIntegrations, addIntegration, deleteIntegration,
  getSetting, setSetting, deleteSetting, addReport, getReports,
  getOrganizations, getOrganization, getOrganizationByWhmcsClient, addOrganization, updateOrganization,
  getUsers, getUser, getUserByEmail, getUserByWhmcsContact, addUser, nextNumericId,
  initDatabase,
  // T162 — Brand Protection relational helpers
  getBrands, getBrand, getBrandFull, getBrandsFull, addBrand, updateBrand, deleteBrand,
  getBrandThreats, addBrandThreat, deleteBrandThreatByDomain,
  getBrandTakedowns, addBrandTakedown, updateBrandTakedown, addTakedownReply,
  getBrandSafeList, addSafeEntry, removeSafeEntry,
  getBrandAlerts, addBrandAlert, deleteBrandAlert, clearBrandAlerts,
};
