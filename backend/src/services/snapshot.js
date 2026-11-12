const fs = require('fs');
const path = require('path');

// Object-storage snapshot/restore for the SQLite database.
// Purpose: Render's free tier has no persistent disk, so the database must be
// pushed to (and restored from) an S3-compatible object store. Cloudflare R2
// is S3-compatible and has a free tier.
//
// Configuration (all optional — the service is a no-op when incomplete):
//   SNAPSHOT_ENDPOINT         e.g. https://<account>.r2.cloudflarestorage.com
//   SNAPSHOT_BUCKET           bucket name
//   SNAPSHOT_ACCESS_KEY_ID    S3 access key id
//   SNAPSHOT_SECRET_ACCESS_KEY
//   SNAPSHOT_KEY              object key (default: snapshots/nexusemail.sqlite)
//   SNAPSHOT_INTERVAL_MIN     periodic snapshot interval (default: 30)
//   SNAPSHOT_GRACE_MIN        delay before the first periodic snapshot after
//                             boot (default: 5) — lets a predecessor instance's
//                             final SIGTERM snapshot land in object storage
//                             first, so deploys don't overwrite fresher data
//                             with a stale-restore snapshot.
//   SNAPSHOT_DISABLED         set to "1" to force-disable even when configured

const SNAPSHOT_MARKER = '[snapshot]';

let snapInProgress = false;
let activePromise = null;
let shuttingDown = false;

function resolveConfig() {
  const config = {
    endpoint: process.env.SNAPSHOT_ENDPOINT || (process.env.SNAPSHOT_ACCOUNT_ID ? `https://${process.env.SNAPSHOT_ACCOUNT_ID}.r2.cloudflarestorage.com` : null),
    bucket: process.env.SNAPSHOT_BUCKET || null,
    accessKeyId: process.env.SNAPSHOT_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.SNAPSHOT_SECRET_ACCESS_KEY || null,
    key: process.env.SNAPSHOT_KEY || 'snapshots/nexusemail.sqlite',
    intervalMin: parseInt(process.env.SNAPSHOT_INTERVAL_MIN || '30', 10) || 30,
    graceMin: parseInt(process.env.SNAPSHOT_GRACE_MIN || '5', 10) || 0,
    disabled: process.env.SNAPSHOT_DISABLED === '1',
  };
  const missing = ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].filter((k) => !config[k]);
  if (config.disabled) return null;
  if (missing.length > 0) {
    console.log(`${SNAPSHOT_MARKER} disabled (missing: ${missing.join(', ')})`);
    return null;
  }
  if (!/^https:\/\//.test(config.endpoint)) {
    console.error(`${SNAPSHOT_MARKER} endpoint must be https (got ${config.endpoint})`);
    return null;
  }
  return config;
}

function clientFor(config) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });
}

async function restoreLatestSnapshot({ sqliteFile }) {
  const config = resolveConfig();
  if (!config) return 'disabled';
  if (fs.existsSync(sqliteFile) && fs.statSync(sqliteFile).size > 0) return 'existing';

  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = clientFor(config);

  // Download to a temp file first — a failed/partial download must never leave
  // a corrupt file at sqliteFile (it would be treated as a valid DB on reboot).
  const tmpFile = `${sqliteFile}.restore.tmp`;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: config.key }));
    fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
    await require('node:stream/promises').pipeline(res.Body, fs.createWriteStream(tmpFile));
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch { /* nothing to clean */ }
    if (err.name === 'NoSuchKey' || (err.$metadata && err.$metadata.httpStatusCode === 404)) {
      console.log(`${SNAPSHOT_MARKER} no snapshot in storage yet — starting fresh`);
      return 'none';
    }
    throw err;
  }
  fs.renameSync(tmpFile, sqliteFile);
  console.log(`${SNAPSHOT_MARKER} restored database from storage (${fs.statSync(sqliteFile).size} bytes)`);
  return 'restored';
}

// Uses better-sqlite3's .backup() for a consistent snapshot even under WAL mode.
// Single-flight: concurrent callers await the active snapshot's promise instead
// of racing on the shared temp file — important for the shutdown path, which
// must observe completion rather than treat a skipped run as finished work.
async function snapshotNow({ sqliteFile }) {
  const config = resolveConfig();
  if (!config) return 'disabled';
  if (activePromise) {
    // A caller arriving while a snapshot is in flight needs a copy that
    // includes ITS writes, not the in-flight generation — so after the active
    // upload settles, take a fresh one. (During shutdown, the shutdown path
    // handles the final generation itself; return the in-flight result.)
    const prior = await activePromise;
    if (shuttingDown) return prior;
    return snapshotNow({ sqliteFile });
  }
  if (!fs.existsSync(sqliteFile) || fs.statSync(sqliteFile).size === 0) return 'empty';

  const run = (async () => {
    snapInProgress = true;
    try {
      const { backup } = require('../db/database');
      const tmpFile = `${sqliteFile}.snapshot.tmp`;
      await backup(tmpFile);

      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      const client = clientFor(config);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: config.key,
        Body: fs.createReadStream(tmpFile),
        ContentType: 'application/x-sqlite3',
      }));
      fs.unlinkSync(tmpFile);
      console.log(`${SNAPSHOT_MARKER} uploaded snapshot (${fs.statSync(sqliteFile).size} bytes)`);
      return 'uploaded';
    } finally {
      snapInProgress = false;
      activePromise = null;
    }
  })();
  activePromise = run;
  return run;
}

let hooksInstalled = false;
function startSnapshotLoop({ sqliteFile, server }) {
  const config = resolveConfig();
  if (!config || hooksInstalled) return;
  hooksInstalled = true;

  // Grace delay: the first periodic snapshot waits so a predecessor instance's
  // final SIGTERM snapshot has time to land first on deploys. Later snapshots
  // are post-grace and always newer than the restore they were built from.
  const timer = setTimeout(() => {
    if (shuttingDown) return;
    setInterval(() => {
      if (shuttingDown) return;
      snapshotNow({ sqliteFile }).catch((err) => {
        console.error(`${SNAPSHOT_MARKER} snapshot failed:`, err.message);
        if (global.Sentry) global.Sentry.captureException(err);
      });
    }, config.intervalMin * 60 * 1000);
    console.log(`${SNAPSHOT_MARKER} loop started (every ${config.intervalMin} min after ${config.graceMin} min grace, bucket=${config.bucket})`);
  }, config.graceMin * 60 * 1000);
  timer.unref();

  // Final snapshot on shutdown: drain in-flight requests (server.close callback
  // signals when connections have settled), let any snapshot already running
  // finish, take one last snapshot of the drained state, then exit — a Node
  // signal listener suppresses the default exit, so we exit ourselves.
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${SNAPSHOT_MARKER} ${signal} received — drain, final snapshot, exit`);
    if (server) {
      await Promise.race([
        new Promise((resolve) => { try { server.close(() => resolve()); } catch { resolve(); } }),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ]);
    }
    try {
      // If a snapshot was already in flight, let it finish (a transient
      // failure there must not skip the final attempt) ...
      if (activePromise) {
        try { await activePromise; } catch (err) {
          console.error(`${SNAPSHOT_MARKER} in-flight snapshot failed during shutdown:`, err.message);
        }
      }
      // ... then attempt a final snapshot of the drained state regardless.
      await snapshotNow({ sqliteFile });
    } catch (err) {
      console.error(`${SNAPSHOT_MARKER} final snapshot failed:`, err.message);
      if (global.Sentry) global.Sentry.captureException(err);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { restoreLatestSnapshot, snapshotNow, startSnapshotLoop };
