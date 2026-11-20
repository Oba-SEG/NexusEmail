// Regression coverage for the report builder: MTA-STS/TLS-RPT passthrough,
// distinct issue counting, report content, share tokens, and schedule logic.
// Run with: npm test  (node --test test/)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDnsResults,
  distinctIssues,
  buildDomainReport,
  buildPortfolioReport,
  signShareToken,
  verifyShareToken,
  isScheduleDue,
  parseRecipients,
  scheduleConfigHash,
  dmarcSummary,
} = require('../src/services/reportBuilder');

const SECRET = 'test-secret';

test('normalizes MTA-STS and TLS-RPT from stored audit objects', () => {
  const r = normalizeDnsResults({
    spf_record: '{"found":true,"record":"v=spf1 -all","policy":"hardfail"}',
    dmarc_record: '{"found":true,"record":"v=DMARC1; p=reject","policy":"reject"}',
    mta_sts_record: '{"found":true,"record":"v=STSv1; id=1","mode":"enforce","maxAge":86400}',
    tls_rpt_record: '{"found":true,"reporting":{"rua":["mailto:tls@example.com"]}}',
  });
  assert.equal(r.mta_sts.status, 'FOUND');
  assert.equal(r.mta_sts.mode, 'enforce');
  assert.equal(r.mta_sts.maxAge, 86400);
  assert.equal(r.tls_rpt.status, 'FOUND');
  assert.match(r.tls_rpt.reporting, /tls@example\.com/);
});

test('falls back to score_breakdown for MTA-STS and TLS-RPT on old scans', () => {
  const r = normalizeDnsResults({
    score_breakdown: { spf: 25, dkim: 20, dmarc: 10, mta_sts: 15, tls_rpt: 0 },
  });
  assert.equal(r.mta_sts.status, 'FOUND');
  assert.equal(r.tls_rpt.status, 'NOT_FOUND');
});

test('distinctIssues dedupes repeated findings and sorts by severity', () => {
  const issues = distinctIssues({
    issues: JSON.stringify([
      { type: 'SPF', severity: 'medium', message: 'Weak all' },
      { type: 'DMARC', severity: 'high', message: 'p=none' },
      { type: 'SPF', severity: 'medium', message: 'Weak all' },
      { type: 'TLS-RPT', severity: 'low', message: 'No rua' },
    ]),
  });
  assert.equal(issues.length, 3);
  assert.equal(issues[0].severity, 'high');
  assert.equal(issues[1].type, 'SPF');
});

test('dmarcSummary collapses duplicate ingests and counts aligned messages', () => {
  const reports = [
    {
      id: 1, report: {
        orgName: 'google.com', reportId: 'r1', begin: 1000, end: 2000,
        records: [{ count: 10, spfAligned: true, dkimAligned: false }, { count: 5, spfAligned: false, dkimAligned: false }],
      },
    },
    {
      id: 2, report: {
        orgName: 'google.com', reportId: 'r1', begin: 1000, end: 2000,
        records: [{ count: 10, spfAligned: true, dkimAligned: false }, { count: 5, spfAligned: false, dkimAligned: false }],
      },
    },
  ];
  const s = dmarcSummary(reports);
  assert.equal(s.reports, 1);
  assert.equal(s.messages, 15);
  assert.equal(s.aligned, 10);
  assert.equal(s.failed, 5);
});

test('buildDomainReport renders mta-sts evidence, trend, issues and recommendations', () => {
  const scans = [
    { score: 40, scanned_at: '2026-11-18T00:00:00.000Z', issues: '[]' },
    {
      score: 75,
      scanned_at: '2026-11-19T00:00:00.000Z',
      score_breakdown: { spf: 35, dkim: 20, dmarc: 10, mta_sts: 10, tls_rpt: 0, max: { spf: 35, dkim: 30, dmarc: 35, mta_sts: 15, tls_rpt: 5 } },
      spf_record: '{"found":true,"record":"v=spf1 include:example.com ~all","policy":"softfail"}',
      dmarc_record: '{"found":true,"record":"v=DMARC1; p=none","policy":"none"}',
      mta_sts_record: '{"found":true,"record":"v=STSv1; id=1","mode":"testing"}',
      issues: JSON.stringify([{ type: 'DMARC', severity: 'high', message: 'p=none' }]),
      recommendations: JSON.stringify([{ priority: 'high', action: 'Enforce DMARC', command: 'v=DMARC1; p=quarantine' }]),
    },
  ];
  const built = buildDomainReport({
    domain: { name: 'example.com', provider: 'Cloudflare', verified: true },
    scans,
    rangeDays: 30,
  });
  assert.equal(built.score, 75);
  assert.equal(built.band, 'warnings');
  assert.match(built.html, /MTA-STS/);
  assert.match(built.html, /testing/);
  assert.match(built.html, /Score trend/);
  assert.match(built.html, /Enforce DMARC/);
  assert.match(built.html, /p=none/);
  assert.match(built.html, /Cloudflare/);
  assert.doesNotMatch(built.html, /linear-gradient/);
});

test('buildDomainReport flattens identical trends and qualifies empty issue lists', () => {
  const scans = [
    { score: 0, scanned_at: '2026-11-18T00:00:00.000Z', issues: '[]' },
    { score: 0, scanned_at: '2026-11-19T00:00:00.000Z', issues: '[]' },
  ];
  const built = buildDomainReport({ domain: { name: 'x.test' }, scans, rangeDays: 30 });
  assert.match(built.html, /Flat at 0\/100 across the last 2 scans/);
  assert.match(built.html, /No structured issues were reported/);
});

test('buildPortfolioReport includes every domain and an attachment-sized report', () => {
  const built = buildPortfolioReport({
    orgName: 'Segbytes',
    rows: [
      { name: 'a.test', score: 85, spf: 'Found · hardfail', dkim: 'Found', dmarc: 'Found · reject', issues: 0 },
      { name: 'b.test', score: 30, spf: 'Missing', dkim: 'Missing', dmarc: 'Missing', issues: 4 },
    ],
  });
  assert.match(built.subject, /Segbytes/);
  assert.match(built.html, /a\.test/);
  assert.match(built.html, /b\.test/);
  assert.equal(built.atRisk, 1);
  assert.match(built.text, /Average score/);
});

test('share tokens verify, reject tampering, and expire', () => {
  const now = Date.now();
  const token = signShareToken(42, now + 60_000, SECRET);
  assert.deepEqual(verifyShareToken(token, SECRET, now), { reportId: 42, expiresAt: now + 60_000 });
  assert.equal(verifyShareToken(token, 'wrong-secret', now), null);
  assert.equal(verifyShareToken(token.slice(0, -2) + 'xx', SECRET, now), null);
  assert.equal(verifyShareToken(signShareToken(42, now - 1, SECRET), SECRET, now), null);
  assert.equal(verifyShareToken('not-a-token', SECRET, now), null);
});

test('isScheduleDue honours frequency and last run', () => {
  const now = Date.parse('2026-11-20T00:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isScheduleDue({ enabled: true, frequency: 'daily', last_run: null }, now), true);
  assert.equal(isScheduleDue({ enabled: true, frequency: 'daily', last_run: new Date(now - day / 2).toISOString() }, now), false);
  assert.equal(isScheduleDue({ enabled: true, frequency: 'weekly', last_run: new Date(now - 6 * day).toISOString() }, now), false);
  assert.equal(isScheduleDue({ enabled: true, frequency: 'weekly', last_run: new Date(now - 7 * day).toISOString() }, now), true);
  assert.equal(isScheduleDue({ enabled: false, frequency: 'daily' }, now), false);
  assert.equal(isScheduleDue({ enabled: true, frequency: 'hourly' }, now), false);
});

test('scheduleConfigHash tracks delivery config but ignores timestamps', () => {
  const base = { enabled: true, frequency: 'weekly', recipients: 'a@example.com', slack: false };
  assert.equal(
    scheduleConfigHash({ ...base, updated_at: '2026-01-01T00:00:00.000Z' }),
    scheduleConfigHash({ ...base, updated_at: '2026-06-01T00:00:00.000Z' })
  );
  assert.notEqual(scheduleConfigHash(base), scheduleConfigHash({ ...base, recipients: 'b@example.com' }));
  assert.notEqual(scheduleConfigHash(base), scheduleConfigHash({ ...base, slack: true }));
});

test('parseRecipients validates, dedupes and caps', () => {
  const list = parseRecipients('Ops@Example.com, ops@example.com; bad@@x nope@example.org\nthird@example.net');
  assert.deepEqual(list, ['ops@example.com', 'nope@example.org', 'third@example.net']);
  const many = Array.from({ length: 30 }, (_, i) => `u${i}@example.com`).join(',');
  assert.equal(parseRecipients(many).length, 20);
});
