#!/usr/bin/env node
// One-shot migration: re-encrypts every secret setting row still stored as
// plaintext. Idempotent — already-encrypted rows are skipped.
//
// Usage (staging):
//   docker cp scripts/migrate-secret-settings.js nexusemail-backend-1:/tmp/
//   docker exec nexusemail-backend-1 node /tmp/migrate-secret-settings.js [--dry-run]
//   docker exec nexusemail-backend-1 rm /tmp/migrate-secret-settings.js
//
// Exit codes: 0 = clean (or nothing to do), 1 = failure, 2 = dry-run found
// plaintext rows. NODE_ENV=production is expected so fail-closed guards apply.

const db = require('../src/db/database');
const { SECRET_SETTING_KEYS, isEncrypted, hasEncryptionKey } = require('../src/utils/secretbox');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  if (!hasEncryptionKey()) {
    console.error('NEXUSEMAIL_ENCRYPTION_KEY is not configured; cannot migrate');
    process.exit(1);
  }

  const rows = await db.withTransaction((tx) => tx.all('SELECT org_id, key, value FROM settings'));
  const targets = rows.filter((r) => SECRET_SETTING_KEYS.has(r.key));

  let encrypted = 0;
  let plaintext = [];
  for (const t of targets) {
    if (isEncrypted(t.value)) { encrypted++; continue; }
    plaintext.push(t);
  }

  console.log(`secret rows: ${targets.length} total, ${encrypted} already encrypted, ${plaintext.length} plaintext`);
  if (plaintext.length === 0) {
    console.log('nothing to migrate');
    process.exit(0);
  }

  if (DRY_RUN) {
    for (const t of plaintext) console.log(`[dry-run] would re-encrypt: key=${t.key} org=${t.org_id}`);
    process.exit(2);
  }

  for (const t of plaintext) {
    // Legacy plaintext rows store the raw content; rewriting it through
    // setSetting encrypts it in place without changing the readable value.
    await db.setSetting(t.key, t.value, t.org_id);
    console.log(`re-encrypted: key=${t.key} org=${t.org_id}`);
  }

  // Verification: no plaintext secret row may remain.
  const after = await db.withTransaction((tx) => tx.all('SELECT org_id, key, value FROM settings'));
  const remaining = after.filter((r) => SECRET_SETTING_KEYS.has(r.key) && !isEncrypted(r.value));
  if (remaining.length > 0) {
    for (const t of remaining) console.error(`STILL PLAINTEXT: key=${t.key} org=${t.org_id}`);
    process.exit(1);
  }
  console.log(`verified: all ${SECRET_SETTING_KEYS.size} secret keys encrypted at rest`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
