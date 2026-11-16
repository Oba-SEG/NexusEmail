const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Load database.js without connecting: stub pg Pool construction side effects
// by reading the source and extracting the pure helper functions.
const src = fs.readFileSync(path.join(__dirname, '../src/db/database.js'), 'utf8');

// Evaluate just the two helpers in isolation (they are pure).
const sandbox = {};
const helperSrc = src.slice(
  src.indexOf('function isMaskedEcho'),
  src.indexOf('async function mergeSetting')
);
new Function('exports', helperSrc + '\nexports.preserveMaskedSecrets = preserveMaskedSecrets;')(sandbox);

function preserveMaskedSecrets(current, patch) {
  sandbox.preserveMaskedSecrets(current, patch);
  return patch;
}

test('masked echo of a stored secret is replaced by the stored value (nested provider map)', () => {
  const current = { cloudflare: { api_key: 'cf-abc123', email: 'ops@x.com' } };
  const patch = { cloudflare: { api_key: 'cf-a****', email: 'ops@x.com' } };
  preserveMaskedSecrets(current, patch);
  assert.equal(patch.cloudflare.api_key, 'cf-abc123', 'stored secret survives');
  assert.equal(patch.cloudflare.email, 'ops@x.com');
});

test('a genuinely new secret overwrites the stored one', () => {
  const current = { cloudflare: { api_key: 'cf-abc123' } };
  const patch = { cloudflare: { api_key: 'new-token-9999' } };
  preserveMaskedSecrets(current, patch);
  assert.equal(patch.cloudflare.api_key, 'new-token-9999');
});

test('masked value for an unknown provider is left as-is (test route rejects this case)', () => {
  const current = { cloudflare: { api_key: 'cf-abc123' } };
  const patch = { godaddy: { api_key: 'gd-x****' } };
  preserveMaskedSecrets(current, patch);
  assert.equal(patch.godaddy.api_key, 'gd-x****', 'nothing to preserve');
});

test('top-level masked string (flat secret map) is preserved', () => {
  const current = { slack_webhook: 'https://hooks.slack.com/T000' };
  const patch = { slack_webhook: 'http****' };
  preserveMaskedSecrets(current, patch);
  assert.equal(patch.slack_webhook, 'https://hooks.slack.com/T000');
});

test('prefix mismatch keeps the incoming value (real new secret starting with same chars)', () => {
  const current = { provider: { api_key: 'cf-abc123' } };
  const patch = { provider: { api_key: 'cf-ab****' } };
  preserveMaskedSecrets(current, patch);
  assert.equal(patch.provider.api_key, 'cf-ab****');
});
