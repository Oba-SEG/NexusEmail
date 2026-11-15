const dns = require('dns').promises;

/**
 * Reconstruct a TXT record from its wire-format chunks.
 *
 * dns.resolveTxt returns each record as an array of <=255-byte chunks. RFC
 * byte-chunking is a mid-word split and joins with ''; but records written
 * by zone authors with quoted strings are split at word boundaries, where
 * joining with '' fuses adjacent words into garbage terms
 * (e.g. "v=spf1include:..."). If the fused join has no spaces at all but
 * the space join looks like a proper SPF record, prefer the space join.
 */
function reconstructRecord(chunks) {
  const parts = (chunks || []).map(String);
  if (parts.length <= 1) return parts.join('');
  const fused = parts.join('');
  const spaced = parts.join(' ');
  if (!/\s/.test(fused) && spaced.trim().toLowerCase().startsWith('v=spf1')) return spaced;
  return fused;
}

/**
 * Recursive SPF validator per RFC 7208 §4.6.4.
 *
 * Follows include:/redirect= chains instead of regex-counting the top
 * record only. Counts every DNS-querying mechanism evaluation toward the
 * 10-lookup limit, tracks void (NXDOMAIN/empty) lookups (limit 2), detects
 * duplicate owner records, include loops, dead includes and include targets
 * that do not publish an SPF record.
 *
 * DNS access is injectable so tests can run against fake zones.
 */
class SpfValidator {
  constructor({
    txtResolver = (name) => dns.resolveTxt(name),
    aResolver = (name) => dns.resolve4(name),
    mxResolver = (name) => dns.resolveMx(name),
    maxLookups = 10,
    maxVoidLookups = 2,
    maxDepth = 10,
  } = {}) {
    this.txtResolver = txtResolver;
    this.aResolver = aResolver;
    this.mxResolver = mxResolver;
    this.maxLookups = maxLookups;
    this.maxVoidLookups = maxVoidLookups;
    this.maxDepth = maxDepth;
  }

  /**
   * Validate the SPF record published at the domain apex.
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
      mechanisms: [],
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
      // NXDOMAIN / SERVFAIL / no TXT: nothing published at the apex.
      ctx.errors.push('No SPF record found');
      return result;
    }

    const joined = (records || []).map(reconstructRecord);
    const spfRecords = joined.filter((r) => r.trim().toLowerCase().startsWith('v=spf1'));
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
    await this.evaluate(domain, result.record, ctx, 0);

    result.policy = ctx.policy || null;
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

  /** Evaluate one SPF record; recurses into include:/redirect= targets. */
  async evaluate(name, record, ctx, depth) {
    if (depth > this.maxDepth) {
      ctx.errors.push('SPF include/redirect recursion too deep (possible loop)');
      return;
    }

    let sawAll = false;
    let redirect = null;

    for (const token of record.trim().split(/\s+/).slice(1)) {
      if (!token) continue;
      if (token.includes('%')) {
        ctx.warnings.push('SPF macros are not fully evaluated by this validator');
      }

      // all / modifiers (no leading qualifier)
      if (token === 'all' || /^[+\-~?]all$/.test(token)) {
        sawAll = true;
        if (token === '+all' || token.startsWith('+')) {
          ctx.errors.push('CRITICAL: +all allows any server to send email');
        } else if (token.startsWith('~')) {
          ctx.policy = 'softfail';
        } else if (token.startsWith('-')) {
          ctx.policy = 'hardfail';
        } else if (token.startsWith('?')) {
          ctx.warnings.push('Neutral policy (?)all provides no protection');
        }
        continue;
      }

      const mod = token.match(/^(redirect|exp)=(\S+)$/);
      if (mod) {
        if (mod[1] === 'redirect' && !sawAll) redirect = mod[2];
        continue;
      }

      const m = token.match(/^([+\-~?])?(include|a|mx|ptr|exists|ip4|ip6):?(.*)$/);
      if (!m) continue;
      const [, qual, mech, arg] = m;

      if (sawAll) {
        ctx.warnings.push(`Term "${token}" appears after all and is ignored (all must be last)`);
        continue;
      }

      switch (mech) {
        case 'ip4':
        case 'ip6':
          ctx.mechanisms.push({ type: mech, value: arg, qualifier: qual || '+' });
          break;

        case 'include': {
          ctx.mechanisms.push({ type: 'include', value: arg, qualifier: qual || '+' });
          ctx.lookups += 1;
          const inc = await this.resolveInclude(arg, ctx, depth);
          ctx.includes.push({ domain: arg, ...inc });
          break;
        }

        case 'a': {
          ctx.mechanisms.push({ type: 'a', value: arg || name, qualifier: qual || '+' });
          ctx.lookups += 1;
          const target = arg ? arg.split('/')[0] : name;
          await this.resolveA(target, ctx);
          break;
        }

        case 'mx': {
          ctx.mechanisms.push({ type: 'mx', value: arg || name, qualifier: qual || '+' });
          ctx.lookups += 1;
          const target = arg ? arg.split('/')[0] : name;
          await this.resolveMx(target, ctx);
          break;
        }

        case 'ptr':
          // Deprecated per RFC 7208 §5.5; counts as 2 queries when evaluated.
          ctx.mechanisms.push({ type: 'ptr', value: arg || name, qualifier: qual || '+' });
          ctx.lookups += 2;
          break;

        case 'exists':
          ctx.mechanisms.push({ type: 'exists', value: arg, qualifier: qual || '+' });
          ctx.lookups += 1;
          await this.resolveA(arg, ctx);
          break;

        default:
          break;
      }
    }

    if (!sawAll && redirect) {
      ctx.lookups += 1;
      const red = await this.resolveInclude(redirect, ctx, depth, 'redirect');
      ctx.includes.push({ domain: redirect, ...red });
    } else if (!sawAll && !redirect) {
      ctx.warnings.push('No all mechanism and no redirect — implicit +all allows spoofing');
    }
  }

  /** Fetch the target's single SPF record, recursing when found.
   *  Cycle detection tracks the current recursion path only — legitimate
   *  DAGs (several branches including the same shared record) stay valid. */
  async resolveInclude(target, ctx, depth, kind = 'include') {
    ctx.path = ctx.path || new Set();
    if (ctx.path.has(target)) {
      ctx.errors.push(`SPF ${kind} loop detected at ${target}`);
      return { status: 'loop', record: null };
    }
    ctx.path.add(target);
    try {
      let records;
      try {
        records = await this.txtResolver(target);
      } catch (err) {
        ctx.voidLookups += 1;
        ctx.errors.push(`SPF ${kind}:${target} domain does not exist`);
        return { status: 'nxdomain', record: null };
      }

      const joined = (records || []).map(reconstructRecord);
      const spfRecords = joined.filter((r) => r.trim().toLowerCase().startsWith('v=spf1'));
      if (spfRecords.length === 0) {
        ctx.errors.push(`SPF ${kind}:${target} does not contain an SPF record`);
        return { status: 'no_spf', record: null };
      }
      if (spfRecords.length > 1) {
        ctx.errors.push(
          `SPF ${kind}:${target} has multiple SPF records (${spfRecords.length}) — permerror`
        );
        return { status: 'duplicate', record: spfRecords[0] };
      }
      await this.evaluate(target, spfRecords[0], ctx, depth + 1);
      return { status: 'ok', record: spfRecords[0] };
    } finally {
      ctx.path.delete(target);
    }
  }

  /** A/AAAA lookup; NXDOMAIN or empty answers count as void lookups. */
  async resolveA(name, ctx) {
    let answers = 0;
    for (const resolver of [this.aResolver, this.a6Resolver()]) {
      try {
        const r = await resolver(name);
        answers += (r || []).length;
      } catch (err) {
        // treated below as void only if both families fail empty
      }
    }
    if (answers === 0) {
      ctx.voidLookups += 1;
      ctx.warnings.push(`DNS lookup for ${name} returned no addresses (void lookup)`);
    }
  }

  a6Resolver() {
    return this._a6 || (this._a6 = (name) => dns.resolve6(name));
  }

  /** MX lookup; counts as void when the target has no MX records. */
  async resolveMx(name, ctx) {
    try {
      const r = await this.mxResolver(name);
      if (!r || r.length === 0) throw new Error('empty');
    } catch (err) {
      ctx.voidLookups += 1;
      ctx.warnings.push(`DNS lookup for MX ${name} returned no records (void lookup)`);
    }
  }
}

module.exports = { SpfValidator };
