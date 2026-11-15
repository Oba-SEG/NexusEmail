/**
 * DMARC aggregate report ingestion v0 (issue #64).
 *
 * Parses RFC 7489 aggregate XML uploads, computes per-source
 * pass/fail alignment insights, and checks rua destinations for
 * external report-receiver authorization (RFC 7489 §7.1: the
 * destination publishes `<domain>._report._dmarc.<dest>` TXT with
 * v=DMARC1). No mail receiver yet — reports arrive via POST upload.
 *
 * The txtResolver is injectable for tests; the XML parser (fast-xml-
 * parser) never resolves external entities, so uploaded XML cannot
 * trigger XXE fetches.
 */
const { XMLParser } = require('fast-xml-parser');
const dns = require('dns');

const MAX_RECORDS = 10000;
const MAX_SOURCES_LISTED = 10;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  allowBooleanAttributes: true,
});

/** Non-negative integer from an XML text node, or null when absent. */
function asCount(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

function asTimestamp(value) {
  const n = asCount(value);
  return n === null ? null : n;
}

function asString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asPolicyValue(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  return s.length > 0 ? s : null;
}

/** Aggregate rows may be a single <record> or an <record> array. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Alignment in the row: <auth_result> pass means aligned. */
function aligned(result) {
  if (result === undefined || result === null) return null;
  return String(result).trim().toLowerCase() === 'pass';
}

/**
 * Parse an RFC 7489 aggregate report XML document.
 * Throws Error with a stable prefix on structural violations.
 */
function parseAggregateXml(xml) {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new Error('invalid aggregate report: empty XML');
  }

  let doc;
  try {
    doc = xmlParser.parse(xml);
  } catch (e) {
    throw new Error(`invalid aggregate report: XML parse failed (${e.message})`);
  }
  const feedback = doc && doc.feedback;
  if (!feedback || typeof feedback !== 'object') {
    throw new Error('invalid aggregate report: root element must be <feedback>');
  }

  const meta = feedback.report_metadata || {};
  const policy = feedback.policy_published || {};
  const policyObj = Array.isArray(policy) ? policy[0] : policy;
  const domain = asString(policyObj && policyObj.domain);
  if (!domain) {
    throw new Error('invalid aggregate report: policy_published.domain is required');
  }

  const records = asArray(feedback.record).slice(0, MAX_RECORDS).map((rec, idx) => {
    const row = (rec && rec.row) || {};
    const identifiers = (rec && rec.identifiers) || {};
    const authResults = (rec && rec.auth_results) || {};

    const count = asCount(row.count);
    if (count === null) {
      throw new Error(`invalid aggregate report: record ${idx} has a missing or non-integer <count>`);
    }

    const dkimResults = asArray(authResults.dkim).map((d) => ({
      domain: asString(d && d.domain),
      result: asString(d && d.result),
    }));
    const spfResults = asArray(authResults.spf).map((d) => ({
      domain: asString(d && d.domain),
      result: asString(d && d.result),
    }));

    return {
      sourceIp: asString(row.source_ip),
      count,
      disposition: asPolicyValue(row.policy_evaluated && row.policy_evaluated.disposition),
      dkimAligned: aligned(row.policy_evaluated && row.policy_evaluated.dkim),
      spfAligned: aligned(row.policy_evaluated && row.policy_evaluated.spf),
      headerFrom: asString(identifiers.header_from),
      envelopeFrom: asString(identifiers.envelope_from),
      dkimResults,
      spfResults,
    };
  });

  const ruaRaw = asString(policyObj.rua) || '';
  const rua = ruaRaw.split(',')
    .map((s) => s.trim().replace(/^mailto:/i, ''))
    .filter((s) => s.length > 0);

  return {
    orgName: asString(meta.org_name),
    reportId: asString(meta.report_id),
    begin: asTimestamp(meta.date_range && meta.date_range.begin),
    end: asTimestamp(meta.date_range && meta.date_range.end),
    policyPublished: {
      domain,
      adkim: asPolicyValue(policyObj.adkim),
      aspf: asPolicyValue(policyObj.aspf),
      p: asPolicyValue(policyObj.p),
      sp: asPolicyValue(policyObj.sp),
      pct: asCount(policyObj.pct),
      rua,
    },
    records,
  };
}

/** Default resolver: TXT records for a name (callback API). */
function defaultTxtResolver(name, cb) {
  dns.resolveTxt(name, cb);
}

/** The destination domain of a rua mailto target (host of the email). */
function ruaDestination(target) {
  const at = target.lastIndexOf('@');
  return at === -1 ? null : target.slice(at + 1).toLowerCase().trim();
}

class DmarcReportIngestor {
  constructor({ txtResolver } = {}) {
    this.txtResolver = txtResolver || defaultTxtResolver;
  }

  /**
   * RFC 7489 §7.1 external destination authorization: for each rua
   * destination that is not the reporting domain itself, the
   * destination must publish `<domain>._report._dmarc.<dest>` TXT
   * containing a v=DMARC1 record.
   */
  async checkExtRecAuth(reportDomain, destinations) {
    const checks = [];
    const seen = new Set();
    for (const target of destinations) {
      const dest = ruaDestination(target);
      if (!dest || seen.has(dest)) continue;
      seen.add(dest);
      if (dest === reportDomain.toLowerCase() || dest.endsWith(`.${reportDomain.toLowerCase()}`)) {
        checks.push({ destination: dest, status: 'self' });
        continue;
      }
      const status = await new Promise((resolve) => {
        this.txtResolver(`${reportDomain.toLowerCase()}._report._dmarc.${dest}`, (err, records) => {
          if (err) {
            // NXDOMAIN / no-data: the destination has not published the
            // authorization record -> not authorized. Other failures
            // (SERVFAIL, timeouts) are indeterminate -> unknown.
            const code = err.code || '';
            return resolve(['ENOTFOUND', 'ENODATA'].includes(code) ? 'not_authorized' : 'unknown');
          }
          const hit = (records || []).some((chunks) => chunks.join('').trim().toLowerCase().startsWith('v=dmarc1'));
          resolve(hit ? 'authorized' : 'not_authorized');
        });
      });
      checks.push({ destination: dest, status });
    }
    return checks;
  }

  /**
   * Compute insights from a parsed report: totals, failing sources,
   * and the ext-rec authorization state of its rua destinations.
   */
  async analyze(parsed, domain) {
    const totalMessages = parsed.records.reduce((n, r) => n + r.count, 0);
    const passing = parsed.records.filter((r) => r.dkimAligned === true || r.spfAligned === true);
    const failing = parsed.records.filter((r) => r.dkimAligned !== true && r.spfAligned !== true);

    const bySource = new Map();
    for (const r of failing) {
      const key = r.sourceIp || 'unknown';
      bySource.set(key, (bySource.get(key) || 0) + r.count);
    }
    const failingSources = [...bySource.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SOURCES_LISTED);

    const destinations = parsed.policyPublished.rua;
    const extRecChecks = await this.checkExtRecAuth(domain, destinations);

    return {
      totalMessages,
      passingMessages: passing.reduce((n, r) => n + r.count, 0),
      failingMessages: failing.reduce((n, r) => n + r.count, 0),
      failingSources,
      extRecChecks,
    };
  }

  /** Parse + analyze one uploaded XML document for a domain. */
  async ingest(xml, domain) {
    const report = parseAggregateXml(xml);
    const insights = await this.analyze(report, domain);
    return { report, insights };
  }
}

module.exports = { DmarcReportIngestor, parseAggregateXml, defaultTxtResolver, ruaDestination };
