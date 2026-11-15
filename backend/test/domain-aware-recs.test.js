const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EmailSecurityAuditor } = require('../src/services/auditEngine');

function auditor() {
  return new EmailSecurityAuditor();
}

const okSpf = (over) => ({ found: true, valid: true, policy: 'hardfail', lookupCount: 8, errors: [], warnings: [], ...over });
const okDkim = (over) => ({ found: true, selectors: [{ selector: 'default', valid: true, keySize: '2048-bit' }], errors: [], warnings: [], ...over });
const okDmarc = (over) => ({ found: true, policy: 'reject', reporting: { aggregate: 'mailto:x@y.com' }, errors: [], warnings: [], ...over });
const okMta = (over) => ({ found: true, mode: 'enforce', errors: [], warnings: [], ...over });
const okRpt = (over) => ({ found: true, errors: [], warnings: [], ...over });

describe('generateRecommendations — domain-aware text', () => {
  test('missing SPF rec injects the real domain', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf({ found: false }), okDkim(), okDmarc(), okMta(), okRpt(), { threats: [] });
    const spfRec = recs.find(r => r.target === 'SPF');
    assert.ok(spfRec);
    assert.equal(spfRec.command, 'v=spf1 include:_spf.acme.test ~all');
  });

  test('missing DMARC rec injects a real rua address', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc({ found: false }), okMta(), okRpt(), { threats: [] });
    const rec = recs.find(r => r.target === 'DMARC');
    assert.ok(rec);
    assert.match(rec.command, /rua=mailto:dmarc-reports@acme\.test/);
    assert.ok(!/example\.com|yourmailprovider/.test(rec.command));
  });

  test('DMARC policy none upgrade rec carries the domain rua', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc({ policy: 'none' }), okMta(), okRpt(), { threats: [] });
    const rec = recs.find(r => r.target === 'DMARC');
    assert.equal(rec.action, 'Upgrade DMARC to quarantine');
    assert.match(rec.command, /p=quarantine; rua=mailto:dmarc-reports@acme\.test/);
  });

  test('missing TLS-RPT rec uses the domain in the rua address', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc(), okMta(), okRpt({ found: false }), { threats: [] });
    const rec = recs.find(r => r.target === 'TLS-RPT');
    assert.ok(rec);
    assert.equal(rec.command, 'v=TLSRPTv1; rua=mailto:tls-reports@acme.test');
  });

  test('SPF over the 10-lookup limit produces a flatten rec', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf({ lookupCount: 12 }), okDkim(), okDmarc(), okMta(), okRpt(), { threats: [] });
    const rec = recs.find(r => r.target === 'SPF' && /Flatten/.test(r.action));
    assert.ok(rec);
    assert.equal(rec.priority, 'high');
    assert.match(rec.action, /12 DNS lookups exceeds the RFC 7208 limit of 10/);
  });

  test('SPF within the lookup limit gets no flatten rec', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf({ lookupCount: 10 }), okDkim(), okDmarc(), okMta(), okRpt(), { threats: [] });
    assert.ok(!recs.some(r => /Flatten/.test(r.action)));
  });

  test('impersonation threats surface as a high-priority recommendation', () => {
    const imp = {
      summary: 'High risk - immediate action required',
      threats: [{ severity: 'high', type: 'SPF +all', message: 'SPF ends with +all' }],
    };
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc(), okMta(), okRpt(), imp);
    const rec = recs.find(r => r.target === 'Impersonation');
    assert.ok(rec);
    assert.equal(rec.priority, 'high');
    assert.match(rec.action, /1 impersonation threat/);
  });

  test('medium-severity impersonation threats get medium priority', () => {
    const imp = {
      summary: 'Medium risk - review recommended',
      threats: [{ severity: 'medium', type: 'DMARC No Policy', message: 'policy none' }],
    };
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc(), okMta(), okRpt(), imp);
    assert.equal(recs.find(r => r.target === 'Impersonation').priority, 'medium');
  });

  test('DMARC without aggregate reporting gets an rua rec', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc({ reporting: {} }), okMta(), okRpt(), { threats: [] });
    const rec = recs.find(r => r.target === 'DMARC' && /aggregate reporting/.test(r.action));
    assert.ok(rec);
    assert.match(rec.command, /dmarc-reports@acme\.test/);
  });

  test('a fully healthy domain produces no recommendations', () => {
    const recs = auditor().generateRecommendations('acme.test', okSpf(), okDkim(), okDmarc(), okMta(), okRpt(), { threats: [] });
    assert.deepEqual(recs, []);
  });
});
