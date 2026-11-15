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
const psl = require('psl');

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
    // second arg enables validation: without it, fast-xml-parser 5.x
    // accepts mismatched closing tags silently
    doc = xmlParser.parse(xml, true);
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

  // Reject over-large reports outright instead of silently truncating —
  // analysis and persistence must never mistake a partial report for a
  // complete one.
  const rawRecords = asArray(feedback.record);
  if (rawRecords.length > MAX_RECORDS) {
    throw new Error(`invalid aggregate report: ${rawRecords.length} records exceeds the ${MAX_RECORDS} record limit`);
  }

  const records = rawRecords.map((rec, idx) => {
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

/** The destination domain of a rua mailto target. Handles the optional
 * report-size suffix RFC 7489 allows after the URI (`!10m`), which must
 * not leak into the DNS name. */
function ruaDestination(target) {
  const withoutSize = target.split('!')[0];
  const at = withoutSize.lastIndexOf('@');
  return at === -1 ? null : withoutSize.slice(at + 1).toLowerCase().trim();
}

/**
 * RFC 7489 §6.6.3: the version tag's complete value must match DMARC1
 * exactly — 'v=DMARC10; ...' is a different version, not a prefix match.
 */
const versionTagIsDmarc1 = (chunks) => {
  const m = chunks.join('').trim().match(/^v\s*=\s*([^;]+)/i);
  return m ? m[1].trim().toUpperCase() === 'DMARC1' : false;
};

/** Extract mailto destinations from a DMARC record string. */
function ruaTargetsFromRecord(record) {
  const joined = (record || []).map((c) => (Array.isArray(c) ? c.join('') : String(c))).join('');
  const m = joined.match(/(^|;)\s*rua\s*=\s*([^;]+)/i);
  if (!m) return [];
  return m[2].split(',')
    .map((s) => s.trim().replace(/^mailto:/i, ''))
    .filter((s) => s.length > 0);
}

/** RFC 7489 §7.1 base: organizational domains match -> same org, no
 * external authorization required (news.example.com -> example.com). */
function sameOrganizationalDomain(a, b) {
  const oa = psl.get(String(a).toLowerCase());
  const ob = psl.get(String(b).toLowerCase());
  if (oa && ob) return oa === ob;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/** A report covers the target domain if policy_published.domain equals
 * the target or the target is a subdomain of it (inherited org policy). */
function reportMatchesDomain(parsed, targetDomain) {
  const reported = parsed.policyPublished.domain.toLowerCase();
  const target = String(targetDomain).toLowerCase();
  return reported === target || target.endsWith(`.${reported}`);
}

class DmarcReportIngestor {
  constructor({ txtResolver } = {}) {
    this.txtResolver = txtResolver || defaultTxtResolver;
  }

  /**
   * RFC 7489 §7.1 external destination authorization: for each rua
   * destination of the domain's PUBLISHED policy that is not in the
   * same organizational domain, the destination must publish
   * `<policyDomain>._report._dmarc.<dest>` TXT containing a v=DMARC1
   * record. policyDomain is the domain that publishes the evaluated
   * policy (the target, or its organizational domain when inheriting).
   */
  async checkExtRecAuth(policyDomain, destinations) {
    const checks = [];
    const seen = new Set();
    const base = String(policyDomain).toLowerCase();
    for (const target of destinations) {
      const dest = ruaDestination(target);
      if (!dest || seen.has(dest)) continue;
      seen.add(dest);
      if (sameOrganizationalDomain(base, dest)) {
        checks.push({ destination: dest, status: 'self' });
        continue;
      }
      const status = await new Promise((resolve) => {
        this.txtResolver(`${base}._report._dmarc.${dest}`, (err, records) => {
          if (err) {
            // NXDOMAIN / no-data: the destination has not published the
            // authorization record -> not authorized. Other failures
            // (SERVFAIL, timeouts) are indeterminate -> unknown.
            const code = err.code || '';
            return resolve(['ENOTFOUND', 'ENODATA'].includes(code) ? 'not_authorized' : 'unknown');
          }
          const hit = (records || []).some(versionTagIsDmarc1);
          resolve(hit ? 'authorized' : 'not_authorized');
        });
      });
      checks.push({ destination: dest, status });
    }
    return checks;
  }

  /**
   * Resolve the domain's published reporting destinations from live
   * DNS. RFC 7489 §6.6.3: when a domain publishes no DMARC record —
   * whether the name does not exist or it only carries unrelated TXT
   * records — the organizational domain's policy is inherited. A
   * transient lookup failure at the target does NOT trigger the
   * fallback (policy resolution must stay deterministic). Returns the
   * rua targets plus the domain that publishes the policy (used for
   * §7.1 queries).
   */
  async resolvePolicyRua(domain) {
    const target = String(domain).toLowerCase();
    const lookup = (name) => new Promise((resolve) => {
      this.txtResolver(name, (err, recs) => {
        if (err) return resolve({ err, records: [] });
        resolve({ err: null, records: recs || [] });
      });
    });
    const findDmarcRecords = (records) => records.filter(versionTagIsDmarc1);

    // try the target, then the organizational domain
    const org = psl.get(target);
    const candidates = org && org !== target ? [target, org] : [target];
    for (const cand of candidates) {
      const { err, records } = await lookup(`_dmarc.${cand}`);
      if (err) {
        if (cand === target && !['ENOTFOUND', 'ENODATA'].includes(err.code || '')) {
          return { rua: [], policyDomain: target };
        }
        continue;
      }
      const dmarcRecords = findDmarcRecords(records);
      if (dmarcRecords.length === 1) {
        return { rua: ruaTargetsFromRecord(dmarcRecords[0]), policyDomain: cand };
      }
      if (dmarcRecords.length > 1) {
        // RFC 7489 §6.6.3: discovery terminates when multiple records
        // remain — picking one would report its destinations as the
        // domain's, so return none instead.
        return { rua: [], policyDomain: target };
      }
      // none remain at this level: fall through to the org domain
    }
    return { rua: [], policyDomain: target };
  }

  /**
   * Scope a parsed report's records to the target domain. Aggregate
   * reports distinguish subdomain traffic from organizational-domain
   * traffic, so a shared policy does not make the message domains
   * interchangeable: for an inherited-policy report (target is a
   * subdomain of the reported domain) only records with
   * header_from === target count. Returns null when nothing matches.
   */
  scopeRecordsToTarget(report, targetDomain) {
    const reported = report.policyPublished.domain.toLowerCase();
    const target = String(targetDomain).toLowerCase();
    if (reported === target) return report;
    const scoped = report.records.filter((r) => String(r.headerFrom || '').toLowerCase() === target);
    if (scoped.length === 0) return null;
    return { ...report, records: scoped };
  }

  /**
   * Compute insights from a parsed report: totals, failing sources,
   * and the ext-rec authorization state of the domain's published
   * reporting destinations (live DNS, not the XML).
   */
  async analyze(parsed, domain, { publishedRua, ruaPolicyDomain } = {}) {
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

    const destinations = publishedRua || [];
    const extRecChecks = await this.checkExtRecAuth(ruaPolicyDomain || domain, destinations);

    return {
      totalMessages,
      passingMessages: passing.reduce((n, r) => n + r.count, 0),
      failingMessages: failing.reduce((n, r) => n + r.count, 0),
      failingSources,
      extRecChecks,
      reportedPolicyDomain: parsed.policyPublished.domain,
      ruaPolicyDomain: ruaPolicyDomain || String(domain).toLowerCase(),
    };
  }

  /** Parse + validate domain match + scope records + analyze one
   * uploaded XML document for a domain. Throws when the report is for
   * an unrelated domain or carries no records for the target. */
  async ingest(xml, domain) {
    const report = parseAggregateXml(xml);
    if (!reportMatchesDomain(report, domain)) {
      throw new Error(`aggregate report is for ${report.policyPublished.domain}, not ${domain} — reports must cover the target domain`);
    }
    const scoped = this.scopeRecordsToTarget(report, domain);
    if (!scoped) {
      throw new Error(`aggregate report contains no records for ${domain} — inherited-policy reports only cover their own header_from domain`);
    }
    const { rua, policyDomain } = await this.resolvePolicyRua(domain);
    const insights = await this.analyze(scoped, domain, { publishedRua: rua, ruaPolicyDomain: policyDomain });
    return { report: scoped, insights };
  }
}

module.exports = { DmarcReportIngestor, parseAggregateXml, defaultTxtResolver, ruaDestination, ruaTargetsFromRecord, reportMatchesDomain, sameOrganizationalDomain };
