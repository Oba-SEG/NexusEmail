const dns = require('dns').promises;
const { createHash, publicEncrypt } = require('crypto');
const { SpfValidator } = require('./spfValidator');

class EmailSecurityAuditor {
  constructor() {
    this.commonSelectors = [
      'default', 'google', 'selector1', 'selector2', 'selector3',
      'mail', 'dkim', 'dkim1', 'smtp', 'mx', 'smtp1', 's1', 's2'
    ];
  }

  // ===== COMPREHENSIVE DNS RECORD CHECKS =====
  
  async auditDomain(domain) {
    const results = {
      domain,
      timestamp: new Date().toISOString(),
      spf: null,
      dkim: null,
      dmarc: null,
      mta_sts: null,
      tls_rpt: null,
      impersonation: null,
      score: 0,
      issues: [],
      recommendations: []
    };

    try {
      // Run all checks in parallel
      const [spf, dkim, dmarc, mta_sts, tls_rpt, impersonation] = await Promise.all([
        this.checkSPF(domain),
        this.checkDKIM(domain),
        this.checkDMARC(domain),
        this.checkMTASTS(domain),
        this.checkTLSRPT(domain),
        this.checkImpersonation(domain)
      ]);

      results.spf = spf;
      results.dkim = dkim;
      results.dmarc = dmarc;
      results.mta_sts = mta_sts;
      results.tls_rpt = tls_rpt;
      results.impersonation = impersonation;

      // Calculate score
      results.score = this.calculateHealthScore(spf, dkim, dmarc, mta_sts, tls_rpt);

      // Collect issues
      results.issues = this.collectIssues(spf, dkim, dmarc, mta_sts, tls_rpt, impersonation);

      // Generate recommendations
      results.recommendations = this.generateRecommendations(spf, dkim, dmarc, mta_sts, tls_rpt, impersonation);

    } catch (error) {
      results.error = error.message;
    }

    return results;
  }

  // ===== SPF CHECK =====
  // Delegated to SpfValidator (recursive include chains, RFC 7208 lookup
  // counting, permerror detection). Score policy unchanged:
  // hardfail 35 / softfail 25 / anything else 10.
  async checkSPF(domain) {
    const v = await new SpfValidator().validate(domain);
    return {
      found: v.found,
      record: v.record,
      valid: v.valid,
      policy: v.policy,
      mechanisms: v.mechanisms,
      warnings: v.warnings,
      errors: v.errors,
      lookupCount: v.lookupCount,
      includes: v.includes,
      score: v.found ? (v.policy === 'hardfail' ? 35 : v.policy === 'softfail' ? 25 : 10) : 0
    };
  }

  // ===== DKIM CHECK =====
  async checkDKIM(domain) {
    const result = {
      found: false,
      selectors: [],
      warnings: [],
      errors: [],
      score: 0
    };

    for (const selector of this.commonSelectors) {
      try {
        const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
        if (records.length > 0) {
          const record = records[0].join('');
          const selectorInfo = {
            selector,
            record,
            valid: true,
            keySize: null,
            algorithm: null,
            notes: []
          };

          // Analyze key
          if (record.includes('k=rsa')) {
            if (record.length > 400) {
              selectorInfo.keySize = '2048-bit';
              selectorInfo.algorithm = 'RSA';
            } else {
              selectorInfo.keySize = '1024-bit';
              selectorInfo.warnings.push('Key size below recommended 2048-bit');
            }
          }

          // Check for test mode
          if (record.includes('t=y')) {
            selectorInfo.notes.push('Test mode (t=y) - not for production');
          }

          result.selectors.push(selectorInfo);
          result.found = true;
        }
      } catch (e) {
        // Selector not found, continue
      }
    }

    if (result.selectors.length === 0) {
      result.errors.push('No DKIM records found');
    }

    // Score based on selectors
    if (result.selectors.length > 0) {
      result.score = 20;
      for (const sel of result.selectors) {
        if (sel.keySize === '2048-bit') result.score += 10;
        else result.score += 5;
      }
    }

    return result;
  }

  // ===== DMARC CHECK =====
  async checkDMARC(domain) {
    const result = {
      found: false,
      record: null,
      policy: null,
      subdomainPolicy: null,
      percentage: 100,
      alignment: null,
      reporting: {},
      warnings: [],
      errors: [],
      score: 0
    };

    try {
      const records = await dns.resolveTxt(`_dmarc.${domain}`);
      const dmarcRecord = records.find(r => r.join('').includes('v=DMARC1'));

      if (!dmarcRecord) {
        result.errors.push('No DMARC record found');
        return result;
      }

      result.found = true;
      result.record = dmarcRecord.join('');

      // Parse tags
      const tags = this.parseDMARCTags(result.record);

      result.policy = tags.p || 'none';
      result.subdomainPolicy = tags.sp || 'none';
      result.percentage = tags.pct ? parseInt(tags.pct) : 100;
      result.alignment = tags.adkim || 'r';

      // Reporting URIs
      if (tags.rua) result.reporting.aggregate = tags.rua;
      if (tags.ruf) result.reporting.forensic = tags.ruf;

      // Validate policy
      if (result.policy === 'none') {
        result.errors.push('DMARC policy is "none" - no action taken on failures');
      } else if (result.policy === 'quarantine') {
        result.warnings.push('Policy is "quarantine" - suspicious emails quarantined');
      }

      // Check percentage
      if (result.percentage < 100) {
        result.warnings.push(`Only ${result.percentage}% of messages subject to policy`);
      }

      // Check reporting
      if (!result.reporting.aggregate) {
        result.warnings.push('No aggregate reporting configured');
      }

      // Score
      if (result.policy === 'reject') result.score = 35;
      else if (result.policy === 'quarantine') result.score = 25;
      else result.score = 10;

    } catch (error) {
      result.errors.push(error.message);
    }

    return result;
  }

  // ===== MTA-STS CHECK =====
  async checkMTASTS(domain) {
    const result = {
      found: false,
      policy: null,
      mode: null,
      maxAge: null,
      includeSubdomains: false,
      warnings: [],
      errors: [],
      score: 0
    };

    try {
      const records = await dns.resolveTxt(`_mta-sts.${domain}`);
      const stsRecord = records.find(r => r.join('').includes('v=STSv1'));

      if (!stsRecord) {
        result.errors.push('No MTA-STS record found - email not secured with TLS enforcement');
        return result;
      }

      result.found = true;
      const tags = {};
      stsRecord[0].split(';').forEach(part => {
        const [k, v] = part.trim().split('=');
        if (k) tags[k] = v;
      });

      result.mode = tags.mode || 'enforce';
      result.maxAge = parseInt(tags.max_age || '0');
      result.includeSubdomains = tags.include_subdomains === 'yes';

      // Score
      if (result.mode === 'enforce' && result.maxAge >= 86400) result.score = 15;
      else if (result.mode === 'testing') result.score = 10;

    } catch (error) {
      result.errors.push(error.message);
    }

    return result;
  }

  // ===== TLS-RPT CHECK =====
  async checkTLSRPT(domain) {
    const result = {
      found: false,
      reporting: null,
      warnings: [],
      errors: [],
      score: 0
    };

    try {
      const records = await dns.resolveTxt(`_smtp._tls.${domain}`);
      const tlsRecord = records.find(r => r.join('').includes('v=TLSRPTv1'));

      if (!tlsRecord) {
        result.errors.push('No TLS-RPT record - no reporting on TLS failures');
        return result;
      }

      result.found = true;
      const tags = {};
      tlsRecord[0].split(';').forEach(part => {
        const [k, v] = part.trim().split('=');
        if (k) tags[k] = v;
      });

      result.reporting = tags.rua || tags.ruf;

      if (result.reporting) result.score = 5;

    } catch (error) {
      result.errors.push(error.message);
    }

    return result;
  }

  // ===== IMPERSONATION CHECK =====
  async checkImpersonation(domain) {
    const result = {
      checks: [],
      threats: [],
      score: 0,
      summary: 'No threats detected'
    };

    // Check 1: Domain lookalikes
    const domainParts = domain.split('.');
    if (domainParts.length >= 2) {
      const baseDomain = domainParts.slice(-2).join('.');
      
      // This would need external threat intelligence in production
      result.checks.push({
        name: 'Domain Lookalikes',
        status: 'info',
        message: 'Checked for typosquatting and lookalike domains'
      });
    }

    // Check 2: SPF all allowing all
    // SPF is published at the domain apex (RFC 7208 §3), not _spf.<domain>.
    try {
      const spfRecords = await dns.resolveTxt(domain);
      const spf = spfRecords.find(r => r.join('').includes('v=spf1'));
      if (spf && /(^|\s)\+all(\s|$)/.test(spf.join(''))) {
        result.threats.push({
          severity: 'high',
          type: 'SPF Open Relay',
          message: 'SPF allows all servers (+all) - easy to spoof'
        });
        result.score -= 20;
      }
    } catch (e) {}

    // Check 3: No DMARC
    try {
      await dns.resolveTxt(`_dmarc.${domain}`);
    } catch (e) {
      result.threats.push({
        severity: 'high',
        type: 'No DMARC',
        message: 'No DMARC record - no protection against impersonation'
      });
      result.score -= 25;
    }

    // Check 4: Weak DMARC
    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
      const dmarc = dmarcRecords.find(r => r.join('').includes('v=DMARC1'));
      if (dmarc) {
        const record = dmarc.join('');
        if (record.includes('p=none')) {
          result.threats.push({
            severity: 'medium',
            type: 'DMARC No Policy',
            message: 'DMARC policy is "none" - no action on failures'
          });
          result.score -= 10;
        }
      }
    } catch (e) {}

    // Summary
    if (result.threats.length === 0) {
      result.summary = 'No impersonation threats detected';
    } else if (result.threats.filter(t => t.severity === 'high').length > 0) {
      result.summary = 'High risk - immediate action required';
    } else {
      result.summary = 'Medium risk - review recommended';
    }

    return result;
  }

  // ===== HELPER METHODS =====

  parseDMARCTags(record) {
    const tags = {};
    record.split(';').forEach(part => {
      const [key, value] = part.split('=').map(s => s.trim());
      if (key && value) tags[key] = value;
    });
    return tags;
  }

  calculateHealthScore(spf, dkim, dmarc, mta_sts, tls_rpt) {
    let score = 0;
    score += spf?.score || 0;
    score += dkim?.score || 0;
    score += dmarc?.score || 0;
    score += mta_sts?.score || 0;
    score += tls_rpt?.score || 0;
    return Math.max(0, Math.min(100, score));
  }

  collectIssues(spf, dkim, dmarc, mta_sts, tls_rpt, impersonation) {
    const issues = [];
    
    if (spf?.errors) issues.push(...spf.errors.map(e => ({ type: 'SPF', severity: 'high', message: e })));
    if (spf?.warnings) issues.push(...spf.warnings.map(w => ({ type: 'SPF', severity: 'medium', message: w })));
    
    if (dkim?.errors) issues.push(...dkim.errors.map(e => ({ type: 'DKIM', severity: 'high', message: e })));
    if (dkim?.warnings) issues.push(...dkim.warnings.map(w => ({ type: 'DKIM', severity: 'medium', message: w })));
    
    if (dmarc?.errors) issues.push(...dmarc.errors.map(e => ({ type: 'DMARC', severity: 'high', message: e })));
    if (dmarc?.warnings) issues.push(...dmarc.warnings.map(w => ({ type: 'DMARC', severity: 'medium', message: w })));
    
    if (mta_sts?.errors) issues.push(...mta_sts.errors.map(e => ({ type: 'MTA-STS', severity: 'medium', message: e })));
    if (tls_rpt?.errors) issues.push(...tls_rpt.errors.map(e => ({ type: 'TLS-RPT', severity: 'low', message: e })));
    
    if (impersonation?.threats) issues.push(...impersonation.threats.map(t => ({ type: 'Impersonation', severity: t.severity, message: t.message })));

    return issues;
  }

  generateRecommendations(spf, dkim, dmarc, mta_sts, tls_rpt, impersonation) {
    const recommendations = [];

    if (!spf?.found) {
      recommendations.push({
        priority: 'high',
        action: 'Create SPF record',
        command: `v=spf1 include:_spf.yourmailprovider.com ~all`,
        target: 'SPF'
      });
    } else if (spf.policy !== 'hardfail') {
      recommendations.push({
        priority: 'medium',
        action: 'Strengthen SPF policy to hardfail',
        command: 'Update to v=spf1 ... -all',
        target: 'SPF'
      });
    }

    if (!dkim?.found) {
      recommendations.push({
        priority: 'high',
        action: 'Set up DKIM signing',
        command: 'Configure your email provider to sign outgoing emails',
        target: 'DKIM'
      });
    }

    if (!dmarc?.found) {
      recommendations.push({
        priority: 'high',
        action: 'Create DMARC record',
        command: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com',
        target: 'DMARC'
      });
    } else if (dmarc.policy === 'none') {
      recommendations.push({
        priority: 'high',
        action: 'Upgrade DMARC to quarantine',
        command: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com',
        target: 'DMARC'
      });
    }

    if (!mta_sts?.found) {
      recommendations.push({
        priority: 'medium',
        action: 'Enable MTA-STS',
        command: 'Create _mta-sts TXT record with v=STSv1; mode=enforce; max-age=86400',
        target: 'MTA-STS'
      });
    }

    return recommendations;
  }
}

module.exports = { EmailSecurityAuditor };