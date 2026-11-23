const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { putArtifact, readArtifact } = require('../src/services/evidence/storage');

const SAMPLE = Buffer.from('<html>evidence</html>');

function expectedKey(suffix) {
  const sha = crypto.createHash('sha256').update(SAMPLE).digest('hex');
  return `org-1/7/42/http-${sha.slice(0, 16)}.${suffix}`;
}

test('evidence storage writes and reads artifacts under the configured root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-evidence-test-'));
  process.env.EVIDENCE_DIR = root;
  try {
    const stored = await putArtifact({
      orgId: 'org-1',
      brandId: 7,
      threatId: 42,
      kind: 'http',
      mime: 'text/html',
      buffer: SAMPLE,
    });
    assert.equal(stored.storage_key, expectedKey('html'));
    assert.equal(stored.bytes, 21);
    assert.match(stored.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readArtifact(stored.storage_key)).toString(), '<html>evidence</html>');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.EVIDENCE_DIR;
  }
});

test('changed content lands at a new key so an existing row keeps matching bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-evidence-test-'));
  process.env.EVIDENCE_DIR = root;
  try {
    const base = { orgId: 'org-1', brandId: 7, threatId: 42, kind: 'http', mime: 'text/html' };
    const first = await putArtifact({ ...base, buffer: SAMPLE });
    const second = await putArtifact({ ...base, buffer: Buffer.from('<html>different</html>') });
    assert.notEqual(second.storage_key, first.storage_key);
    assert.equal((await readArtifact(first.storage_key)).toString(), '<html>evidence</html>');
    assert.equal((await readArtifact(second.storage_key)).toString(), '<html>different</html>');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.EVIDENCE_DIR;
  }
});

test('evidence storage rejects traversal keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-evidence-test-'));
  process.env.EVIDENCE_DIR = root;
  try {
    await assert.rejects(
      () => readArtifact('../outside.txt'),
      /Invalid evidence storage path/,
    );
    await assert.rejects(
      () => putArtifact({ orgId: '../..', brandId: 7, threatId: 42, kind: 'http', mime: 'text/html', buffer: SAMPLE }),
      /Invalid evidence storage path/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.EVIDENCE_DIR;
  }
});
