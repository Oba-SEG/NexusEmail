const dns = require('dns').promises;
const https = require('https');
const { escapeHtml } = require('../utils/html');

class BrandProtectionService {
  constructor() {
    this.commonTLDs = ['com', 'net', 'org', 'io', 'co', 'ai', 'app', 'dev', 'xyz', 'info', 'biz', 'co.za', 'org.za', 'net.za', 'web.za', 'gov.za', 'school.za', 'ac.za'];
    this.dnsProviders = [
      { name: 'Cloudflare', ns: ['cloudflare.com', 'ns.cloudflare.com', 'cf-dns'] },
      { name: 'AWS Route53', ns: ['aws.amazon.com', 'route53', 'amazonaws.com'] },
      { name: 'Google Cloud DNS', ns: ['googledomains.com', 'cloud.google', 'google.com'] },
      { name: 'Azure DNS', ns: ['azure.com', 'windows.net', 'cloudapp.net'] },
      { name: 'Namecheap', ns: ['namecheap.com', 'dnscheap.com'] },
      { name: 'GoDaddy', ns: ['godaddy.com', 'secureserver.net', 'domaincontrol'] },
      { name: 'Hover', ns: ['hover.com', 'hoverdns.com'] },
      { name: 'Domain.com', ns: ['domain.com'] },
      { name: 'Name.com', ns: ['name.com', 'name-servers.com'] },
      { name: 'Dynadot', ns: ['dynadot.com'] },
      { name: 'Porkbun', ns: ['porkbun.com'] },
      { name: 'Namesilo', ns: ['namesilo.com', 'ns1.namesilo.com'] },
      { name: 'Register.com', ns: ['register.com'] },
      { name: '123 Reg', ns: ['123-reg.co.uk', '123reg.com'] },
      { name: 'Domains.co.za', ns: ['domains.co.za', 'coza.net.za'] },
      { name: 'Webafrica', ns: ['webafrica.co.za', 'wadns.co.za'] },
      { name: 'Hetzner', ns: ['hetzner.co.za', 'host-h.net'] },
      { name: 'Telkom', ns: ['telkom.co.za', 'telkomsa.net'] },
      { name: 'Afrihost', ns: ['afrihost.com', 'afrihost.co.za'] },
      { name: 'MWeb', ns: ['mweb.co.za', 'mweb.co.za'] },
      { name: 'CoolIdeas', ns: ['coolideas.co.za'] },
      { name: 'Vodacom', ns: ['vodacom.co.za'] },
      { name: 'Cscglobal', ns: ['cscglobal.com'] },
      { name: 'Directnic', ns: ['directnic.com'] },
      { name: 'OpenSRS', ns: ['opensrs.com', 'tucows.com'] },
      { name: 'MarkMonitor', ns: ['markmonitor.com'] },
      { name: 'Network Solutions', ns: ['networksolutions.com'] },
      { name: 'EasyDNS', ns: ['easydns.com'] },
      { name: 'DNSEver', ns: ['dnsever.com'] },
    ];
    
    this.socialPlatforms = [
      { name: 'Facebook', domains: ['facebook.com', 'fb.com'] },
      { name: 'Twitter/X', domains: ['twitter.com', 'x.com'] },
      { name: 'LinkedIn', domains: ['linkedin.com'] },
      { name: 'Instagram', domains: ['instagram.com'] },
      { name: 'YouTube', domains: ['youtube.com'] },
      { name: 'TikTok', domains: ['tiktok.com'] },
    ];
  }

  async checkBrandProtection(mainDomain, previousResults = null) {
    const baseName = mainDomain.split('.')[0];
    const results = {
      domain: mainDomain,
      timestamp: new Date().toISOString(),
      progress: [],
      lookalikes: [],
      typosquatting: [],
      impersonation: [],
      homographs: [],
      socialMedia: [],
      dns_provider: null,
      registrar: null,
      score: 100,
      issues: [],
      recommendations: [],
      newThreats: [],
      alerts: []
    };

    try {
      results.progress.push({ step: 'detecting_provider', label: 'Detecting DNS provider...', done: false, complete: false });
      const provider = await this.detectDNSProvider(mainDomain);
      results.dns_provider = provider;
      results.progress[0].done = true;
      results.progress[0].complete = true;

      results.progress.push({ step: 'registrar', label: 'Looking up registrar info...', done: false, complete: false });
      const registrar = await this.getRegistrarInfo(mainDomain);
      results.registrar = registrar;
      results.progress[1].done = true;
      results.progress[1].complete = true;

      results.progress.push({ step: 'typosquatting', label: 'Checking typosquatting variations...', done: false, complete: false });
      const typos = await this.checkTypoSquats(baseName, mainDomain);
      results.typosquatting = typos.records;
      results.progress[2].done = true;
      results.progress[2].complete = true;
      if (typos.found > 0) {
        results.score -= typos.found * 15;
        results.issues.push({ type: 'typosquatting', count: typos.found, severity: 'high' });
        results.recommendations.push('Consider registering common typosquatting domains to prevent abuse');
      }

      results.progress.push({ step: 'lookalikes', label: 'Checking lookalike domains...', done: false, complete: false });
      const lookalikes = await this.checkLookalikes(baseName, mainDomain);
      results.lookalikes = lookalikes.records;
      results.progress[3].done = true;
      results.progress[3].complete = true;
      if (lookalikes.found > 0) {
        results.score -= lookalikes.found * 10;
        results.issues.push({ type: 'lookalike', count: lookalikes.found, severity: 'medium' });
        results.recommendations.push('Monitor or register lookalike domains that could be used for phishing');
      }

      results.progress.push({ step: 'subdomain_abuse', label: 'Checking subdomain abuse...', done: false, complete: false });
      const subdomains = await this.checkSubdomainAbuse(mainDomain);
      results.impersonation = subdomains.records;
      results.progress[4].done = true;
      results.progress[4].complete = true;
      if (subdomains.found > 0) {
        results.score -= subdomains.found * 5;
        results.issues.push({ type: 'subdomain_abuse', count: subdomains.found, severity: 'low' });
      }

      results.progress.push({ step: 'social_media', label: 'Checking social media variants...', done: false, complete: false });
      const social = await this.checkSocialMedia(baseName, mainDomain);
      results.socialMedia = social.records;
      results.progress[5].done = true;
      results.progress[5].complete = true;
      if (social.found > 0) {
        results.score -= social.found * 8;
        results.issues.push({ type: 'social_media', count: social.found, severity: 'medium' });
      }

      results.progress.push({ step: 'homograph', label: 'Checking homograph attacks...', done: false, complete: false });
      const homographs = await this.checkHomographs(baseName, mainDomain);
      results.homographs = homographs.records;
      results.progress[6].done = true;
      results.progress[6].complete = true;
      if (homographs.found > 0) {
        results.score -= homographs.found * 12;
        results.issues.push({ type: 'homograph', count: homographs.found, severity: 'high' });
      }

      results.score = Math.max(0, Math.round(results.score));

      if (previousResults) {
        results.newThreats = this.detectNewThreats(previousResults, results);
        results.alerts = this.generateAlerts(results.newThreats);
      }

    } catch (error) {
      results.error = error.message;
    }

    return results;
  }

  detectNewThreats(previous, current) {
    const newThreats = [];
    const allTypes = [
      { key: 'typosquatting', label: 'Typosquatting' },
      { key: 'lookalikes', label: 'Lookalike' },
      { key: 'impersonation', label: 'Impersonation' },
      { key: 'homographs', label: 'Homograph' },
      { key: 'socialMedia', label: 'Social Media' },
    ];

    for (const type of allTypes) {
      const prevDomains = new Set((previous[type.key] || []).map(t => t.domain));
      const currDomains = (current[type.key] || []).filter(t => !prevDomains.has(t.domain));
      for (const threat of currDomains) {
        newThreats.push({ ...threat, threat_type: type.label });
      }
    }
    return newThreats;
  }

  generateAlerts(newThreats) {
    const alerts = [];
    for (const threat of newThreats) {
      alerts.push({
        id: Date.now() + Math.random(),
        type: 'new_threat',
        severity: threat.threat_type === 'Typosquatting' || threat.threat_type === 'Homograph' ? 'high' : 'medium',
        message: `New ${threat.threat_type} detected: ${threat.domain}`,
        timestamp: new Date().toISOString(),
        domain: threat.domain
      });
    }
    return alerts;
  }

  async detectDNSProvider(domain) {
    try {
      const nsRecords = await dns.resolveNs(domain);
      if (nsRecords && nsRecords.length > 0) {
        for (const ns of nsRecords) {
          const nsLower = ns.toLowerCase();
          for (const provider of this.dnsProviders) {
            if (provider.ns.some(pattern => nsLower.includes(pattern))) {
              return { name: provider.name, ns: nsRecords };
            }
          }
        }
        return { name: 'Other/Custom', ns: nsRecords };
      }
    } catch (e) {
      try {
        const domainIP = await dns.resolve4(domain);
        return { name: 'Unknown', ns: ['Direct IP: ' + domainIP[0]] };
      } catch (e2) {}
    }
    return { name: 'Unknown', ns: null };
  }

  async getRegistrarInfo(domain) {
    console.log('[BrandProtection] getRegistrarInfo called for:', domain);
    try {
      const whoisData = await this.whoisLookup(domain);
      console.log('[BrandProtection] WHOIS result:', whoisData);
      return whoisData;
    } catch (e) {
      console.log('[BrandProtection] WHOIS error:', e.message);
      return { registrar: 'Unknown', abuse_email: null, created_date: null };
    }
  }

  async whoisLookup(domain) {
    const parts = domain.split('.');
    const tld = parts.pop();
    const secondLevel = parts[parts.length - 1];
    
    // Comprehensive WHOIS servers for different TLDs
    const whoisServers = {
      // Major global TLDs
      'com': 'whois.verisign.com',
      'net': 'whois.verisign.com',
      'org': 'whois.pir.org',
      'edu': 'whois.educause.edu',
      'gov': 'whois.dotgov.gov',
      
      // New gTLDs
      'io': 'whois.io',
      'co': 'whois.nic.co',
      'ai': 'whois.nic.ai',
      'app': 'whois.nic.google',
      'dev': 'whois.nic.google',
      'xyz': 'whois.nic.xyz',
      'wiki': 'whois.nic.wiki',
      'rest': 'whois.nic.rest',
      'ink': 'whois.nic.ink',
      'online': 'whois.nic.online',
      'site': 'whois.nic.site',
      'host': 'whois.nic.host',
      'website': 'whois.nic.website',
      'store': 'whois.nic.store',
      'tech': 'whois.nic.tech',
      'space': 'whois.nic.space',
      'biz': 'whois.biz',
      'info': 'whois.afilias.info',
      'mobi': 'whois.nic.mobi',
      
      // European TLDs
      'eu': 'whois.eu',
      'uk': 'whois.nic.uk',
      'de': 'whois.denic.de',
      'fr': 'whois.nic.fr',
      'es': 'whois.nic.es',
      'it': 'whois.nic.it',
      'nl': 'whois.nl',
      'pl': 'whois.dns.pl',
      'ch': 'whois.nic.ch',
      'at': 'whois.nic.at',
      
      // Asian TLDs
      'jp': 'whois.jprs.jp',
      'kr': 'whois.kr',
      'cn': 'whois.cnnic.cn',
      'in': 'whois.inregistry.in',
      'th': 'whois.thnic.co.th',
      'my': 'whois.mynic.my',
      'sg': 'whois.sgnic.sg',
      'ph': 'whois.dot.ph',
      
      // Latin American TLDs
      'br': 'whois.registro.br',
      'mx': 'whois.nic.mx',
      'ar': 'whois.nic.ar',
      'cl': 'whois.nic.cl',
      'co': 'whois.nic.co',
      
      // African TLDs
      'za': 'whois.registry.za',
      'co.za': 'coza.whois-servers.net',
      'org.za': 'whois.org.za',
      'net.za': 'whois.net.za',
      'web.za': 'whois.web.za',
      'africa': 'whois.africanregistry.ent',
      'ng': 'whois.nic.ng',
      'ke': 'whois.kenic.or.ke',
      'gh': 'whois.nic.gh',
      'tz': 'whois.tznic.or.tz',
      
      // Other TLDs
      'ru': 'whois.tcinet.ru',
      'ua': 'whois.ua',
      'tr': 'whois.nic.tr',
      'il': 'whois.isoc.org.il',
      'nz': 'whois.nzrs.org.nz',
      'au': 'whois.auda.org.au',
      'ca': 'whois.cira.ca',
    };
    
    // Special handling for SA TLDs (.co.za, .org.za, etc) - use domains.co.za
    if (tld === 'za' || domain.includes('.co.za') || domain.endsWith('.za')) {
      return this.domainsCoZaLookup(domain);
    }
    
    const server = whoisServers[tld] || 'whois.verisign.com';
    
    return new Promise((resolve) => {
      const net = require('net');
      const client = new net.Socket();
      
      client.setTimeout(5000);
      
      client.connect(43, server, () => {
        client.write(domain + '\r\n');
      });
      
      client.on('data', (data) => {
        const result = { registrar: 'Unknown', abuse_email: null, created_date: null };
        const whoisData = data.toString();
        
        const lines = whoisData.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('Registrar:')) {
            result.registrar = trimmed.replace('Registrar:', '').trim();
          }
          if (trimmed.startsWith('Registrar WHOIS Server:') && result.registrar === 'Unknown') {
            result.registrar = trimmed.replace('Registrar WHOIS Server:', '').trim();
          }
          if (trimmed.includes('Abuse Contact Email')) {
            const match = trimmed.match(/([\w.-]+@[\w.-]+)/);
            if (match) result.abuse_email = match[1];
          }
          if (trimmed.startsWith('Creation Date:')) {
            result.created_date = trimmed.replace('Creation Date:', '').trim();
          }
        }
        
        client.destroy();
        resolve(result);
      });
      
      client.on('timeout', () => { client.destroy(); resolve({ registrar: 'Unknown', abuse_email: null, created_date: null }); });
      client.on('error', () => resolve({ registrar: 'Unknown', abuse_email: null, created_date: null }));
    });
  }

  async domainsCoZaLookup(domain) {
    try {
      // Use domains.co.za WHOIS XML API
      const response = await fetch(`https://www.domains.co.za/whois/${domain}`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        // Fallback to direct WHOIS
        return this.fallbackWhois(domain, 'coza.whois-servers.net');
      }
      
      const text = await response.text();
      
      const result = { registrar: 'Unknown', abuse_email: null, created_date: null };
      
      // Parse common patterns
      const lines = text.split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes('registrar') && result.registrar === 'Unknown') {
          const match = line.match(/[:=]\s*(.+)/i);
          if (match) result.registrar = match[1].trim();
        }
        if (lower.includes('abuse') && line.includes('@')) {
          const match = line.match(/([\w.-]+@[\w.-]+)/);
          if (match) result.abuse_email = match[1];
        }
        if (lower.includes('created') || lower.includes('registered')) {
          const match = line.match(/[:=]\s*(.+)/i);
          if (match && !result.created_date) result.created_date = match[1].trim();
        }
      }
      
      // If no registrar found, use fallback
      if (result.registrar === 'Unknown') {
        return this.fallbackWhois(domain, 'coza.whois-servers.net');
      }
      
      return result;
    } catch (e) {
      // Fallback to direct WHOIS
      return this.fallbackWhois(domain, 'coza.whois-servers.net');
    }
  }

  async fallbackWhois(domain, server) {
    return new Promise((resolve) => {
      const net = require('net');
      const client = new net.Socket();
      
      client.setTimeout(5000);
      client.connect(43, server, () => {
        client.write(domain + '\r\n');
      });
      
      client.on('data', (data) => {
        const result = { registrar: 'Unknown', abuse_email: null, created_date: null };
        const whoisData = data.toString();
        
        const lines = whoisData.split('\n');
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (lower.includes('registrar') && result.registrar === 'Unknown') {
            const match = line.match(/[:=]\s*(.+)/i);
            if (match) result.registrar = match[1].trim();
          }
          if (lower.includes('abuse') && line.includes('@')) {
            const match = line.match(/([\w.-]+@[\w.-]+)/);
            if (match) result.abuse_email = match[1];
          }
          if ((lower.includes('created') || lower.includes('registered')) && !result.created_date) {
            const match = line.match(/[:=]\s*(.+)/i);
            if (match) result.created_date = match[1].trim();
          }
        }
        
        client.destroy();
        resolve(result);
      });
      
      client.on('timeout', () => { client.destroy(); resolve({ registrar: 'Unknown', abuse_email: null, created_date: null }); });
      client.on('error', () => resolve({ registrar: 'Unknown', abuse_email: null, created_date: null }));
    });
  }

  async checkTypoSquats(baseName, mainDomain) {
    const records = [];
    const variations = new Set();
    const tld = mainDomain.split('.').slice(1).join('.') || 'com';

    const keyboardAdjacent = {
      'a': ['q', 'w', 's', 'z'], 'b': ['v', 'g', 'h', 'n'], 'c': ['x', 'd', 'f', 'v'],
      'd': ['s', 'e', 'r', 'f', 'c', 'x'], 'e': ['w', 's', 'd', 'r'], 'f': ['d', 'r', 't', 'g', 'v', 'c'],
      'g': ['f', 't', 'y', 'h', 'b', 'v'], 'h': ['g', 'y', 'u', 'j', 'n', 'b'], 'i': ['u', 'j', 'k', 'o'],
      'j': ['h', 'u', 'i', 'k', 'm', 'n'], 'k': ['j', 'i', 'o', 'l', 'm'], 'l': ['k', 'o', 'p'],
      'm': ['n', 'j', 'k'], 'n': ['b', 'h', 'j', 'm'], 'o': ['i', 'k', 'l', 'p'], 'p': ['o', 'l'],
      'q': ['w', 'a'], 'r': ['e', 'd', 'f', 't'], 's': ['a', 'w', 'e', 'd', 'x', 'z'],
      't': ['r', 'f', 'g', 'y'], 'u': ['y', 'h', 'j', 'i'], 'v': ['c', 'f', 'g', 'b'],
      'w': ['q', 'a', 's', 'e'], 'x': ['z', 's', 'd', 'c'], 'y': ['t', 'g', 'h', 'u'], 'z': ['a', 's', 'x'],
    };

    const charReplacements = { 'o': ['0', 'a'], 'l': ['1', 'i', 't'], 'i': ['1', 'l', 'o'], 'e': ['a', 'o', '3'], 'a': ['e', 'o', '4'] };

    for (let i = 0; i < baseName.length; i++) {
      const char = baseName[i];
      if (keyboardAdjacent[char]) {
        for (const adj of keyboardAdjacent[char]) {
          variations.add(baseName.slice(0, i) + adj + baseName.slice(i + 1));
        }
      }
      if (charReplacements[char]) {
        for (const rep of charReplacements[char]) {
          variations.add(baseName.slice(0, i) + rep + baseName.slice(i + 1));
        }
      }
    }

    for (let i = 0; i < baseName.length - 1; i++) {
      variations.add(baseName.slice(0, i) + baseName[i + 1] + baseName[i] + baseName.slice(i + 2));
    }

    for (let i = 0; i < baseName.length; i++) {
      variations.add(baseName.slice(0, i) + baseName[i] + baseName[i] + baseName.slice(i));
    }

    for (let i = 0; i < baseName.length - 1; i++) {
      if (baseName[i] === baseName[i + 1]) {
        variations.add(baseName.slice(0, i) + baseName[i] + baseName.slice(i + 2));
      }
    }

    for (let i = 0; i < baseName.length; i++) {
      variations.add(baseName.slice(0, i) + baseName.slice(i + 1));
    }

    if (baseName.length > 4) {
      for (let i = 1; i < baseName.length - 1; i++) {
        variations.add(baseName.slice(0, i) + '-' + baseName.slice(i));
      }
    }

    const tldsToCheck = [tld, 'com', 'net', 'org', 'io', 'co', 'co.za'];
    
    for (const variant of [...variations].slice(0, 80)) {
      if (variant === baseName || variant.length < 2) continue;
      
      for (const checkTld of tldsToCheck) {
        const domain = `${variant}.${checkTld}`;
        if (domain === mainDomain) continue;
        
        try {
          const addresses = await dns.resolve4(domain);
          let hasMX = false;
          try { const mx = await dns.resolveMx(domain); hasMX = mx.length > 0; } catch (e) {}
          
          records.push({ domain, type: hasMX ? 'typosquat_with_email' : 'typosquat', tld: checkTld, status: 'registered', hasMailServer: hasMX, hasWebsite: addresses.length > 0 });
        } catch (e) {}
      }
    }

    const uniqueRecords = records.filter((r, i, arr) => arr.findIndex(x => x.domain === r.domain) === i);
    return { records: uniqueRecords.slice(0, 20), found: uniqueRecords.length };
  }

  async checkLookalikes(baseName, mainDomain) {
    const records = [];
    const base = mainDomain.split('.').slice(1).join('.');
    const prefixes = ['mail', 'web', 'www', 'ftp', 'secure', 'login', 'account', 'admin', 'support', 'smtp', 'webmail'];
    const suffixes = ['mail', 'web', 'email', 'hub', 'center', 'portal', 'app', 'dev'];

    for (const prefix of prefixes) {
      const domain = `${prefix}${baseName}.${base}`;
      try {
        await dns.resolve(domain);
        records.push({ domain, type: 'prefix', status: 'exists' });
      } catch (e) {}
    }

    for (const suffix of suffixes) {
      const domain = `${baseName}${suffix}.${base}`;
      try {
        await dns.resolve(domain);
        records.push({ domain, type: 'suffix', status: 'exists' });
      } catch (e) {}
    }

    return { records: records.slice(0, 15), found: records.length };
  }

  async checkSubdomainAbuse(mainDomain) {
    const records = [];
    const mainParts = mainDomain.split('.');
    const base = mainParts.slice(-2).join('.');
    const baseName = mainParts[0];

    const suspiciousSubdomains = ['phishing', 'fake', 'secure', 'login', 'verify', 'account', 'update', 'mail', 'smtp', 'webmail', 'admin', 'support', 'api'];
    
    for (const sub of suspiciousSubdomains) {
      const domain = `${sub}.${mainDomain}`;
      try {
        const ips = await dns.resolve(domain);
        records.push({ domain, type: 'abused_subdomain', ips, status: 'active', subdomain: sub });
      } catch (e) {}
    }

    const lookalikePrefixes = [baseName, baseName.slice(0, -1), baseName + 's', baseName + 'z', baseName.replace(/e/g, 'i')];
    for (const prefix of lookalikePrefixes) {
      const domain = `${prefix}.${base}`;
      if (domain !== mainDomain) {
        try {
          const ips = await dns.resolve(domain);
          records.push({ domain, type: 'brand_subdomain', ips, status: 'exists' });
        } catch (e) {}
      }
    }

    return { records, found: records.length };
  }

  async checkSocialMedia(baseName, mainDomain) {
    const records = [];
    const tld = mainDomain.split('.').slice(1).join('.');

    for (const platform of this.socialPlatforms) {
      const fakeNames = [`${baseName}-official`, `${baseName}hq`, `the${baseName}`, `${baseName}inc`, `${baseName}support`];
      for (const name of fakeNames) {
        for (const platformDomain of platform.domains) {
          const fullDomain = `${name}.${platformDomain}`;
          try {
            const ip = await dns.resolve4(fullDomain);
            records.push({ domain: fullDomain, platform: platform.name, type: 'fake_profile', status: 'exists' });
          } catch (e) {}
        }
      }
    }

    return { records: records.slice(0, 10), found: records.length };
  }

  async checkHomographs(baseName, mainDomain) {
    const records = [];
    const tld = mainDomain.split('.').slice(1).join('.');
    
    const homoglyphs = {
      'a': ['а', 'ą', 'α'], 'b': ['Ь', 'ƅ'], 'c': ['с', 'ć'], 'd': ['ԁ'], 'e': ['е', 'ę', 'ε'],
      'g': ['ɡ', 'ġ'], 'h': ['һ'], 'i': ['і', 'ı', 'l'], 'j': ['ј'], 'k': ['κ', 'ķ'],
      'l': ['1', 'і', 'ł'], 'm': ['м', 'т'], 'n': ['п', 'ń'], 'o': ['о', '0', 'ο', 'ö'],
      'p': ['р', 'p'], 's': ['ѕ', 's'], 't': ['т', '7'], 'u': ['υ', 'ų'],
      'x': ['х'], 'y': ['у', 'ý'], 'z': ['z', 'ż']
    };

    let homographVariant = '';
    for (const char of baseName.toLowerCase()) {
      homographVariant += homoglyphs[char] ? homoglyphs[char][0] : char;
    }

    if (homographVariant !== baseName.toLowerCase()) {
      for (const checkTld of [tld, 'com', 'net', 'org']) {
        const domain = `${homographVariant}.${checkTld}`;
        if (domain !== mainDomain) {
          try {
            await dns.resolve(domain);
            records.push({ domain, punycode: 'xn--' + Buffer.from(domain.split('.')[0]).toString('base64').replace(/=/g, ''), type: 'homograph', status: 'registered' });
          } catch (e) {}
        }
      }
    }

    return { records: records.slice(0, 5), found: records.length };
  }

  async addBrandMonitoring(brandDomain, brandName) {
    return { domain: brandDomain, brand_name: brandName, added_at: new Date().toISOString(), status: 'monitoring' };
  }

  buildTakedownEmail(domain, brandName, registrar, threatType) {
    // brand_name/domain/registrar are user- or DNS-sourced and the result is
    // sent as the email HTML body, so every interpolation must be escaped.
    // Newlines are rendered as <br> because sendNotification treats body as HTML.
    const templates = {
      impersonation: `Dear ${escapeHtml(registrar || 'Domain Registrar')},<br><br>I am writing to report a domain being used to impersonate our brand "${escapeHtml(brandName)}". The infringing domain is: ${escapeHtml(domain)}<br><br>This domain is being used for phishing, fraud, or brand impersonation purposes. We request immediate suspension of this domain.<br><br>Please contact us to verify our identity and proceed with the takedown.<br><br>Sincerely,<br>Brand Protection Team`,
      typosquatting: `Dear ${escapeHtml(registrar || 'Domain Registrar')},<br><br>We are reporting a typosquatting domain that mimics our brand "${escapeHtml(brandName)}": ${escapeHtml(domain)}<br><br>This domain was registered to confuse users and potentially engage in phishing or fraud. We request its suspension.<br><br>Please contact us to verify our identity.<br><br>Sincerely,<br>Brand Protection Team`,
      phishing: `Dear ${escapeHtml(registrar || 'Domain Registrar')},<br><br>We report a phishing site impersonating "${escapeHtml(brandName)}": ${escapeHtml(domain)}<br><br>This site is being used to steal user credentials or distribute malware. Urgent action is requested.<br><br>Please suspend this domain immediately.<br><br>Sincerely,<br>Brand Protection Team`
    };
    return templates[threatType] || templates.impersonation;
  }
}

module.exports = { BrandProtectionService };