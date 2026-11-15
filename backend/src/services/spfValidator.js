const dns = require('dns').promises;
const net = require('net');

const TRANSIENT_CODES = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Recursive SPF validator per RFC 7208.
 *
 * Follows include:/redirect= chains instead of regex-counting the top
 * record only. Counts every DNS-querying mechanism evaluation toward the
 * 10-lookup limit (§4.6.4), tracks void (NXDOMAIN/empty) lookups (§4.6.4:
 * limit 2), detects duplicate owner records (§3.2 permerror), include
 * loops, dead includes, include targets without SPF records, unknown
 * mechanisms and malformed ip4/ip6/CIDR terms (§4.6.1 permerror).
 *
 * DNS access is injectable so tests can run against fake zones.
 */
class SpfValidator {
  constructor({
    txtResolver = (name) => dns.resolveTxt(name),
    aResolver = (name) => dns.resolve4(name),
    aaaaResolver = (name) => dns.resolve6(name),
    mxResolver = (name) => dns.resolveMx(name),
    maxLookups = 10,
    maxVoidLookups = 2,
    maxDepth = 10,
  } = {}) {
    this.txtResolver = txtResolver;
    this.aResolver = aResolver;
    this.aaaaResolver = aaaaResolver;
    this.mxResolver = mxResolver;
    this.maxLookups = maxLookups;
    this.maxVoidLookups = maxVoidLookups;
    this.maxDepth = maxDepth;
  }

  /**
   * Validate the SPF record published at the domain apex (§3).
   * Returns { found, record, valid, policy, mechanisms, warnings, errors,
   *           lookupCount, maxLookups, includes, voidLookups, duplicateRecords }
   */
  async validate(domain) {
    const ctx = { lookups: 0, voidLookups: 0, mechanisms: [], includes: [], warnings: [], errors: [] };
    const result = {
      found: false,
      record: null,
      valid: false,
      policy: null,
      mechanisms: ctx.mechanisms,
      warnings: ctx.warnings,
      errors: ctx.errors,
      lookupCount: 0,
      maxLookups: this.maxLookups,
      includes: ctx.includes,
      voidLookups: 0,
      duplicateRecords: 0,
    };

    let records;
    try {
      records = await this.txtResolver(domain);
    } catch (err) {
      const code = err && (err.code || (err.cause && err.cause.code));
      if (TRANSIENT_CODES.has(code)) {
        ctx.errors.push('No SPF record found');
      } else {
        ctx.errors.push(`SPF DNS lookup failed for ${domain} (${code || (err && err.message) || 'unknown error'})`);
      }
      return result;
    }

    // Chunks are byte-level wire segments; RFC 7208 §3.3: concatenate
    // without inserted spaces.
    const joined = (records || []).map((chunks) => (chunks || []).map(String).join(''));
    const spfRecords = joined.filter((r) => /^v=spf1(?:\s|$)/i.test(r.trim()));
    result.duplicateRecords = Math.max(0, spfRecords.length - 1);
    if (spfRecords.length === 0) {
      ctx.errors.push('No SPF record found');
      return result;
    }
    if (spfRecords.length > 1) {
      ctx.errors.push(
        `Multiple SPF records found (${spfRecords.length}) — RFC 7208 requires exactly one (permerror)`
      );
    }

    result.found = true;
    result.record = spfRecords[0];
    const root = await this.evaluate(domain, result.record, ctx, 0);
    result.policy = root.policy || null;

    result.lookupCount = ctx.lookups;
    result.voidLookups = ctx.voidLookups;
    if (ctx.voidLookups > this.maxVoidLookups) {
      ctx.errors.push(
        `Too many void DNS lookups (${ctx.voidLookups}) — RFC 7208 limit is ${this.maxVoidLookups} (permerror)`
      );
    }
    if (ctx.lookups > this.maxLookups) {
      ctx.errors.push(
        `SPF exceeds ${this.maxLookups} DNS lookup limit (found ${ctx.lookups})`
      );
    }
    result.valid = ctx.errors.length === 0;
    return result;
  }

  /**
   * Evaluate one SPF record; recurses into include:/redirect= targets.
   * Returns { policy } for THIS record only — an included record's all
   * never overrides the parent's (§5.2: the parent's all decides).
   */
  async evaluate(name, record, ctx, depth) {
    if (depth > this.maxDepth) {
      ctx.errors.push('SPF include/redirect recursion too deep (possible loop)');
      return { policy: null };
    }

    let sawAll = false;
    let redirect = null;
    let policy = null;

    for (const token of record.trim().split(/\s+/).slice(1)) {
      if (!token) continue;
      if (token.includes('%')) {
        ctx.warnings.push('SPF macros are not fully evaluated by this validator');
      }
      // Once the lookup budget is exceeded, stop issuing DNS queries: a
      // wide include tree could otherwise expand exponentially.
      if (ctx.lookups > this.maxLookups) break;

      // all (§5.1) — must be last; later mechanisms are ignored.
      if (/^[+\-~?]?all$/i.test(token)) {
        if (sawAll) {
          ctx.warnings.push(`Later all mechanism "${token}" ignored (§5.1: all must be last)`);
          continue;
        }
        sawAll = true;
        const qm = token.match(/^([+\-~?])all$/i);
        const qual = qm ? qm[1] : '+';
        if (qual === '+') {
          ctx.errors.push('CRITICAL: +all allows any server to send email');
        } else if (qual === '~') {
          policy = 'softfail';
        } else if (qual === '-') {
          policy = 'hardfail';
        } else {
          ctx.warnings.push('Neutral policy (?)all provides no protection');
        }
        continue;
      }

      // Modifiers are name=value pairs (§6). redirect/exp are handled;
      // unknown modifiers MUST be ignored.
      const mod = token.match(/^([a-z][a-z0-9._-]*)=(.*)$/i);
      if (mod) {
        const modName = mod[1].toLowerCase();
        if (modName === 'redirect' && !sawAll) redirect = mod[2];
        else if (modName !== 'redirect' && modName !== 'exp') {
          // unrecognized modifier — silently ignored per §6
        }
        continue;
      }

      // Mechanisms: [qualifier] name [ ":" value | "/cidr" ] — names are
      // case-insensitive (§4.6.1). The remainder must start with ":" or
      // "/" so unknown terms are rejected rather than swallowed by a
      // prefix match. For a/mx the "/" form is CIDR-only ("a/24") and the
      // slash stays attached so splitCidr sees an empty target.
      const m = token.match(/^([+\-~?])?(include|a|mx|ptr|exists|ip4|ip6)/i);
      if (!m) {
        ctx.errors.push(`Unknown SPF mechanism "${token}" (permerror)`);
        continue;
      }
      const qual = m[1] || '+';
      const mech = m[2].toLowerCase();
      const rest = token.slice(m[0].length);
      if (rest && !/^[:/]/.test(rest)) {
        ctx.errors.push(`Unknown SPF mechanism "${token}" (permerror)`);
        continue;
      }
      const arg = rest.startsWith(':') ? rest.slice(1) : rest;

      if (sawAll) {
        ctx.warnings.push(`Term "${token}" appears after all and is ignored (all must be last)`);
        continue;
      }

      switch (mech) {
        case 'ip4': {
          if (!this.validIp(arg, 4)) {
            ctx.errors.push(`Invalid ip4 mechanism "${token}" (permerror)`);
            break;
          }
          ctx.mechanisms.push({ type: 'ip4', value: arg, qualifier: qual });
          break;
        }

        case 'ip6': {
          if (!this.validIp(arg, 6)) {
            ctx.errors.push(`Invalid ip6 mechanism "${token}" (permerror)`);
            break;
          }
          ctx.mechanisms.push({ type: 'ip6', value: arg, qualifier: qual });
          break;
        }

        case 'include': {
          if (!arg) {
            ctx.errors.push('Invalid include mechanism "include" (missing domain, permerror)');
            break;
          }
          ctx.mechanisms.push({ type: 'include', value: arg, qualifier: qual });
          ctx.lookups += 1;
          const inc = await this.resolveInclude(arg, ctx, depth);
          ctx.includes.push({ domain: arg, ...inc });
          break;
        }

        case 'a':
        case 'mx': {
          const { target, mask } = this.splitCidr(arg);
          if (mask !== null && (mask === '' || !this.validMask(mask, 32))) {
            ctx.errors.push(`Invalid CIDR length in "${token}" (permerror)`);
            break;
          }
          ctx.mechanisms.push({ type: mech, value: arg || name, qualifier: qual });
          ctx.lookups += 1;
          if (mech === 'a') await this.resolveA(target || name, ctx);
          else await this.resolveMx(target || name, ctx);
          break;
        }

        case 'ptr':
          // Deprecated per §5.5; counts as 2 queries when evaluated.
          ctx.mechanisms.push({ type: 'ptr', value: arg || name, qualifier: qual });
          ctx.lookups += 2;
          break;

        case 'exists': {
          if (!arg) {
            ctx.errors.push('Invalid exists mechanism "exists" (missing domain, permerror)');
            break;
          }
          ctx.mechanisms.push({ type: 'exists', value: arg, qualifier: qual });
          ctx.lookups += 1;
          // §5.7: exists performs an A query only.
          await this.resolveA(arg, ctx, { aOnly: true });
          break;
        }

        default:
          break;
      }
    }

    if (sawAll) return { policy };

    if (redirect) {
      ctx.lookups += 1;
      const red = await this.resolveInclude(redirect, ctx, depth, 'redirect');
      // §6.1: redirect's target record decides the policy when the parent
      // has no all mechanism.
      return { policy: red.policy || null };
    }

    // §4.7: neither all nor redirect — implicit neutral (?all).
    ctx.warnings.push('No all mechanism and no redirect — implicit ?all (neutral) provides no protection');
    return { policy: null };
  }

  /** Fetch the target's single SPF record, recursing when found.
   *  Cycle detection tracks the current recursion path only — legitimate
   *  DAGs (several branches including the same shared record) stay valid. */
  async resolveInclude(target, ctx, depth, kind = 'include') {
    if (ctx.lookups > this.maxLookups) return { status: 'budget', record: null, policy: null };
    ctx.path = ctx.path || new Set();
    if (ctx.path.has(target)) {
      ctx.errors.push(`SPF ${kind} loop detected at ${target}`);
      return { status: 'loop', record: null, policy: null };
    }
    ctx.path.add(target);
    try {
      let records;
      try {
        records = await this.txtResolver(target);
      } catch (err) {
        const code = err && (err.code || (err.cause && err.cause.code));
        if (TRANSIENT_CODES.has(code)) {
          ctx.voidLookups += 1;
          ctx.errors.push(`SPF ${kind}:${target} domain does not exist`);
        } else {
          ctx.errors.push(`SPF ${kind}:${target} DNS lookup failed (${code || (err && err.message) || 'unknown error'})`);
        }
        return { status: 'dns_error', record: null, policy: null };
      }

      const joined = (records || []).map((chunks) => (chunks || []).map(String).join(''));
      const spfRecords = joined.filter((r) => /^v=spf1(?:\s|$)/i.test(r.trim()));
      if (spfRecords.length === 0) {
        ctx.errors.push(`SPF ${kind}:${target} does not contain an SPF record`);
        return { status: 'no_spf', record: null, policy: null };
      }
      if (spfRecords.length > 1) {
        ctx.errors.push(
          `SPF ${kind}:${target} has multiple SPF records (${spfRecords.length}) — permerror`
        );
        return { status: 'duplicate', record: spfRecords[0], policy: null };
      }
      const sub = await this.evaluate(target, spfRecords[0], ctx, depth + 1);
      return { status: 'ok', record: spfRecords[0], policy: sub.policy };
    } finally {
      ctx.path.delete(target);
    }
  }

  /** Split "target/mask" into { target, mask }; CIDR-only terms ("/24")
   *  return an empty target so callers fall back to the current domain. */
  splitCidr(arg) {
    if (!arg || !arg.includes('/')) return { target: arg, mask: null };
    const idx = arg.indexOf('/');
    return { target: arg.slice(0, idx), mask: arg.slice(idx + 1) };
  }

  validIp(value, family) {
    const { target: ip, mask } = this.splitCidr(value);
    if (net.isIP(ip) !== family) return false;
    if (mask !== null && !this.validMask(mask, family === 4 ? 32 : 128)) return false;
    return true;
  }

  validMask(mask, max) {
    return /^\d+$/.test(mask) && Number(mask) >= 0 && Number(mask) <= max;
  }

  /** A (and optionally AAAA) lookup. NXDOMAIN/empty answers count as void
   *  lookups; transient DNS failures (e.g. SERVFAIL) are errors, not void. */
  async resolveA(name, ctx, { aOnly = false } = {}) {
    const families = aOnly ? [['a', this.aResolver]] : [['a', this.aResolver], ['aaaa', this.a6Resolver()]];
    let answers = 0;
    let transientFailure = false;
    for (const [, resolver] of families) {
      try {
        answers += (await resolver(name) || []).length;
      } catch (err) {
        const code = err && (err.code || (err.cause && err.cause.code));
        if (!TRANSIENT_CODES.has(code)) transientFailure = true;
      }
    }
    if (answers > 0) return;
    if (transientFailure) {
      ctx.errors.push(`DNS lookup failed for ${name} (temporary DNS failure)`);
    } else {
      ctx.voidLookups += 1;
      ctx.warnings.push(`DNS lookup for ${name} returned no addresses (void lookup)`);
    }
  }

  a6Resolver() {
    return this._a6 || (this._a6 = this.aaaaResolver);
  }

  /** MX lookup; counts as void when the target has no MX records. */
  async resolveMx(name, ctx) {
    try {
      const r = await this.mxResolver(name);
      if (r && r.length > 0) return;
      ctx.voidLookups += 1;
      ctx.warnings.push(`DNS lookup for MX ${name} returned no records (void lookup)`);
    } catch (err) {
      const code = err && (err.code || (err.cause && err.cause.code));
      if (TRANSIENT_CODES.has(code)) {
        ctx.voidLookups += 1;
        ctx.warnings.push(`DNS lookup for MX ${name} returned no records (void lookup)`);
      } else {
        ctx.errors.push(`DNS lookup failed for MX ${name} (temporary DNS failure)`);
      }
    }
  }
}

module.exports = { SpfValidator };
