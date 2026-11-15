/**
 * MTA-STS analyzer (RFC 8460).
 *
 * The DNS TXT record alone does not prove enforcement — the policy file
 * at https://mta-sts.<domain>/.well-known/mta-sts.txt must exist, parse,
 * and agree with the DNS record. Fetcher and TXT resolver are injectable
 * for tests.
 */
const dns = require('dns').promises;
const dnsCb = require('dns');
const https = require('https');

const FETCH_TIMEOUT_MS = 5000;
const MAX_POLICY_BYTES = 64 * 1024;
const VALID_MODES = ['enforce', 'testing', 'none'];
const MAX_AGE_LIMIT = 31557600; // RFC 8461 §3.2: max_age must not exceed this

/**
 * True for addresses a policy host must never resolve to: this-network,
 * RFC 1918 private ranges, loopback, link-local (v4 + v6), CGNAT, and
 * IPv4-mapped IPv6 forms of those. Guards the policy fetch against
 * domains whose mta-sts host points at internal infrastructure (SSRF).
 * IPv6 literals are normalized through URL parsing, so expanded forms
 * (0:0:0:0:0:0:0:1) and hex mapped forms (::ffff:a00:1) are handled;
 * malformed input fails closed.
 */
function isPrivateIp(ip) {
  // Strict dotted-quad IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;      // this-network, private, loopback
    if (a === 169 && b === 254) return true;                // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;       // private
    if (a === 192 && b === 168) return true;                // private
    if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT
    return false;
  }
  // IPv6: normalize via URL (canonicalizes expanded and mapped forms)
  let v6;
  try {
    v6 = new URL(`http://[${ip}]`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;                                            // malformed → fail closed
  }
  if (v6 === '::' || v6 === '::1') return true;             // unspecified, loopback
  // IPv4-mapped IPv6 — URL canonicalizes both hex and dotted forms to hex
  if (v6.startsWith('::ffff:')) {
    const hex2 = v6.slice(7).match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex2) {
      const hi = parseInt(hex2[1], 16);
      const lo = parseInt(hex2[2], 16);
      return isPrivateIp(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
    }
    return true;
  }
  // First-hextet ranges: fe80::/10 link-local + deprecated fec0::/10
  // site-local, fc00::/7 unique local.
  const first = parseInt(v6.split(':')[0], 16);
  if (Number.isNaN(first)) return true;
  if (first >= 0xfe80 && first <= 0xfeff) return true;      // link/site-local
  if (first >= 0xfc00 && first <= 0xfdff) return true;      // unique local
  return false;
}

/** Fetch the policy file over HTTPS with a size cap, socket timeout,
 *  total deadline, complete-response tracking, and a private-address
 *  blocklist resolved before connecting. */
function defaultFetchPolicy(url) {
  return new Promise((resolve, reject) => {
    let timer;
    let req;
    const finish = (fn, arg) => {
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    // Resolve the host first and refuse private targets (SSRF guard).
    // Uses the CALLBACK dns API — dns.promises.lookup ignores callbacks.
    const lookup = (host, opts, cb) => {
      dnsCb.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
        if (err) return cb(err);
        if ((addrs || []).some((a) => isPrivateIp(a.address))) {
          return cb(new Error('mta-sts host resolves to a private, loopback, or link-local address'));
        }
        // Prefer IPv4 when available — hosts without IPv6 routing would
        // otherwise hang until the deadline on an unreachable AAAA.
        const pick = (addrs || []).find((a) => a.family === 4) || (addrs || [])[0];
        if (!pick) return cb(new Error('mta-sts host has no usable addresses'));
        cb(null, pick.address, pick.family);
      });
    };
    // Total deadline — a slow-drip server must not hold the audit open.
    timer = setTimeout(() => {
      if (req) req.destroy(new Error('fetch deadline exceeded'));
    }, FETCH_TIMEOUT_MS);
    try {
      req = https.get(url, { timeout: FETCH_TIMEOUT_MS, lookup, autoSelectFamily: false }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_POLICY_BYTES) {
            req.destroy();
            finish(reject, new Error('policy body too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('aborted', () => finish(reject, new Error('response aborted before completion')));
        res.on('error', (e) => finish(reject, e));
        res.on('end', () => finish(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
    } catch (e) {
      // https.get can throw synchronously (e.g. invalid URL)
      finish(reject, e);
      return;
    }
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', (e) => finish(reject, e));
  });
}

/** Parse the key:value lines of an MTA-STS policy file (RFC 8461 §3.2).
 *  Fields other than mx keep their FIRST value when repeated. */
function parsePolicyFile(body) {
  const out = { version: null, mode: null, maxAge: null, mx: [], unknown: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) { out.unknown.push(line); continue; }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'version') { if (out.version === null) out.version = value; }
    else if (key === 'mode') { if (out.mode === null) out.mode = value.toLowerCase(); }
    else if (key === 'max_age') { if (out.maxAge === null) out.maxAge = value; }
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
    // RFC 8461 §3.1: the record must START with an exact version field.
    const STS_RE = /^v\s*=\s*STSv1\s*(?:;|$)/i;
    const matching = candidates.filter((r) => STS_RE.test(r));
    if (matching.length === 0) {
      result.errors.push('No MTA-STS record found - email not secured with TLS enforcement');
      return result;
    }
    // RFC 8461 §3.1: exactly one matching TXT record may be published.
    if (matching.length > 1) {
      result.found = true;
      result.record = matching[0];
      result.errors.push(`${matching.length} MTA-STS TXT records published — RFC 8461 §3.1 requires exactly one; remove all but one record`);
      return result;
    }
    const record = matching[0];

    result.found = true;
    result.record = record;
    const tags = parseRecordTags(record);
    // RFC 8461 §3.1: id is mandatory and must be 1-32 ASCII alphanumeric.
    if (!tags.id || !/^[a-zA-Z0-9]{1,32}$/.test(tags.id)) {
      result.errors.push('MTA-STS DNS record needs an id= of 1-32 ASCII alphanumeric characters (RFC 8461 §3.1) — senders must stop discovery for an invalid record');
      return result;
    }
    result.policy = tags.id || null;
    // RFC 8461 §3.1: the DNS record only carries v=STSv1 and id= —
    // mode/max_age live in the policy file. Keep DNS-side values as a
    // fallback (old behavior) until the policy is fetched.
    result.mode = tags.mode || 'enforce';
    result.maxAge = parseInt(tags.max_age || '0', 10);
    result.includeSubdomains = tags.include_subdomains === 'yes';

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
    if (ma === null || ma < 0 || ma > MAX_AGE_LIMIT) {
      result.policyFetch.errors.push(`policy max_age must be an integer between 0 and ${MAX_AGE_LIMIT} seconds (got ${pf.maxAge || 'none'})`);
    }
    // RFC 8461 §3.2: a mode of none carries no MX requirement.
    if (pf.mode !== 'none' && pf.mx.length === 0) {
      result.policyFetch.errors.push('policy has no mx: lines (RFC 8461 §3.2)');
    }
    // MX values are hostname patterns per RFC 5321 Domain grammar
    // (optional '*.' wildcard; labels are alnum/hyphen but never start
    // or end with a hyphen; final label is not all-numeric).
    for (const mx of pf.mx) {
      const body = mx.startsWith('*.') ? mx.slice(2) : mx;
      const labels = body.split('.');
      const labelsOk = body.length > 0 &&
        labels.every((l) => l.length <= 63 && /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(l)) &&
        !labels[labels.length - 1].match(/^\d+$/);
      if (!labelsOk || body.includes('..') || mx.length > 253) {
        result.policyFetch.errors.push(`policy has an invalid mx value: ${mx}`);
        break;
      }
    }
    if (pf.unknown.length > 0) result.policyFetch.warnings.push(`unknown fields in policy: ${pf.unknown.slice(0, 3).join(', ')}`);

    // RFC 8461 §3.2: senders honour the policy file, so mode/max_age for
    // scoring come from it; DNS-side tags (when present) are the fallback.
    if (VALID_MODES.includes(pf.mode)) result.mode = pf.mode;
    if (ma !== null) result.maxAge = ma;
    // Policy points are only earned when the fetched policy is fully
    // valid — validation failures score 0.
    if (result.policyFetch.errors.length === 0) {
      if (result.mode === 'enforce' && result.maxAge >= 86400) result.score = 15;
      else if (result.mode === 'testing') result.score = 10;
      else result.score = 0;
    } else {
      result.score = 0;
    }

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

module.exports = { MtaStsAnalyzer, parsePolicyFile, defaultFetchPolicy, isPrivateIp };
