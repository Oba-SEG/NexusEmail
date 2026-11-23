const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_ROOT = path.join(process.cwd(), 'data', 'evidence');

function evidenceRoot() {
  return path.resolve(process.env.EVIDENCE_DIR || DEFAULT_ROOT);
}

function extensionFor(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('json')) return 'json';
  if (value.includes('png')) return 'png';
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  if (value.includes('webp')) return 'webp';
  if (value.includes('html')) return 'html';
  if (value.includes('text/plain')) return 'txt';
  return 'bin';
}

// Content-addressed: repeated collections of different bytes get different
// paths, so a failed row upsert can never leave an existing `ok` row
// pointing at content that no longer matches its recorded sha256.
function artifactKey(orgId, brandId, threatId, kind, mime, sha256) {
  const safeKind = String(kind || 'artifact').replace(/[^a-z0-9_-]/gi, '_');
  const digest = /^[0-9a-f]{64}$/.test(String(sha256 || '')) ? String(sha256).slice(0, 16) : 'nohash';
  return path.posix.join(String(orgId), String(brandId), String(threatId), `${safeKind}-${digest}.${extensionFor(mime)}`);
}

async function putArtifact({ orgId, brandId, threatId, kind, buffer, mime }) {
  const root = evidenceRoot();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storageKey = artifactKey(orgId, brandId, threatId, kind, mime, sha256);
  const target = path.resolve(root, storageKey);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid evidence storage path');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return {
    storage_key: storageKey,
    bytes: buffer.length,
    sha256,
  };
}

async function readArtifact(storageKey) {
  const root = evidenceRoot();
  const target = path.resolve(root, String(storageKey || ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid evidence storage path');
  return fs.readFile(target);
}

module.exports = { evidenceRoot, putArtifact, readArtifact };
