const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { putArtifact, readArtifact } = require('../src/services/evidence/storage');

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
      buffer: Buffer.from('<html>evidence</html>'),
    });
    assert.equal(stored.storage_key, 'org-1/7/42/http.html');
    assert.equal(stored.bytes, 21);
    assert.match(stored.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readArtifact(stored.storage_key)).toString(), '<html>evidence</html>');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.EVIDENCE_DIR;
  }
});

test('evidence storage rejects traversal keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-evidence-test-'));
  process.env.EVIDENCE_DIR = root;
  try {
    await assert.rejects(() => readArtifact('../outside.txt'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.EVIDENCE_DIR;
  }
});
