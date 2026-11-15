/**
 * Typosquat / lookalike detection via RDAP (issue #63).
 *
 * Generates lookalike candidate domains for the audited name — typos
 * (char swap/drop), homoglyphs (0->o, 1->l, rn->m), TLD swaps, and
 * prefix/suffix additions — then checks real registration status via
 * RDAP (https://rdap.org/<domain>, free, no key). Registered lookalikes
 * are threats; unregistered ones are informational.
 *
 * rdapFetch is injectable for tests; lookups are concurrency-limited.
 */
const https = require('https');

const RDAP_TIMEOUT_MS = 6000;
const MAX_CONCURRENT = 6;

/** Fetch an RDAP URL over HTTPS with a size cap and timeout. */
function defaultRdapFetch(url) {
  return new Promise((resolve, reject) => {
    let timer;
    let req;
    const finish = (fn, arg) => {
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    timer = setTimeout(() => {
      if (req) req.destroy(new Error('rdap fetch deadline exceeded'));
    }, RDAP_TIMEOUT_MS);
    try {
      req = https.get(url, {
        timeout: RDAP_TIMEOUT_MS,
        headers: { Accept: 'application/rdap+json, application/json' },
      }, (res) => {
        // Any final status is fine — 200 registered, 404 unregistered.
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 256 * 1024) {
            req.destroy();
            finish(reject, new Error('rdap body too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('aborted', () => finish(reject, new Error('response aborted before completion')));
        res.on('error', (e) => finish(reject, e));
        res.on('end', () => finish(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
    } catch (e) {
      finish(reject, e);
      return;
    }
    req.on('timeout', () => req.destroy(new Error('rdap fetch timeout')));
    req.on('error', (e) => finish(reject, e));
  });
}

/** Split a domain into labels; the SLD is the label before the TLD. */
function splitDomain(domain) {
  const labels = domain.toLowerCase().split('.');
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const base = domain.toLowerCase().slice(0, domain.length - tld.length - 1);
  return { tld, sld, base };
}

/**
 * Generate lookalike candidate SLDs for a given SLD.
 * Deduplicated, never includes the original.
 */
function generateCandidates(sld) {
  const out = new Set();
  const add = (c) => {
    if (c && c !== sld && /^[a-z0-9-]+$/.test(c)) out.add(c);
  };

  // Character swaps (adjacent transposition)
  for (let i = 0; i < sld.length - 1; i++) {
    if (sld[i] !== sld[i + 1]) {
      add(sld.slice(0, i) + sld[i + 1] + sld[i] + sld.slice(i + 2));
    }
  }

  // Character drops
  for (let i = 0; i < sld.length; i++) {
    add(sld.slice(0, i) + sld.slice(i + 1));
  }

  // Homoglyphs
  const HOMOGLYPHS = { 0: 'o', o: '0', 1: 'l', l: '1', i: 'l', e: '3', a: '4', s: '5', g: '9' };
  for (let i = 0; i < sld.length; i++) {
    const rep = HOMOGLYPHS[sld[i]];
    if (rep) add(sld.slice(0, i) + rep + sld.slice(i + 1));
  }
  // rn -> m (classic)
  if (sld.includes('rn')) add(sld.replace('rn', 'm'));
  // vv -> w
  if (sld.includes('vv')) add(sld.replace('vv', 'w'));

  // Prefix / suffix additions
  for (const p of ['-secure', '-support', '-login']) add(p.slice(1) + sld);
  for (const s of ['-secure', '-support', '-login', '-auth']) add(sld + s);

  return [...out];
}

/** TLD swap candidates: the most-abused TLDs that differ from the current one. */
const SWAP_TLDS = ['com', 'net', 'org', 'xyz', 'top', 'io', 'info', 'co'];

function generateTldSwaps(tld) {
  return SWAP_TLDS.filter((t) => t !== tld);
}

/** Run promise-producing tasks with a concurrency limit. */
async function runLimited(tasks, limit) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const my = idx++;
      results[my] = await tasks[my]();
    }
  });
  await Promise.all(workers);
  return results;
}

class TyposquatDetector {
  constructor({ rdapFetch } = {}) {
    this.rdapFetch = rdapFetch || defaultRdapFetch;
  }

  /** RDAP check one domain. Returns 'registered' | 'unregistered' | 'error'. */
  async checkRegistration(candidate) {
    try {
      const { status } = await this.rdapFetch(`https://rdap.org/domain/${candidate}`);
      if (status === 200) return 'registered';
      if (status === 404) return 'unregistered';
      return 'error';
    } catch (e) {
      return 'error';
    }
  }

  async analyze(domain) {
    const result = {
      candidates: [],
      threats: [],
      summary: 'No impersonation threats detected',
    };

    const parts = splitDomain(domain);
    if (!parts || parts.sld.length < 3) {
      result.summary = 'Domain too short to generate lookalike candidates';
      return result;
    }

    // Cap candidate explosion: swaps + typos up to a sane count
    const sldCandidates = generateCandidates(parts.sld).slice(0, 24);
    const tldCandidates = generateTldSwaps(parts.tld).slice(0, 6);
    const targets = [
      ...sldCandidates.map((c) => ({ domain: `${c}.${parts.tld}`, kind: 'typo' })),
      ...tldCandidates.map((t) => ({ domain: `${parts.sld}.${t}`, kind: 'tld-swap' })),
    ].slice(0, 30);

    const statuses = await runLimited(targets.map((t) => async () => {
      const status = await this.checkRegistration(t.domain);
      return { ...t, status };
    }), MAX_CONCURRENT);

    for (const r of statuses) {
      if (r.status === 'error') continue;
      result.candidates.push(r);
      if (r.status === 'registered') {
        result.threats.push({
          severity: 'high',
          type: 'Registered Lookalike',
          message: `Lookalike domain ${r.domain} (${r.kind}) is registered — verify it is yours or monitor for abuse`,
        });
      }
    }

    const registered = result.threats.length;
    result.summary = registered > 0
      ? `${registered} registered lookalike domain(s) found - review recommended`
      : 'No registered lookalike domains found';

    return result;
  }
}

module.exports = { TyposquatDetector, generateCandidates, generateTldSwaps, splitDomain, defaultRdapFetch };
