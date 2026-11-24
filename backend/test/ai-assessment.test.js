const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  deterministicAssessment,
  validateModelAssessment,
  buildAssessmentInput,
  evidenceHash,
} = require('../src/services/ai/assessment');
const { computeEvidenceGaps } = require('../src/services/ai/gaps');

const threat = {
  id: 7,
  org_id: 'org_1',
  brand_id: 2,
  domain: 'segbvtes.xyz',
  threat_type: 'phishing',
  severity: 'high',
  risk_score: null,
  source: 'brand_scan',
  detected_at: '2026-01-01T00:00:00.000Z',
};
const brand = { id: 2, name: 'Segbytes', domain: 'segbytes.xyz' };
const artifacts = [
  { id: 101, kind: 'dns', status: 'ok', metadata: { records: { a: ['203.0.113.10'] } } },
  { id: 102, kind: 'rdap', status: 'ok', metadata: { data: { ldhName: 'SEGBVTES.XYZ', status: ['client transfer prohibited'], nameservers: ['ns1.example.com'] } } },
  { id: 103, kind: 'http', status: 'ok', metadata: { http_status: 200, headers: { server: 'nginx' }, title: 'Sign in', login_form: true, payment_form: false } },
  { id: 104, kind: 'tls', status: 'partial', metadata: { authorized: false, issuer: { O: 'Test CA' }, valid_to: '2026-02-01T00:00:00.000Z' } },
  { id: 105, kind: 'screenshot', status: 'skipped', metadata: { reason: 'not configured' } },
];

describe('deterministic triage assessment', () => {
  test('cites collected artifacts and proposes the registrar route', () => {
    const result = deterministicAssessment(threat, brand, artifacts);
    assert.equal(result.recommended_route, 'registrar');
    assert.deepEqual(result.citations, [101, 102, 103]);
    assert.ok(result.risk_score >= 80);
    assert.ok(result.summary.includes('#101'));
    assert.ok(result.signals.some((signal) => signal.key === 'login_form'));
  });

  test('degrades to unknown with no evidence instead of inventing facts', () => {
    const result = deterministicAssessment(threat, brand, []);
    assert.equal(result.recommended_route, 'unknown');
    assert.deepEqual(result.citations, []);
    assert.ok(result.confidence <= 0.6);
  });

  test('fingerprints evidence changes for follow-up assessments', () => {
    const base = evidenceHash(artifacts);
    assert.equal(evidenceHash([...artifacts]), base);
    assert.notEqual(evidenceHash([...artifacts, { id: 106, kind: 'upload_screenshot', status: 'ok' }]), base);
    assert.notEqual(evidenceHash(artifacts.map((artifact) => (
      artifact.id === 103 ? { ...artifact, metadata: { ...artifact.metadata, title: 'Changed' } } : artifact
    ))), base);
  });

  test('builds typed input without raw certificate blobs', () => {
    const input = buildAssessmentInput(threat, brand, [{ ...artifacts[2], metadata: { ...artifacts[2].metadata, body: '<html>secret</html>' } }]);
    assert.equal(input.artifacts[0].title, 'Sign in');
    assert.equal(input.artifacts[0].body, undefined);
  });
});

describe('model assessment validation', () => {
  const valid = {
    threat_type: 'phishing',
    risk_score: 88,
    confidence: 0.8,
    recommended_route: 'registrar',
    summary: 'The page imitates the brand login and is hosted on a lookalike domain.',
    signals: [{ key: 'login-form', label: 'Login form', value: 'Password input observed.' }],
    citations: [103],
  };

  test('accepts cited, in-range output', () => {
    const result = validateModelAssessment(valid, [101, 102, 103]);
    assert.equal(result.citations[0], 103);
    assert.equal(result.signals[0].key, 'login_form');
  });

  test('rejects uncited or out-of-range output', () => {
    assert.throws(() => validateModelAssessment({ ...valid, citations: [] }, [101, 103]), /citations/);
    assert.throws(() => validateModelAssessment({ ...valid, citations: [999] }, [101, 103]), /citations/);
    assert.throws(() => validateModelAssessment({ ...valid, risk_score: 120 }, [101, 103]), /risk_score/);
  });
});

describe('evidence gap engine', () => {
  test('requests uploads for missing proof and phishing email', () => {
    const gaps = computeEvidenceGaps(threat, artifacts, 'registrar');
    assert.deepEqual(gaps.map((gap) => gap.key), ['screenshot', 'trademark_certificate', 'authorization_letter', 'phishing_email']);
    assert.ok(gaps.every((gap) => gap.user_action_required));
  });

  test('drops items once an uploaded artifact exists', () => {
    const uploaded = [
      ...artifacts,
      { id: 201, kind: 'upload_screenshot', status: 'ok', storage_key: 'x' },
      { id: 202, kind: 'upload_trademark_certificate', status: 'ok' },
    ];
    const gaps = computeEvidenceGaps(threat, uploaded, 'registrar');
    assert.ok(!gaps.some((gap) => gap.key === 'screenshot'));
    assert.ok(!gaps.some((gap) => gap.key === 'trademark_certificate'));
  });
});
