/**
 * MTA-STS analyzer (RFC 8460).
 *
 * The DNS TXT record alone does not prove enforcement — the policy file
 * at https://mta-sts.<domain>/.well-known/mta-sts.txt must exist, parse,
 * and agree with the DNS record. Fetcher and TXT resolver are injectable
 * for tests.
 */
const dns = require('dns').promises;
const https = require('https');

const FETCH_TIMEOUT_MS = 5000;
const MAX_POLICY_BYTES = 64 * 1024;
const VALID_MODES = ['enforce', 'testing', 'none'];
const MAX_AGE_LIMIT = 31557600; // RFC 8460 §4.5: max_age must not exceed this

/** Fetch the policy file over HTTPS with a size cap and timeout. */
function defaultFetchPolicy(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_POLICY_BYTES) {
          req.destroy();
          reject(new Error('policy body too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', reject);
  });
}

/** Parse the key:value lines of an MTA-STS policy file (RFC 8460 §4.2). */
function parsePolicyFile(body) {
  const out = { version: null, mode: null, maxAge: null, mx: [], unknown: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) { out.unknown.push(line); continue; }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'version') out.version = value;
    else if (key === 'mode') out.mode = value.toLowerCase();
    else if (key === 'max_age') out.maxAge = value;
    else if (key === 'mx') out.mx.push(value);
    else out.unknown.push(line);
  }
  return out;
}

/** Split an MTA-STS TXT record into whitespace-tolerant, lower-cased tags. */
function parseRecordTags(record) {
  const tags = {};
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (key) tags[key] = part.slice(eq + 1).trim();
  }
  return tags;
}

class MtaStsAnalyzer {
  constructor({ fetchPolicy, txtResolver } = {}) {
    this.fetchPolicy = fetchPolicy || defaultFetchPolicy;
    this.txtResolver = txtResolver || ((name) => dns.resolveTxt(name));
  }

  async analyze(domain) {
    const result = {
      found: false,
      record: null,
      policy: null,
      mode: null,
      maxAge: null,
      includeSubdomains: false,
      policyFetch: { fetched: false, status: 'skipped', httpStatus: null, version: null, mode: null, maxAge: null, mx: [], warnings: [], errors: [] },
      warnings: [],
      errors: [],
      score: 0,
    };

    // 1. DNS record (RFC 8460 §3.1)
    let records;
    try {
      records = await this.txtResolver(`_mta-sts.${domain}`);
    } catch (e) {
      result.errors.push('No MTA-STS record found - email not secured with TLS enforcement');
      return result;
    }
    const candidates = (records || []).map((chunks) => (chunks || []).map(String).join(''));
    const record = candidates.find((r) => /(?:^|\s|;)v\s*=\s*STSv1(?:\s|;|$)/i.test(r));
    if (!record) {
      result.errors.push('No MTA-STS record found - email not secured with TLS enforcement');
      return result;
    }

    result.found = true;
    result.record = record;
    const tags = parseRecordTags(record);
    if (!tags.id) result.warnings.push('MTA-STS DNS record is missing the required id= tag (RFC 8460 §3.1)');
    result.policy = tags.id || null;
    // RFC 8460 §3.1: the DNS record only carries v=STSv1 and id= —
    // mode/max_age live in the policy file. Keep DNS-side values as a
    // fallback (old behavior) until the policy is fetched.
    result.mode = tags.mode || 'enforce';
    result.maxAge = parseInt(tags.max_age || '0', 10);
    result.includeSubdomains = tags.include_subdomains === 'yes';

    // Score (DNS-side fallback; recomputed from the policy file below)
    if (result.mode === 'enforce' && result.maxAge >= 86400) result.score = 15;
    else if (result.mode === 'testing') result.score = 10;

    // 2. Fetch and validate the policy file (RFC 8460 §4)
    const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
    let res;
    try {
      res = await this.fetchPolicy(url);
    } catch (e) {
      result.policyFetch.status = 'unreachable';
      result.errors.push(`MTA-STS policy fetch failed (${e.message}) — publish ${url} or remove the DNS record; a published record with no reachable policy breaks MTA-STS (RFC 8460 §10.1)`);
      return result;
    }

    if (res.status !== 200) {
      result.policyFetch.status = 'unreachable';
      result.policyFetch.httpStatus = res.status;
      result.errors.push(`MTA-STS policy at ${url} returned HTTP ${res.status} — publish the policy file or remove the DNS record (RFC 8460 §10.1)`);
      return result;
    }

    const pf = parsePolicyFile(res.body);
    Object.assign(result.policyFetch, {
      fetched: true,
      status: 'ok',
      httpStatus: res.status,
      version: pf.version,
      mode: pf.mode,
      maxAge: pf.maxAge ? parseInt(pf.maxAge, 10) : null,
      mx: pf.mx,
    });

    if (pf.version !== 'STSv1') result.policyFetch.errors.push(`policy version must be STSv1 (got ${pf.version || 'none'})`);
    if (!VALID_MODES.includes(pf.mode)) result.policyFetch.errors.push(`policy mode must be one of enforce, testing, none (got ${pf.mode || 'none'})`);
    const ma = pf.maxAge && /^\d+$/.test(pf.maxAge) ? parseInt(pf.maxAge, 10) : null;
    if (ma === null || ma < 1 || ma > MAX_AGE_LIMIT) {
      result.policyFetch.errors.push(`policy max_age must be an integer between 1 and ${MAX_AGE_LIMIT} seconds (got ${pf.maxAge || 'none'})`);
    }
    if (pf.mx.length === 0) result.policyFetch.errors.push('policy has no mx: lines (RFC 8460 §4.2)');
    if (pf.unknown.length > 0) result.policyFetch.warnings.push(`unknown fields in policy: ${pf.unknown.slice(0, 3).join(', ')}`);

    // RFC 8460 §4: senders honour the policy file, so mode/max_age for
    // scoring come from it; DNS-side tags (when present) are the fallback.
    if (VALID_MODES.includes(pf.mode)) result.mode = pf.mode;
    if (ma !== null) result.maxAge = ma;
    if (result.mode === 'enforce' && result.maxAge >= 86400) result.score = 15;
    else if (result.mode === 'testing') result.score = 10;
    else result.score = 0;

    // 3. Consistency: warn only when the DNS record explicitly carries
    // non-standard mode/max_age tags that disagree with the policy file.
    if (tags.mode && VALID_MODES.includes(pf.mode) && pf.mode !== tags.mode) {
      result.warnings.push(`policy file mode (${pf.mode}) differs from DNS record mode (${tags.mode}) — senders honour the policy file`);
    }
    if (tags.max_age && ma !== null && ma !== parseInt(tags.max_age, 10)) {
      result.warnings.push(`policy file max_age (${ma}s) differs from DNS record max_age (${parseInt(tags.max_age, 10)}s)`);
    }

    // Surface policy-file problems in the audit result.
    result.warnings.push(...result.policyFetch.warnings);
    result.errors.push(...result.policyFetch.errors);

    return result;
  }
}

module.exports = { MtaStsAnalyzer, parsePolicyFile, defaultFetchPolicy };
