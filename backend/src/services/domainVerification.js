const dns = require('dns').promises;
const crypto = require('crypto');

class DomainVerificationService {
  // Resolvers are injectable so tests can run without network access.
  constructor(options = {}) {
    this.verificationPrefix = '_nexusemail-verification';
    this.verificationTimeout = 5000;
    this.txtResolver = options.txtResolver || ((name) => dns.resolveTxt(name));
    this.cnameResolver = options.cnameResolver || ((name) => dns.resolveCname(name));
  }

  generateVerificationToken() {
    return crypto.randomBytes(16).toString('hex');
  }

  generateVerification(domain) {
    const token = this.generateVerificationToken();
    const txtRecord = `${this.verificationPrefix}=${token}`;
    
    return {
      domain,
      token,
      method: 'TXT',
      record: txtRecord,
      recordValue: token,
      cnameRecord: `verify.${domain}`,
      cnameTarget: `${token}.verification.nexusemail.local`,
      instructions: {
        txt: `Add a TXT record for ${domain}:\n  Name: ${this.verificationPrefix}\n  Value: ${txtRecord}`,
        cname: `Add a CNAME record for verify.${domain}:\n  Name: verify\n  Value: ${token}.verification.nexusemail.local`
      },
      status: 'pending',
      created_at: new Date().toISOString()
    };
  }

  async verifyTXTRecord(domain, token) {
    // The instructions (and the UI) point users at
    // _nexusemail-verification.<domain> — check that name first, then
    // fall back to the apex for records placed there directly. Both
    // value forms pass: the full "<prefix>=<token>" string and the
    // bare token.
    let lastError = null;
    let lookedUp = false;
    for (const name of [`${this.verificationPrefix}.${domain}`, domain]) {
      let txtRecords;
      try {
        txtRecords = await this.txtResolver(name);
      } catch (e) {
        lastError = e;
        continue;
      }
      lookedUp = true;
      for (const record of txtRecords) {
        const combined = record.join('');
        if (combined === `${this.verificationPrefix}=${token}` || combined.includes(token)) {
          return { verified: true, method: 'TXT' };
        }
      }
    }

    if (!lookedUp && lastError) {
      return { verified: false, method: 'TXT', reason: lastError.message };
    }
    return { verified: false, method: 'TXT', reason: 'TXT record not found' };
  }

  async verifyCNAMERecord(subdomain, token) {
    try {
      const cnameRecords = await this.cnameResolver(subdomain);
      
      for (const record of cnameRecords) {
        if (record.includes(token)) {
          return { verified: true, method: 'CNAME' };
        }
      }
      
      return { verified: false, method: 'CNAME', reason: 'CNAME record not found' };
    } catch (e) {
      return { verified: false, method: 'CNAME', reason: e.message };
    }
  }

  async verify(domain, token, method = 'TXT') {
    const result = {
      domain,
      token,
      method,
      verified: false,
      verified_at: null
    };

    let txtResult = null;
    let cnameResult = null;

    if (method === 'TXT' || method === 'AUTO') {
      txtResult = await this.verifyTXTRecord(domain, token);
      if (txtResult.verified) {
        result.verified = true;
        result.method = 'TXT';
        result.verified_at = new Date().toISOString();
        return result;
      }
    }

    if (method === 'CNAME' || method === 'AUTO') {
      const verifySubdomain = `verify.${domain}`;
      cnameResult = await this.verifyCNAMERecord(verifySubdomain, token);
      if (cnameResult.verified) {
        result.verified = true;
        result.method = 'CNAME';
        result.verified_at = new Date().toISOString();
        return result;
      }
    }

    result.reason = (txtResult && txtResult.reason) || (cnameResult && cnameResult.reason) || 'Verification failed';
    return result;
  }

  isDomainVerified(verification) {
    return verification && verification.status === 'verified' && verification.verified_at;
  }

  getVerificationStatus(domainData) {
    return {
      domain: domainData.domain,
      verified: domainData.verified || false,
      verified_at: domainData.verified_at || null,
      verification_method: domainData.verification_method || null,
      features_unlocked: domainData.verified || false
    };
  }
}

module.exports = { DomainVerificationService };