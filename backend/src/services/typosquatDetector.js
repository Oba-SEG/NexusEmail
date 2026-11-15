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
const psl = require('psl');

const RDAP_TIMEOUT_MS = 6000;
const MAX_CONCURRENT = 6;
const MAX_REDIRECTS = 4;
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Fetch an RDAP URL over HTTPS with a size cap and one total deadline.
 * Follows up to MAX_REDIRECTS https redirects (rdap.org bootstraps to
 * the authoritative registry service via 302). Returns the final status
 * plus the redirect count so callers can distinguish a bootstrap miss
 * (rdap.org itself 404s, no redirect) from an authoritative answer.
 * opts.ca allows pinning extra trust anchors (used by tests).
 */
function defaultRdapFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    let req;
    let redirects = 0;
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    // Total deadline across the whole redirect chain.
    timer = setTimeout(() => {
      if (req) req.destroy(new Error('rdap fetch deadline exceeded'));
    }, RDAP_TIMEOUT_MS);

    const request = (current) => {
      let parsed;
      try {
        parsed = new URL(current);
      } catch (e) {
        finish(reject, e);
        return;
      }
      if (parsed.protocol !== 'https:') {
        finish(reject, new Error('rdap fetch requires https'));
        return;
      }
      try {
        req = https.get(parsed, {
          timeout: RDAP_TIMEOUT_MS,
          // rdap.org sits behind Cloudflare and 403s UA-less requests
          headers: {
            Accept: 'application/rdap+json, application/json',
            'User-Agent': 'NexusEmail-Audit/1.0 (+https://github.com/Oba-SEG/NexusEmail)',
          },
          ...(opts.ca ? { ca: opts.ca } : {}),
        }, (res) => {
          const loc = res.headers.location;
          const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
          if (isRedirect && loc && redirects < MAX_REDIRECTS) {
            redirects += 1;
            // Consume the redirect body with the same size cap instead of
            // resuming unbounded — the request stays the active one, so the
            // deadline timer still destroys a slow-drip redirect response.
            let rsize = 0;
            res.on('data', (c) => {
              rsize += c.length;
              if (rsize > MAX_BODY_BYTES) {
                req.destroy();
                finish(reject, new Error('rdap redirect body too large'));
              }
            });
            res.on('aborted', () => finish(reject, new Error('response aborted before completion')));
            res.on('error', (e) => finish(reject, e));
            res.on('end', () => {
              // Malformed Location must not throw inside this callback.
              let next;
              try {
                next = new URL(loc, parsed).href;
              } catch (e) {
                finish(reject, e);
                return;
              }
              request(next);
            });
            return;
          }
          if (isRedirect) {
            req.destroy();
            finish(reject, new Error('rdap redirect chain too long or missing Location'));
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy();
              finish(reject, new Error('rdap body too large'));
              return;
            }
            chunks.push(c);
          });
          res.on('aborted', () => finish(reject, new Error('response aborted before completion')));
          res.on('error', (e) => finish(reject, e));
          res.on('end', () => finish(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), redirects }));
        });
      } catch (e) {
        finish(reject, e);
        return;
      }
      req.on('timeout', () => req.destroy(new Error('rdap fetch timeout')));
      req.on('error', (e) => finish(reject, e));
    };

    request(url);
  });
}

/**
 * Public-suffix-aware split via the `psl` library (full Public Suffix
 * List): the registrant-controlled label is parsed correctly for any
 * suffix, including multi-label ones (acme.co.uk -> sld "acme").
 */
function splitDomain(domain) {
  const parsed = psl.parse(domain.toLowerCase());
  // invalid, null-input, or no registrable domain (e.g. single label)
  if (parsed.error || !parsed.sld) return null;
  const tld = parsed.tld;
  const sld = parsed.sld;
  const base = parsed.subdomain ? `${parsed.subdomain}.${sld}` : sld;
  return { tld, sld, base };
}

/**
 * Generate lookalike candidate SLDs for a given SLD.
 * Mutations are grouped into families (swaps, drops, homoglyphs,
 * prefix/suffix) and merged round-robin so any lookup budget keeps a
 * share of every family instead of truncating later ones.
 */
function generateCandidates(sld) {
  const valid = (c) => c && c !== sld && /^[a-z0-9-]+$/.test(c);

  // Family 1: adjacent character swaps
  const swaps = [];
  for (let i = 0; i < sld.length - 1; i++) {
    if (sld[i] !== sld[i + 1]) {
      const c = sld.slice(0, i) + sld[i + 1] + sld[i] + sld.slice(i + 2);
      if (valid(c)) swaps.push(c);
    }
  }

  // Family 2: character drops
  const drops = [];
  for (let i = 0; i < sld.length; i++) {
    const c = sld.slice(0, i) + sld.slice(i + 1);
    if (valid(c)) drops.push(c);
  }

  // Family 3: homoglyphs
  const homoglyphs = [];
  const HOMOGLYPHS = { 0: 'o', o: '0', 1: 'l', l: '1', i: 'l', e: '3', a: '4', s: '5', g: '9' };
  for (let i = 0; i < sld.length; i++) {
    const rep = HOMOGLYPHS[sld[i]];
    if (rep) {
      const c = sld.slice(0, i) + rep + sld.slice(i + 1);
      if (valid(c)) homoglyphs.push(c);
    }
  }
  // rn -> m and vv -> w (classic confusables)
  if (sld.includes('rn')) { const c = sld.replace('rn', 'm'); if (valid(c)) homoglyphs.push(c); }
  if (sld.includes('vv')) { const c = sld.replace('vv', 'w'); if (valid(c)) homoglyphs.push(c); }

  // Family 4: prefix / suffix additions
  const affixes = [];
  for (const p of ['-secure', '-support', '-login']) { const c = p.slice(1) + sld; if (valid(c)) affixes.push(c); }
  for (const s of ['-secure', '-support', '-login', '-auth']) { const c = sld + s; if (valid(c)) affixes.push(c); }

  // Round-robin merge with de-dup; the original SLD is never emitted.
  const families = [swaps, drops, homoglyphs, affixes];
  const cursors = families.map(() => 0);
  const seen = new Set([sld]);
  const out = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let f = 0; f < families.length; f++) {
      const fam = families[f];
      while (cursors[f] < fam.length && seen.has(fam[cursors[f]])) cursors[f]++;
      if (cursors[f] < fam.length) {
        const c = fam[cursors[f]++];
        seen.add(c);
        out.push(c);
        progress = true;
      }
    }
  }

  return out;
}

/** TLD swap candidates: the most-abused single-label TLDs. Multi-label
 * public suffixes keep their suffix (only SLD candidates are checked). */
const SWAP_TLDS = ['com', 'net', 'org', 'xyz', 'top', 'io', 'info', 'co'];

function generateTldSwaps(tld) {
  if (tld.includes('.')) return [];
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

  /** RDAP check one domain.
   * 200 -> registered. A 404 after a redirect is the authoritative
   * registry answering "not found" -> unregistered. A 404 with no
   * redirect is rdap.org itself having no known service (bootstrap
   * failure), which proves nothing -> error. Anything else -> error. */
  async checkRegistration(candidate) {
    try {
      const { status, redirects } = await this.rdapFetch(`https://rdap.org/domain/${candidate}`);
      if (status === 200) return 'registered';
      if (status === 404 && redirects > 0) return 'unregistered';
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
