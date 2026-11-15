const { test, describe } = require('node:test');
const assert = require('node:assert');
const { DmarcReportIngestor, parseAggregateXml, ruaDestination, ruaTargetsFromRecord, reportMatchesDomain, sameOrganizationalDomain } = require('../src/services/dmarcReportParser');

// RFC 7489 appendix C style sample: one aligned row, one failing row.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <extra_contact_info>https://support.google.com/a/answer/2466580</extra_contact_info>
    <report_id>2026-11-01T00:00:00Z</report_id>
    <date_range><begin>1764460800</begin><end>1764547199</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>acme.test</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>quarantine</p>
    <sp>quarantine</sp>
    <pct>100</pct>
    <rua>mailto:dmarc@acme.test,mailto:agg@thirdparty.example</rua>
  </policy_published>
  <record>
    <row>
      <source_ip>64.233.166.10</source_ip>
      <count>2</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>acme.test</header_from>
      <envelope_from>acme.test</envelope_from>
    </identifiers>
    <auth_results>
      <dkim><domain>acme.test</domain><result>pass</result><selector>s1</selector></dkim>
      <spf><domain>acme.test</domain><result>pass</result></spf>
    </auth_results>
  </record>
  <record>
    <row>
      <source_ip>203.0.113.7</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>quarantine</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>acme.test</header_from>
      <envelope_from>spam.bad.example</envelope_from>
    </identifiers>
    <auth_results>
      <dkim><domain>bad.example</domain><result>fail</result></dkim>
      <spf><domain>bad.example</domain><result>fail</result></spf>
    </auth_results>
  </record>
</feedback>`;

describe('parseAggregateXml', () => {
  test('parses a full RFC 7489 aggregate report', () => {
    const r = parseAggregateXml(SAMPLE_XML);
    assert.equal(r.orgName, 'google.com');
    assert.equal(r.reportId, '2026-11-01T00:00:00Z');
    assert.equal(r.begin, 1764460800);
    assert.equal(r.end, 1764547199);
    assert.equal(r.policyPublished.domain, 'acme.test');
    assert.equal(r.policyPublished.p, 'quarantine');
    assert.equal(r.policyPublished.pct, 100);
    assert.deepEqual(r.policyPublished.rua, ['dmarc@acme.test', 'agg@thirdparty.example']);
    assert.equal(r.records.length, 2);

    assert.equal(r.records[0].sourceIp, '64.233.166.10');
    assert.equal(r.records[0].count, 2);
    assert.equal(r.records[0].dkimAligned, true);
    assert.equal(r.records[0].spfAligned, true);
    assert.equal(r.records[0].disposition, 'none');
    assert.equal(r.records[0].headerFrom, 'acme.test');
    assert.equal(r.records[0].dkimResults[0].result, 'pass');

    assert.equal(r.records[1].sourceIp, '203.0.113.7');
    assert.equal(r.records[1].count, 5);
    assert.equal(r.records[1].dkimAligned, false);
    assert.equal(r.records[1].spfAligned, false);
    assert.equal(r.records[1].disposition, 'quarantine');
    assert.equal(r.records[1].envelopeFrom, 'spam.bad.example');
  });

  test('empty XML is rejected', () => {
    assert.throws(() => parseAggregateXml(''), /empty XML/);
    assert.throws(() => parseAggregateXml('   '), /empty XML/);
  });

  test('malformed XML is rejected', () => {
    assert.throws(() => parseAggregateXml('<feedback><unclosed>'), /XML parse failed|invalid aggregate report/);
  });

  test('mismatched closing tags are rejected via parser validation', () => {
    // fast-xml-parser skips validation without the second parse arg and
    // would let `</feedback>` in place of `</policy_published>` through
    const bad = SAMPLE_XML.replace('</policy_published>', '</feedback>');
    assert.throws(() => parseAggregateXml(bad), /XML parse failed/);
  });

  test('wrong root element is rejected', () => {
    assert.throws(() => parseAggregateXml('<notfeedback></notfeedback>'), /root element must be <feedback>/);
  });

  test('missing policy_published.domain is rejected', () => {
    assert.throws(() => parseAggregateXml('<feedback><record><row><count>1</count></row></record></feedback>'), /policy_published\.domain is required/);
  });

  test('non-integer counts are rejected', () => {
    const bad = SAMPLE_XML.replace('<count>2</count>', '<count>two</count>');
    assert.throws(() => parseAggregateXml(bad), /record 0 has a missing or non-integer <count>/);
  });

  test('reports above the record limit are rejected, not truncated', () => {
    const rows = Array.from({ length: 10001 }, (_, i) => `<record><row><source_ip>1.2.3.${i % 256}</source_ip><count>1</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>acme.test</header_from></identifiers></record>`).join('\n');
    const bad = `<?xml version="1.0"?><feedback><policy_published><domain>acme.test</domain><p>none</p></policy_published>${rows}</feedback>`;
    assert.throws(() => parseAggregateXml(bad), /exceeds the 10000 record limit/);
  });

  test('single record is normalized to an array', () => {
    const one = `<?xml version="1.0"?><feedback><policy_published><domain>acme.test</domain><p>none</p></policy_published><record><row><source_ip>1.2.3.4</source_ip><count>1</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>acme.test</header_from></identifiers></record></feedback>`;
    const r = parseAggregateXml(one);
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].dkimAligned, true);
    assert.equal(r.records[0].spfAligned, false);
    assert.equal(r.records[0].sourceIp, '1.2.3.4');
  });
});

describe('ruaDestination', () => {
  test('extracts the host of a mailto target', () => {
    assert.equal(ruaDestination('mailto:agg@ThirdParty.example'), 'thirdparty.example');
    assert.equal(ruaDestination('dmarc@acme.test'), 'acme.test');
    assert.equal(ruaDestination('nonsense'), null);
  });
  test('strips the report-size suffix before extracting the host', () => {
    assert.equal(ruaDestination('agg@thirdparty.example!10m'), 'thirdparty.example');
    assert.equal(ruaDestination('mailto:agg@thirdparty.example!10m'), 'thirdparty.example');
  });
});

describe('ruaTargetsFromRecord', () => {
  test('extracts mailto targets from a published DMARC record', () => {
    assert.deepEqual(
      ruaTargetsFromRecord(['v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.test,mailto:agg@thirdparty.example!10m']),
      ['dmarc@acme.test', 'agg@thirdparty.example!10m']
    );
  });
  test('returns [] when no rua tag exists', () => {
    assert.deepEqual(ruaTargetsFromRecord(['v=DMARC1; p=reject']), []);
  });
});

describe('sameOrganizationalDomain / reportMatchesDomain', () => {
  test('org-domain equality via the PSL', () => {
    assert.equal(sameOrganizationalDomain('news.example.com', 'example.com'), true);
    assert.equal(sameOrganizationalDomain('example.com', 'example.org'), false);
  });
  test('report matches target or target subdomain of reported domain', () => {
    assert.equal(reportMatchesDomain({ policyPublished: { domain: 'acme.test' } }, 'acme.test'), true);
    assert.equal(reportMatchesDomain({ policyPublished: { domain: 'acme.test' } }, 'ACME.TEST'), true);
    assert.equal(reportMatchesDomain({ policyPublished: { domain: 'acme.test' } }, 'news.acme.test'), true);
    assert.equal(reportMatchesDomain({ policyPublished: { domain: 'acme.test' } }, 'other.test'), false);
    assert.equal(reportMatchesDomain({ policyPublished: { domain: 'news.acme.test' } }, 'acme.test'), false);
  });
});

describe('DmarcReportIngestor', () => {
  const fakeResolver = (recordsByName) => new DmarcReportIngestor({
    txtResolver: (name, cb) => {
      if (name in recordsByName) cb(null, recordsByName[name]);
      else cb(Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' }));
    },
  });

  test('ext-rec: authorized when destination publishes v=DMARC1', async () => {
    const ing = fakeResolver({
      'acme.test._report._dmarc.thirdparty.example': [['v=DMARC1; rua=mailto:agg@thirdparty.example']],
    });
    const checks = await ing.checkExtRecAuth('acme.test', ['dmarc@acme.test', 'agg@thirdparty.example']);
    assert.deepEqual(checks, [
      { destination: 'acme.test', status: 'self' },
      { destination: 'thirdparty.example', status: 'authorized' },
    ]);
  });

  test('ext-rec: same organizational domain needs no authorization', async () => {
    const ing = fakeResolver({});
    const checks = await ing.checkExtRecAuth('news.example.com', ['reports@example.com']);
    assert.deepEqual(checks, [{ destination: 'example.com', status: 'self' }]);
  });

  test('ext-rec: authorization query uses the policy-publishing domain', async () => {
    const ing = fakeResolver({
      'example.com._report._dmarc.thirdparty.example': [['v=DMARC1']],
    });
    const checks = await ing.checkExtRecAuth('example.com', ['agg@thirdparty.example']);
    assert.deepEqual(checks, [{ destination: 'thirdparty.example', status: 'authorized' }]);
  });

  test('ext-rec: not_authorized when the destination publishes nothing (NXDOMAIN)', async () => {
    const ing = fakeResolver({});
    const checks = await ing.checkExtRecAuth('acme.test', ['agg@thirdparty.example']);
    assert.deepEqual(checks, [{ destination: 'thirdparty.example', status: 'not_authorized' }]);
  });

  test('ext-rec: unknown on unexpected resolver failure', async () => {
    const ing = new DmarcReportIngestor({
      txtResolver: (name, cb) => cb(Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' })),
    });
    const checks = await ing.checkExtRecAuth('acme.test', ['agg@thirdparty.example']);
    assert.deepEqual(checks, [{ destination: 'thirdparty.example', status: 'unknown' }]);
  });

  test('analyze computes totals, failing sources and ext-rec state', async () => {
    const ing = fakeResolver({
      'acme.test._report._dmarc.thirdparty.example': [['v=DMARC1']],
    });
    const parsed = parseAggregateXml(SAMPLE_XML);
    const ins = await ing.analyze(parsed, 'acme.test', {
      publishedRua: ['dmarc@acme.test', 'agg@thirdparty.example'],
    });
    assert.equal(ins.totalMessages, 7);
    assert.equal(ins.passingMessages, 2);
    assert.equal(ins.failingMessages, 5);
    assert.deepEqual(ins.failingSources, [{ ip: '203.0.113.7', count: 5 }]);
    assert.deepEqual(ins.extRecChecks, [
      { destination: 'acme.test', status: 'self' },
      { destination: 'thirdparty.example', status: 'authorized' },
    ]);
  });

  test('ingest resolves destinations from the live policy, not the XML', async () => {
    // RFC 7489 policy_published has no rua element — the ingestor must
    // read the domain's published DMARC record via the resolver
    const ing = fakeResolver({
      '_dmarc.acme.test': [['v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.test,mailto:agg@thirdparty.example!10m']],
      'acme.test._report._dmarc.thirdparty.example': [['v=DMARC1']],
    });
    const { report, insights } = await ing.ingest(SAMPLE_XML, 'acme.test');
    assert.equal(report.reportId, '2026-11-01T00:00:00Z');
    assert.equal(insights.reportedPolicyDomain, 'acme.test');
    assert.equal(insights.ruaPolicyDomain, 'acme.test');
    assert.deepEqual(insights.extRecChecks, [
      { destination: 'acme.test', status: 'self' },
      { destination: 'thirdparty.example', status: 'authorized' },
    ]);
  });

  test('ingest rejects reports for unrelated domains', async () => {
    const ing = fakeResolver({});
    await assert.rejects(
      () => ing.ingest(SAMPLE_XML, 'other.test'),
      /aggregate report is for acme\.test, not other\.test/
    );
  });

  test('inherited-policy reports are scoped to the target domain', async () => {
    // a record for news.acme.test inside an acme.test report: only that
    // record counts as subdomain traffic
    const subRecord = `<record><row><source_ip>198.51.100.9</source_ip><count>3</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>news.acme.test</header_from></identifiers></record>`;
    const mixed = SAMPLE_XML.replace('</feedback>', `${subRecord}</feedback>`);
    const ing = fakeResolver({ '_dmarc.news.acme.test': [['v=DMARC1']] });
    const { report, insights } = await ing.ingest(mixed, 'news.acme.test');
    assert.equal(report.records.length, 1);
    assert.equal(insights.totalMessages, 3);
    assert.equal(insights.passingMessages, 3);
    assert.equal(insights.failingMessages, 0);
  });

  test('ingest rejects inherited reports with no records for the target', async () => {
    // SAMPLE_XML only contains header_from=acme.test traffic — none of
    // it is news.acme.test traffic, so nothing may be counted or stored
    const ing = fakeResolver({ '_dmarc.news.acme.test': [['v=DMARC1']] });
    await assert.rejects(
      () => ing.ingest(SAMPLE_XML, 'news.acme.test'),
      /no records for news\.acme\.test/
    );
  });

  test('ingest falls back to the org-domain policy when the target has none', async () => {
    // news.example.com has no _dmarc record; example.com publishes an
    // external rua — the fallback policy domain must be used both for
    // destinations and for the §7.1 authorization query
    const ing = fakeResolver({
      '_dmarc.example.com': [['v=DMARC1; rua=mailto:agg@thirdparty.example']],
      'example.com._report._dmarc.thirdparty.example': [['v=DMARC1']],
    });
    const subRecord = `<record><row><source_ip>198.51.100.9</source_ip><count>3</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>news.example.com</header_from></identifiers></record>`;
    const xml = `<?xml version="1.0"?><feedback><report_metadata><org_name>r</org_name><report_id>x</report_id><date_range><begin>1</begin><end>2</end></date_range></report_metadata><policy_published><domain>example.com</domain><p>none</p></policy_published>${subRecord}</feedback>`;
    const { insights } = await ing.ingest(xml, 'news.example.com');
    assert.equal(insights.ruaPolicyDomain, 'example.com');
    assert.deepEqual(insights.extRecChecks, [{ destination: 'thirdparty.example', status: 'authorized' }]);
  });

  test('fallback also runs when the target has TXT records but no DMARC record', async () => {
    // RFC 7489 §6.6.3: inheritance applies when no DMARC record remains
    // after filtering — an unrelated TXT at the target is not a policy
    const ing = fakeResolver({
      '_dmarc.news.example.com': [['some unrelated txt record']],
      '_dmarc.example.com': [['v=DMARC1; rua=mailto:agg@thirdparty.example']],
      'example.com._report._dmarc.thirdparty.example': [['v=DMARC1']],
    });
    const subRecord = `<record><row><source_ip>198.51.100.9</source_ip><count>3</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>news.example.com</header_from></identifiers></record>`;
    const xml = `<?xml version="1.0"?><feedback><report_metadata><org_name>r</org_name><report_id>x</report_id><date_range><begin>1</begin><end>2</end></date_range></report_metadata><policy_published><domain>example.com</domain><p>none</p></policy_published>${subRecord}</feedback>`;
    const { insights } = await ing.ingest(xml, 'news.example.com');
    assert.equal(insights.ruaPolicyDomain, 'example.com');
    assert.deepEqual(insights.extRecChecks, [{ destination: 'thirdparty.example', status: 'authorized' }]);
  });

  test('org domain without a DMARC record yields no destinations', async () => {
    const ing = fakeResolver({
      '_dmarc.news.example.com': [['unrelated txt']],
    });
    const subRecord = `<record><row><source_ip>198.51.100.9</source_ip><count>3</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>news.example.com</header_from></identifiers></record>`;
    const xml = `<?xml version="1.0"?><feedback><report_metadata><org_name>r</org_name><report_id>x</report_id><date_range><begin>1</begin><end>2</end></date_range></report_metadata><policy_published><domain>example.com</domain><p>none</p></policy_published>${subRecord}</feedback>`;
    const { insights } = await ing.ingest(xml, 'news.example.com');
    assert.equal(insights.ruaPolicyDomain, 'news.example.com');
    assert.deepEqual(insights.extRecChecks, []);
  });

  test('ingest without a published DMARC record skips ext-rec checks', async () => {
    const ing = fakeResolver({});
    const { insights } = await ing.ingest(SAMPLE_XML, 'acme.test');
    assert.deepEqual(insights.extRecChecks, []);
  });

  test('transient resolver failures do not fall back to the org policy', async () => {
    const ing = new DmarcReportIngestor({
      txtResolver: (name, cb) => cb(Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' })),
    });
    const { insights } = await ing.ingest(SAMPLE_XML, 'acme.test');
    assert.equal(insights.ruaPolicyDomain, 'acme.test');
    assert.deepEqual(insights.extRecChecks, []);
  });
});
