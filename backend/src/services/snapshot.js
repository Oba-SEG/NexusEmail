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
//   SNAPSHOT_DISABLED         set to "1" to force-disable even when configured

const SNAPSHOT_MARKER = '[snapshot]';

function resolveConfig() {
  const config = {
    endpoint: process.env.SNAPSHOT_ENDPOINT || (process.env.SNAPSHOT_ACCOUNT_ID ? `https://${process.env.SNAPSHOT_ACCOUNT_ID}.r2.cloudflarestorage.com` : null),
    bucket: process.env.SNAPSHOT_BUCKET || null,
    accessKeyId: process.env.SNAPSHOT_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.SNAPSHOT_SECRET_ACCESS_KEY || null,
    key: process.env.SNAPSHOT_KEY || 'snapshots/nexusemail.sqlite',
    intervalMin: parseInt(process.env.SNAPSHOT_INTERVAL_MIN || '30', 10) || 30,
    disabled: process.env.SNAPSHOT_DISABLED === '1',
  };
  const missing = ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].filter((k) => !config[k]);
  if (config.disabled) return null;
  if (missing.length > 0) {
    console.log(`${SNAPSHOT_MARKER} disabled (missing: ${missing.join(', ')})`);
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
  let res;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: config.key }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || (err.$metadata && err.$metadata.httpStatusCode === 404)) {
      console.log(`${SNAPSHOT_MARKER} no snapshot in storage yet — starting fresh`);
      return 'none';
    }
    throw err;
  }
  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
  await require('node:stream/promises').pipeline(res.Body, fs.createWriteStream(sqliteFile));
  console.log(`${SNAPSHOT_MARKER} restored database from storage (${fs.statSync(sqliteFile).size} bytes)`);
  return 'restored';
}

// Uses better-sqlite3's .backup() for a consistent snapshot even under WAL mode.
async function snapshotNow({ sqliteFile }) {
  const config = resolveConfig();
  if (!config) return 'disabled';
  if (!fs.existsSync(sqliteFile) || fs.statSync(sqliteFile).size === 0) return 'empty';

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
}

let loopStarted = false;
function startSnapshotLoop({ sqliteFile }) {
  const config = resolveConfig();
  if (!config || loopStarted) return;
  loopStarted = true;

  const run = () => snapshotNow({ sqliteFile }).catch((err) => {
    console.error(`${SNAPSHOT_MARKER} snapshot failed:`, err.message);
    if (global.Sentry) global.Sentry.captureException(err);
  });

  const timer = setInterval(run, config.intervalMin * 60 * 1000);
  timer.unref();

  const shutdown = () => { run().catch(() => {}); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(`${SNAPSHOT_MARKER} loop started (every ${config.intervalMin} min, bucket=${config.bucket})`);
}

module.exports = { restoreLatestSnapshot, snapshotNow, startSnapshotLoop };
