const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dataDir = process.env.NEXUSEMAIL_DATA_DIR || path.join(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const legacyJsonFile = path.join(dataDir, 'nexusemail.json');
const sqliteFile = process.env.NEXUSEMAIL_DB_PATH || path.join(dataDir, 'nexusemail.sqlite');
const connection = new Database(sqliteFile);

// Shutdown coordination: once set, all mutating helpers throw instead of
// writing, so the final object-storage snapshot can never race new writes.
let writesFrozen = false;
function freezeWrites() { writesFrozen = true; }
function assertWritable() {
  if (writesFrozen) throw new Error('writes frozen: instance shutting down');
}

connection.pragma('journal_mode = WAL');
connection.pragma('foreign_keys = ON');

function now() { return new Date().toISOString(); }
function nextId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; }
let _numericIdCounter = 0;
// T158 — collision-safe numeric primary key for SQLite-stored rows.
// Uses Date.now() * 1000 + a 0-999 process-local counter so tight loops in the
// same millisecond (e.g. POST /api/domains/bulk inserting many rows in one tick)
// produce monotonically-increasing unique IDs. Stays well within Number.MAX_SAFE_INTEGER
// for hundreds of years.
function nextNumericId() {
  _numericIdCounter = (_numericIdCounter + 1) % 1000;
  return Date.now() * 1000 + _numericIdCounter;
}
function json(value) { return JSON.stringify(value ?? null); }
function parse(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }

function initSchema() {
  connection.exec(`
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
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY,
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
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain_id INTEGER,
      data TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    -- T162 — Brand Protection relational schema. Replaces JSON-blob storage
    -- under settings keys 'monitored_brands' and 'brand_alerts'. Per-row
    -- indexing, foreign-key cascades, and per-tenant scoping via org_id.
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY,
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
      id INTEGER PRIMARY KEY,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
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
      id INTEGER PRIMARY KEY,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
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
      id INTEGER PRIMARY KEY,
      takedown_id INTEGER NOT NULL REFERENCES brand_takedowns(id) ON DELETE CASCADE,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      from_email TEXT,
      subject TEXT,
      body TEXT,
      direction TEXT NOT NULL DEFAULT 'incoming',
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brand_replies_takedown ON brand_takedown_replies(takedown_id);

    CREATE TABLE IF NOT EXISTS brand_safe_entries (
      id INTEGER PRIMARY KEY,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE(brand_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_brand_safe_brand ON brand_safe_entries(brand_id);

    CREATE TABLE IF NOT EXISTS brand_alerts (
      id INTEGER PRIMARY KEY,
      brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
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

function getOrganizations() { return connection.prepare('SELECT * FROM organizations ORDER BY created_at DESC').all(); }
function getOrganization(idOrSlug) { return connection.prepare('SELECT * FROM organizations WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug); }
function getOrganizationByWhmcsClient(clientId) { return connection.prepare('SELECT * FROM organizations WHERE whmcs_client_id = ?').get(String(clientId)); }
function addOrganization(org) {
  assertWritable();
  const created = { id: org.id || nextId('org'), slug: org.slug, name: org.name, status: org.status || 'active', whmcs_client_id: org.whmcs_client_id || null, whmcs_service_id: org.whmcs_service_id || null, plan: org.plan || null, created_at: org.created_at || now(), updated_at: org.updated_at || now() };
  connection.prepare(`INSERT INTO organizations (id, slug, name, status, whmcs_client_id, whmcs_service_id, plan, created_at, updated_at) VALUES (@id, @slug, @name, @status, @whmcs_client_id, @whmcs_service_id, @plan, @created_at, @updated_at)`).run(created);
  return created;
}
function updateOrganization(id, updates) {
  assertWritable();
  const existing = getOrganization(id);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  connection.prepare(`UPDATE organizations SET slug=@slug, name=@name, status=@status, whmcs_client_id=@whmcs_client_id, whmcs_service_id=@whmcs_service_id, plan=@plan, updated_at=@updated_at WHERE id=@id`).run(next);
  return getOrganization(id);
}

function getUsers(orgId) { return orgId ? connection.prepare('SELECT * FROM users WHERE org_id = ? ORDER BY created_at DESC').all(orgId) : connection.prepare('SELECT * FROM users ORDER BY created_at DESC').all(); }
function getUser(id) { return connection.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByEmail(email) { return connection.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email || ''); }
function getUserByWhmcsContact(clientId, contactId, email) {
  if (contactId) {
    return connection.prepare('SELECT * FROM users WHERE whmcs_client_id = ? AND whmcs_contact_id = ?').get(String(clientId), String(contactId));
  }
  return connection.prepare('SELECT * FROM users WHERE whmcs_client_id = ? AND lower(email) = lower(?)').get(String(clientId), email || '');
}
function addUser(user) {
  assertWritable();
  const created = { id: user.id || nextId('usr'), org_id: user.org_id, email: user.email, name: user.name || user.email, role: user.role || 'member', platform_role: user.platform_role || null, status: user.status || 'active', password_hash: user.password_hash || null, whmcs_client_id: user.whmcs_client_id || null, whmcs_contact_id: user.whmcs_contact_id || null, created_at: user.created_at || now(), updated_at: user.updated_at || now() };
  connection.prepare(`INSERT INTO users (id, org_id, email, name, role, platform_role, status, password_hash, whmcs_client_id, whmcs_contact_id, created_at, updated_at) VALUES (@id, @org_id, @email, @name, @role, @platform_role, @status, @password_hash, @whmcs_client_id, @whmcs_contact_id, @created_at, @updated_at)`).run(created);
  return created;
}

function getDomains(orgId) { return connection.prepare(orgId ? 'SELECT * FROM domains WHERE org_id = ? ORDER BY created_at DESC' : 'SELECT * FROM domains ORDER BY created_at DESC').all(...(orgId ? [orgId] : [])).map(hydrateDomain); }
function addDomain(domain, orgId) {
  assertWritable();
  const created = { ...domain, id: domain.id || nextNumericId(), org_id: orgId || domain.org_id || 'segbytes', created_at: domain.created_at || now(), updated_at: now() };
  connection.prepare('INSERT INTO domains (id, org_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(created.id, created.org_id, json(created), created.created_at, created.updated_at);
  return created;
}
function getDomain(id, orgId) { return hydrateDomain(connection.prepare(orgId ? 'SELECT * FROM domains WHERE id = ? AND org_id = ?' : 'SELECT * FROM domains WHERE id = ?').get(...(orgId ? [id, orgId] : [id]))); }
function updateDomain(id, updates, orgId) {
  assertWritable();
  const existing = getDomain(id, orgId);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  connection.prepare('UPDATE domains SET data = ?, updated_at = ? WHERE id = ? AND org_id = ?').run(json(next), next.updated_at, id, next.org_id);
  return next;
}
function deleteDomain(id, orgId) {
  assertWritable();
  connection.prepare(orgId ? 'DELETE FROM scans WHERE domain_id = ? AND org_id = ?' : 'DELETE FROM scans WHERE domain_id = ?').run(...(orgId ? [id, orgId] : [id]));
  connection.prepare(orgId ? 'DELETE FROM domains WHERE id = ? AND org_id = ?' : 'DELETE FROM domains WHERE id = ?').run(...(orgId ? [id, orgId] : [id]));
}

function addScan(scan, orgId) {
  assertWritable();
  const created = { ...scan, id: scan.id || nextNumericId(), org_id: orgId || scan.org_id || 'segbytes', scanned_at: scan.scanned_at || now() };
  connection.prepare('INSERT INTO scans (id, org_id, domain_id, data, scanned_at) VALUES (?, ?, ?, ?, ?)').run(created.id, created.org_id, created.domain_id, json(created), created.scanned_at);
  return created;
}
function getScans(domainId, limit = 30, orgId) { return connection.prepare(orgId ? 'SELECT * FROM scans WHERE domain_id = ? AND org_id = ? ORDER BY scanned_at DESC LIMIT ?' : 'SELECT * FROM scans WHERE domain_id = ? ORDER BY scanned_at DESC LIMIT ?').all(...(orgId ? [domainId, orgId, limit] : [domainId, limit])).map(hydrateScan).reverse(); }
function getLatestScan(domainId, orgId) { return hydrateScan(connection.prepare(orgId ? 'SELECT * FROM scans WHERE domain_id = ? AND org_id = ? ORDER BY scanned_at DESC LIMIT 1' : 'SELECT * FROM scans WHERE domain_id = ? ORDER BY scanned_at DESC LIMIT 1').get(...(orgId ? [domainId, orgId] : [domainId]))); }

function getIntegrations(orgId) { return connection.prepare(orgId ? 'SELECT * FROM integrations WHERE org_id = ? ORDER BY created_at DESC' : 'SELECT * FROM integrations ORDER BY created_at DESC').all(...(orgId ? [orgId] : [])).map(hydrateIntegration); }
function addIntegration(integration, orgId) {
  assertWritable();
  const created = { ...integration, id: integration.id || nextNumericId(), org_id: orgId || integration.org_id || 'segbytes', created_at: integration.created_at || now(), updated_at: now() };
  connection.prepare('INSERT INTO integrations (id, org_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(created.id, created.org_id, json(created), created.created_at, created.updated_at);
  return created;
}
function deleteIntegration(id, orgId) { assertWritable(); connection.prepare(orgId ? 'DELETE FROM integrations WHERE id = ? AND org_id = ?' : 'DELETE FROM integrations WHERE id = ?').run(...(orgId ? [id, orgId] : [id])); }

function getSetting(key, orgId) { const row = connection.prepare('SELECT value FROM settings WHERE org_id = ? AND key = ?').get(orgId || 'global', key) || connection.prepare('SELECT value FROM settings WHERE org_id = ? AND key = ?').get('global', key); return row?.value; }
function setSetting(key, value, orgId) { assertWritable(); connection.prepare('INSERT INTO settings (org_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(orgId || 'global', key, String(value), now()); }
function deleteSetting(key, orgId) { assertWritable(); connection.prepare('DELETE FROM settings WHERE org_id = ? AND key = ?').run(orgId || 'global', key); }

function addReport(report, orgId) {
  assertWritable();
  const created = { ...report, id: report.id || nextNumericId(), org_id: orgId || report.org_id || 'segbytes', generated_at: report.generated_at || now() };
  connection.prepare('INSERT INTO reports (id, org_id, domain_id, data, generated_at) VALUES (?, ?, ?, ?, ?)').run(created.id, created.org_id, created.domain_id || null, json(created), created.generated_at);
  return created;
}
function getReports(domainId, orgId) { return connection.prepare(domainId ? 'SELECT * FROM reports WHERE domain_id = ? AND (? IS NULL OR org_id = ?) ORDER BY generated_at DESC' : 'SELECT * FROM reports WHERE (? IS NULL OR org_id = ?) ORDER BY generated_at DESC').all(...(domainId ? [domainId, orgId || null, orgId || null] : [orgId || null, orgId || null])).map(hydrateReport); }

function migrateLegacyJsonIfNeeded() {
  const hasOrgs = connection.prepare('SELECT COUNT(*) AS count FROM organizations').get().count > 0;
  if (hasOrgs || !fs.existsSync(legacyJsonFile)) return;
  const legacy = parse(fs.readFileSync(legacyJsonFile, 'utf8'), {});
  const tx = connection.transaction(() => {
    for (const org of legacy.organizations || []) addOrganization(org);
    if (!getOrganization('segbytes')) addOrganization({ id: 'segbytes', slug: 'segbytes', name: 'Segbytes Solutions' });
    for (const user of legacy.users || []) addUser(user);
    for (const domain of legacy.domains || []) addDomain(domain, domain.org_id || 'segbytes');
    for (const scan of legacy.scans || []) addScan(scan, scan.org_id || 'segbytes');
    for (const integration of legacy.integrations || []) addIntegration(integration, integration.org_id || 'segbytes');
    for (const [key, value] of Object.entries(legacy.settings || {})) {
      const idx = key.indexOf(':');
      if (idx > 0 && key.startsWith('org_')) setSetting(key.slice(idx + 1), value, key.slice(0, idx));
      else setSetting(key, value);
    }
    for (const report of legacy.reports || []) addReport(report, report.org_id || 'segbytes');
  });
  tx();
}

initSchema();
migrateLegacyJsonIfNeeded();

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

function getBrands(orgId) {
  if (!orgId) return [];
  return connection.prepare('SELECT * FROM brands WHERE org_id = ? ORDER BY added_at DESC').all(orgId).map(hydrateBrand);
}
function getBrand(id, orgId) {
  if (!orgId) return null;
  return hydrateBrand(connection.prepare('SELECT * FROM brands WHERE id = ? AND org_id = ?').get(id, orgId));
}
function getBrandFull(id, orgId) {
  const brand = getBrand(id, orgId);
  if (!brand) return null;
  brand.threats = getBrandThreats(id, orgId);
  brand.takedowns = getBrandTakedowns(id, orgId);
  brand.safe_list = getBrandSafeList(id, orgId);
  return brand;
}
function getBrandsFull(orgId) {
  return getBrands(orgId).map(b => ({
    ...b,
    threats: getBrandThreats(b.id, orgId),
    takedowns: getBrandTakedowns(b.id, orgId),
    safe_list: getBrandSafeList(b.id, orgId),
  }));
}
function addBrand(brand, orgId) {
  assertWritable();
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
  connection.prepare(`INSERT INTO brands (id, org_id, domain, brand_name, status, scan_schedule, alerts_enabled, last_scan, next_scan, last_results, added_at, updated_at) VALUES (@id, @org_id, @domain, @brand_name, @status, @scan_schedule, @alerts_enabled, @last_scan, @next_scan, @last_results, @added_at, @updated_at)`).run(created);
  return hydrateBrand(connection.prepare('SELECT * FROM brands WHERE id = ?').get(created.id));
}
function updateBrand(id, updates, orgId) {
  assertWritable();
  const existing = getBrand(id, orgId);
  if (!existing) return null;
  const next = { ...existing, ...updates, updated_at: now() };
  connection.prepare(`UPDATE brands SET domain=@domain, brand_name=@brand_name, status=@status, scan_schedule=@scan_schedule, alerts_enabled=@alerts_enabled, last_scan=@last_scan, next_scan=@next_scan, last_results=@last_results, updated_at=@updated_at WHERE id=@id AND org_id=@org_id`).run({
    id, org_id: orgId,
    domain: next.domain, brand_name: next.brand_name, status: next.status,
    scan_schedule: next.scan_schedule, alerts_enabled: next.alerts_enabled ? 1 : 0,
    last_scan: next.last_scan || null, next_scan: next.next_scan || null,
    last_results: next.last_results ? json(next.last_results) : null,
    updated_at: next.updated_at,
  });
  return getBrand(id, orgId);
}
function deleteBrand(id, orgId) {
  assertWritable();
  if (!orgId) return false;
  const result = connection.prepare('DELETE FROM brands WHERE id = ? AND org_id = ?').run(id, orgId);
  return result.changes > 0;
}

function getBrandThreats(brandId, orgId) {
  if (!orgId) return [];
  return connection.prepare('SELECT * FROM brand_threats WHERE brand_id = ? AND org_id = ? ORDER BY detected_at DESC').all(brandId, orgId).map(hydrateThreat);
}
function addBrandThreat(threat, brandId, orgId) {
  assertWritable();
  if (!orgId) throw new Error('orgId required');
  const created = {
    id: threat.id || nextNumericId(),
    brand_id: brandId, org_id: orgId,
    domain: threat.domain, threat_type: threat.threat_type || 'manual',
    severity: threat.severity || 'medium', notes: threat.notes || '',
    status: threat.status || 'active', detected_at: threat.detected_at || now(),
  };
  connection.prepare(`INSERT INTO brand_threats (id, brand_id, org_id, domain, threat_type, severity, notes, status, detected_at) VALUES (@id, @brand_id, @org_id, @domain, @threat_type, @severity, @notes, @status, @detected_at)`).run(created);
  return hydrateThreat(connection.prepare('SELECT * FROM brand_threats WHERE id = ?').get(created.id));
}
function deleteBrandThreatByDomain(brandId, domain, orgId) {
  assertWritable();
  if (!orgId) return;
  connection.prepare('DELETE FROM brand_threats WHERE brand_id = ? AND org_id = ? AND domain = ?').run(brandId, orgId, domain);
}

function getBrandTakedowns(brandId, orgId) {
  if (!orgId) return [];
  const rows = connection.prepare('SELECT * FROM brand_takedowns WHERE brand_id = ? AND org_id = ? ORDER BY submitted_at DESC').all(brandId, orgId).map(hydrateTakedown);
  // Hydrate replies for each
  for (const td of rows) {
    td.replies = connection.prepare('SELECT * FROM brand_takedown_replies WHERE takedown_id = ? AND org_id = ? ORDER BY timestamp ASC').all(td.id, orgId).map(hydrateReply);
  }
  return rows;
}
function addBrandTakedown(takedown, brandId, orgId) {
  assertWritable();
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
  connection.prepare(`INSERT INTO brand_takedowns (id, brand_id, org_id, domain, threat_type, evidence, contact_email, sender_email, status, provider, abuse_email, email_template, sent, sent_at, notes, submitted_at) VALUES (@id, @brand_id, @org_id, @domain, @threat_type, @evidence, @contact_email, @sender_email, @status, @provider, @abuse_email, @email_template, @sent, @sent_at, @notes, @submitted_at)`).run(created);
  return { ...hydrateTakedown(connection.prepare('SELECT * FROM brand_takedowns WHERE id = ?').get(created.id)), replies: [] };
}
function updateBrandTakedown(takedownId, brandId, updates, orgId) {
  assertWritable();
  if (!orgId) return null;
  const existing = connection.prepare('SELECT * FROM brand_takedowns WHERE id = ? AND brand_id = ? AND org_id = ?').get(takedownId, brandId, orgId);
  if (!existing) return null;
  const next = { ...hydrateTakedown(existing), ...updates };
  connection.prepare(`UPDATE brand_takedowns SET status=@status, notes=@notes, sent=@sent, sent_at=@sent_at, sender_email=@sender_email WHERE id=@id AND org_id=@org_id`).run({
    id: takedownId, org_id: orgId,
    status: next.status, notes: next.notes || '',
    sent: next.sent ? 1 : 0, sent_at: next.sent_at || null,
    sender_email: next.sender_email || null,
  });
  return hydrateTakedown(connection.prepare('SELECT * FROM brand_takedowns WHERE id = ?').get(takedownId));
}
function addTakedownReply(reply, takedownId, brandId, orgId) {
  assertWritable();
  assertWritable();
  if (!orgId) throw new Error('orgId required');
  const created = {
    id: reply.id || nextNumericId(),
    takedown_id: takedownId, brand_id: brandId, org_id: orgId,
    from_email: reply.from || null, subject: reply.subject || '',
    body: reply.body || '', direction: reply.direction || 'incoming',
    timestamp: reply.timestamp || now(),
  };
  connection.prepare(`INSERT INTO brand_takedown_replies (id, takedown_id, brand_id, org_id, from_email, subject, body, direction, timestamp) VALUES (@id, @takedown_id, @brand_id, @org_id, @from_email, @subject, @body, @direction, @timestamp)`).run(created);
  return hydrateReply(connection.prepare('SELECT * FROM brand_takedown_replies WHERE id = ?').get(created.id));
}

function getBrandSafeList(brandId, orgId) {
  if (!orgId) return [];
  return connection.prepare('SELECT domain FROM brand_safe_entries WHERE brand_id = ? AND org_id = ? ORDER BY added_at DESC').all(brandId, orgId).map(r => r.domain);
}
function addSafeEntry(brandId, domain, orgId) {
  assertWritable();
  if (!orgId) return;
  try {
    connection.prepare('INSERT INTO brand_safe_entries (id, brand_id, org_id, domain, added_at) VALUES (?, ?, ?, ?, ?)').run(nextNumericId(), brandId, orgId, domain.toLowerCase(), now());
  } catch (e) {
    if (!String(e.message).includes('UNIQUE')) throw e;
  }
}
function removeSafeEntry(brandId, domain, orgId) {
  assertWritable();
  if (!orgId) return;
  connection.prepare('DELETE FROM brand_safe_entries WHERE brand_id = ? AND org_id = ? AND domain = ?').run(brandId, orgId, domain.toLowerCase());
}

function getBrandAlerts(orgId, limit = 50) {
  if (!orgId) return [];
  return connection.prepare('SELECT * FROM brand_alerts WHERE org_id = ? ORDER BY created_at DESC LIMIT ?').all(orgId, limit).map(hydrateAlert);
}
function addBrandAlert(alert, orgId) {
  assertWritable();
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
  connection.prepare(`INSERT INTO brand_alerts (id, brand_id, org_id, brand_name, alert_type, severity, message, data, acknowledged, created_at) VALUES (@id, @brand_id, @org_id, @brand_name, @alert_type, @severity, @message, @data, @acknowledged, @created_at)`).run(created);
  return hydrateAlert(connection.prepare('SELECT * FROM brand_alerts WHERE id = ?').get(created.id));
}
function deleteBrandAlert(alertId, orgId) {
  assertWritable();
  if (!orgId) return;
  connection.prepare('DELETE FROM brand_alerts WHERE id = ? AND org_id = ?').run(alertId, orgId);
}
function clearBrandAlerts(orgId) {
  assertWritable();
  if (!orgId) return;
  connection.prepare('DELETE FROM brand_alerts WHERE org_id = ?').run(orgId);
}

function migrateBrandsFromSettingsBlob() {
  // T162 — One-shot port from JSON-blob storage in settings to relational
  // tables. Idempotent: only runs while old settings rows still exist.
  // Wrapped in a transaction so a partial migration doesn't leave stale data.
  const blobs = connection.prepare("SELECT org_id, key, value FROM settings WHERE key IN ('monitored_brands', 'brand_alerts')").all();
  if (blobs.length === 0) return;

  const tx = connection.transaction(() => {
    for (const row of blobs) {
      if (row.key === 'monitored_brands') {
        const arr = parse(row.value, []) || [];
        for (const b of arr) {
          // Skip if a brand with this id already exists for the org (avoid
          // duplicating on re-runs).
          const exists = connection.prepare('SELECT 1 FROM brands WHERE id = ? AND org_id = ?').get(b.id, row.org_id);
          if (exists) continue;
          const created = addBrand({
            id: b.id, domain: b.domain, brand_name: b.brand_name,
            status: b.status || 'active', scan_schedule: b.scan_schedule || 'manual',
            alerts_enabled: b.alerts_enabled !== false,
            last_scan: b.last_scan, next_scan: b.next_scan, last_results: b.last_results,
            added_at: b.added_at,
          }, row.org_id);
          for (const t of (b.threats || [])) {
            addBrandThreat(t, created.id, row.org_id);
          }
          for (const td of (b.takedowns || [])) {
            const tdRow = addBrandTakedown(td, created.id, row.org_id);
            for (const r of (td.replies || [])) {
              addTakedownReply(r, tdRow.id, created.id, row.org_id);
            }
          }
          for (const sd of (b.safe_list || [])) {
            addSafeEntry(created.id, sd, row.org_id);
          }
        }
      } else if (row.key === 'brand_alerts') {
        const arr = parse(row.value, []) || [];
        for (const a of arr) addBrandAlert(a, row.org_id);
      }
    }
    // Drop the migrated blob rows so we don't re-run.
    connection.prepare("DELETE FROM settings WHERE key IN ('monitored_brands', 'brand_alerts')").run();
  });
  try { tx(); } catch (e) { console.error('[T162] brand migration failed:', e.message); }
}

migrateBrandsFromSettingsBlob();

if (!getOrganization('segbytes')) addOrganization({ id: 'segbytes', slug: 'segbytes', name: 'Segbytes Solutions' });
if (!getUserByEmail(process.env.SEED_ADMIN_EMAIL || 'admin@segbytes.co.za')) {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) throw new Error('Set SEED_ADMIN_PASSWORD before first production boot');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!', salt, 120000, 32, 'sha256').toString('hex');
  addUser({ org_id: 'segbytes', email: process.env.SEED_ADMIN_EMAIL || 'admin@segbytes.co.za', name: 'Segbytes Admin', role: 'owner', platform_role: 'platform_admin', password_hash: `${salt}:${hash}` });
}
if (!getSetting('notify_scan_completed')) setSetting('notify_scan_completed', '1');
if (!getSetting('notify_critical_alerts')) setSetting('notify_critical_alerts', '1');
if (!getSetting('notify_weekly_report')) setSetting('notify_weekly_report', '0');

function saveDB() { connection.pragma('wal_checkpoint(PASSIVE)'); }
function backup(destPath) { return connection.backup(destPath); }
const sqliteFilePath = sqliteFile;

module.exports = { getDomains, addDomain, getDomain, updateDomain, deleteDomain, addScan, getScans, getLatestScan, getIntegrations, addIntegration, deleteIntegration, getSetting, setSetting, deleteSetting, addReport, getReports, getOrganizations, getOrganization, getOrganizationByWhmcsClient, addOrganization, updateOrganization, getUsers, getUser, getUserByEmail, getUserByWhmcsContact, addUser, saveDB, backup, sqliteFilePath, freezeWrites, nextNumericId,
  // T162 — Brand Protection relational helpers
  getBrands, getBrand, getBrandFull, getBrandsFull, addBrand, updateBrand, deleteBrand,
  getBrandThreats, addBrandThreat, deleteBrandThreatByDomain,
  getBrandTakedowns, addBrandTakedown, updateBrandTakedown, addTakedownReply,
  getBrandSafeList, addSafeEntry, removeSafeEntry,
  getBrandAlerts, addBrandAlert, deleteBrandAlert, clearBrandAlerts,
};
