const dns = require('dns').promises;
const https = require('https');
const { escapeHtml } = require('../utils/html');
const { domainToASCII } = require('url');

// TLD coverage for typo / homograph / lookalike probing. The brand's own TLD
// is prepended at scan time. Phishing registrations cluster on the cheap
// commercial TLDs below, but country TLDs matter too — keep this list focused
// and use concurrency (not a narrower list) to stay within a sane scan time.
const SCAN_TLDS = [
  'com', 'net', 'org',
  'io', 'co', 'ai', 'app', 'dev', 'xyz', 'info', 'biz',
  'shop', 'site', 'online', 'top', 'link', 'club', 'live', 'icu', 'buzz', 'click',
  'us', 'uk', 'de', 'za', 'co.za', 'com.au', 'ca', 'in', 'br', 'ng', 'ke',
];
const MAX_TYPO_VARIANTS = 80;
const MAX_TYPO_RECORDS = 100;
const MAX_LOOKALIKE_RECORDS = 25;
const MAX_TYPO_PROBES = 20000;
const MAX_LOOKALIKE_PROBES = 6000;
const PROBE_CONCURRENCY = 48;
// Raw detections kept for persistence (bounded against wildcard-TLD blowups)
// are separate from the display-capped `records` arrays.
const MAX_DETECTIONS = 1000;
const MAX_HOMOGRAPH_VARIANTS = 16;

// Brand TLD first (typos usually keep the original suffix), then the rest.
// `tlds` comes from the registry when configured (see tldRegistry.js).
function orderedTlds(brandTld, tlds = SCAN_TLDS) {
  const tld = String(brandTld || '').toLowerCase();
  return [...new Set([tld, ...tlds].map((t) => String(t || '').toLowerCase()).filter(Boolean))];
}

// Candidates for the typo probe: the brand's own name on every other TLD
// (not a typo, but the cheapest impersonation to set up), followed by the
// generated typo variants. Bounded so a huge TLD universe can't explode.
function typoProbeCandidates(baseName, mainDomain, tlds = SCAN_TLDS) {
  const tld = mainDomain.split('.').slice(1).join('.') || 'com';
  const tldList = orderedTlds(tld, tlds);
  const variants = [...typoVariants(baseName)].slice(0, MAX_TYPO_VARIANTS);

  const candidates = [];
  for (const checkTld of tldList) {
    const domain = `${baseName}.${checkTld}`;
    if (domain !== mainDomain) candidates.push({ domain, tld: checkTld, sameName: true });
  }
  for (const variant of variants) {
    if (variant === baseName || variant.length < 2) continue;
    for (const checkTld of tldList) {
      const domain = `${variant}.${checkTld}`;
      if (domain !== mainDomain) candidates.push({ domain, tld: checkTld, sameName: false });
      if (candidates.length >= MAX_TYPO_PROBES) break;
    }
    if (candidates.length >= MAX_TYPO_PROBES) break;
  }
  return { tldList, candidates };
}

// Unicode-only confusables. ASCII lookalikes (0/o, 1/l, 7/t) are already
// covered by the typo generator; repeating them here would count the same
// registration twice under two sections.
const HOMOGLYPHS = {
  a: ['а', 'ą', 'α'], b: ['Ь', 'ƅ'], c: ['с', 'ć'], d: ['ԁ'],
  e: ['е', 'ę', 'ε'], g: ['ɡ', 'ġ'], h: ['һ'], i: ['і', 'ı'],
  j: ['ј'], k: ['κ'], l: ['ł'], m: ['м'], n: ['п', 'ń'],
  o: ['о', 'ο', 'ö'], p: ['р'], s: ['ѕ'], t: ['т'],
  u: ['υ'], x: ['х'], y: ['у'], z: ['ż'],
};

// Pure homograph generator (no DNS) — single-character substitutions are the
// realistic attacks (Cyrillic 'а' for Latin 'a'); a full-string mutation is
// added as the long tail. Bounded so the probe set stays predictable.
function homographVariants(baseName, limit = MAX_HOMOGRAPH_VARIANTS) {
  const lower = String(baseName || '').toLowerCase();
  const out = new Set();
  for (let i = 0; i < lower.length && out.size < limit; i++) {
    for (const glyph of HOMOGLYPHS[lower[i]] || []) {
      out.add(lower.slice(0, i) + glyph + lower.slice(i + 1));
      if (out.size >= limit) break;
    }
  }
  let full = '';
  for (const ch of lower) full += HOMOGLYPHS[ch] ? HOMOGLYPHS[ch][0] : ch;
  if (full !== lower && out.size < limit) out.add(full);
  return [...out];
}

// Canonical DNS form (IDNA/punycode, lowercase) so a safe-listed unicode
// homograph matches its ASCII probe result and vice versa.
function canonicalDomain(domain) {
  const raw = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) return '';
  const ascii = domainToASCII(raw);
  return (ascii || raw).toLowerCase();
}

// Rebuild a scan summary against the completion-time safe list so the saved
// snapshot (records, counts, score, issues) agrees with what was persisted.
function sectionPenalty(section, record) {
  const type = (record && record.type) || '';
  if (section.key === 'typosquatting') {
    if (type === 'same_name' || type === 'same_name_with_email') return 25;
    if (type.endsWith('_with_email')) return 20;
    return section.penalty;
  }
  if (section.key === 'lookalikes' && record && record.hasMailServer) return 15;
  return section.penalty;
}

const SUMMARY_SECTIONS = [
  { key: 'typosquatting', cap: MAX_TYPO_RECORDS, penalty: 15, issue: 'typosquatting', severity: 'high', rec: 'Consider registering common typosquatting domains to prevent abuse' },
  { key: 'lookalikes', cap: MAX_LOOKALIKE_RECORDS, penalty: 10, issue: 'lookalike', severity: 'medium', rec: 'Monitor or register lookalike domains that could be used for phishing' },
  { key: 'impersonation', cap: Infinity, penalty: 5, issue: 'subdomain_abuse', severity: 'low' },
  { key: 'homographs', cap: 25, penalty: 12, issue: 'homograph', severity: 'high' },
];

function applySafeListToResult(result, safeList = []) {
  const safe = new Set(safeList.map(canonicalDomain).filter(Boolean));
  const detections = (result && result.detections) || {};
  const filtered = {};
  const seen = new Set();
  for (const section of SUMMARY_SECTIONS) {
    const source = detections[section.key] || (result && result[section.key]) || [];
    filtered[section.key] = source.filter((r) => {
      const domain = canonicalDomain(r && r.domain);
      if (domain && safe.has(domain)) return false;
      // One registration can match several generators (same-name typos,
      // lookalike affixes, homographs). Count it once, in the strongest
      // section listed first.
      if (domain && seen.has(domain)) return false;
      if (domain) seen.add(domain);
      return true;
    });
  }

  const out = { ...result };
  for (const section of SUMMARY_SECTIONS) {
    out[section.key] = filtered[section.key].slice(0, section.cap);
  }

  const knownIssues = new Set([...SUMMARY_SECTIONS.map((s) => s.issue), 'social_media']);
  const knownRecs = new Set(SUMMARY_SECTIONS.map((s) => s.rec).filter(Boolean));
  const priorIssues = (result && result.issues) || [];
  // Social media is display-capped by the probe; its issue carries the full
  // found count, so reuse that for the penalty instead of the visible slice.
  const priorSocial = priorIssues.find((i) => i && i.type === 'social_media');
  const socialCount = priorSocial ? Number(priorSocial.count) || 0 : ((result && result.socialMedia) || []).length;
  out.issues = priorIssues.filter((i) => !knownIssues.has(i && i.type));
  out.recommendations = ((result && result.recommendations) || []).filter((r) => !knownRecs.has(r));

  let score = 100;
  for (const section of SUMMARY_SECTIONS) {
    const count = filtered[section.key].length;
    if (count === 0) continue;
    // Severity weighting: an exact brand name or a mail-capable lookalike is
    // a stronger signal than a plain typo.
    score -= filtered[section.key].reduce((sum, record) => sum + sectionPenalty(section, record), 0);
    out.issues.push({ type: section.issue, count, severity: section.severity });
    if (section.rec) out.recommendations.push(section.rec);
  }
  score -= socialCount * 8;
  if (socialCount > 0) out.issues.push({ type: 'social_media', count: socialCount, severity: 'medium' });
  out.score = Math.max(0, Math.round(score));

  // New-threat metadata mirrors what persistence will write: drop only
  // safe-listed domains. Social-media entries have no persisted threat row,
  // so they must not be filtered out by section membership.
  const safeEntry = (entry) => !entry || !entry.domain || !safe.has(canonicalDomain(entry.domain));
  if (Array.isArray(out.newThreats)) out.newThreats = out.newThreats.filter(safeEntry);
  if (Array.isArray(out.alerts)) out.alerts = out.alerts.filter(safeEntry);
  return out;
}

function normalizeTldList(tlds) {
  if (!Array.isArray(tlds)) return SCAN_TLDS;
  const clean = [...new Set(tlds.map((t) => String(t || '').toLowerCase()).filter((t) => t && t.length <= 63))];
  return clean.length ? clean : SCAN_TLDS;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Pure typo generator (no DNS) — extracted so it can be unit-tested.
function typoVariants(baseName) {
  const variations = new Set();
  const keyboardAdjacent = {
    'a': ['q', 'w', 's', 'z'], 'b': ['v', 'g', 'h', 'n'], 'c': ['x', 'd', 'f', 'v'],
    'd': ['s', 'e', 'r', 'f', 'c', 'x'], 'e': ['w', 's', 'd', 'r'], 'f': ['d', 'r', 't', 'g', 'v', 'c'],
    'g': ['f', 't', 'y', 'h', 'b', 'v'], 'h': ['g', 'y', 'u', 'j', 'n', 'b'], 'i': ['u', 'j', 'k', 'o'],
    'j': ['h', 'u', 'i', 'k', 'm', 'n'], 'k': ['j', 'i', 'o', 'l', 'm'], 'l': ['k', 'o', 'p'],
    'm': ['n', 'j', 'k'], 'n': ['b', 'h', 'j', 'm'], 'o': ['i', 'k', 'l', 'p'], 'p': ['o', 'l'],
    'q': ['w', 'a'], 'r': ['e', 'd', 'f', 't'], 's': ['a', 'w', 'e', 'd', 'x', 'z'], 't': ['r', 'f', 'g', 'y'],
    'u': ['y', 'h', 'j', 'i'], 'v': ['c', 'f', 'g', 'b'], 'w': ['q', 'a', 's', 'e'],
    'x': ['z', 's', 'd', 'c'], 'y': ['t', 'g', 'h', 'u'], 'z': ['a', 's', 'x'],
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
  return variations;
}

class BrandProtectionService {
  constructor() {
    this.commonTLDs = SCAN_TLDS;
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

  async checkBrandProtection(mainDomain, previousResults = null, options = {}) {
    const baseName = mainDomain.split('.')[0];
    const scanTlds = normalizeTldList(options.tlds);
    const safeDomains = new Set((Array.isArray(options.safeList) ? options.safeList : []).map(canonicalDomain).filter(Boolean));
    const isSafe = (domain) => !safeDomains.has(canonicalDomain(domain));
    const detections = { typosquatting: [], lookalikes: [], impersonation: [], homographs: [] };
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

      results.tld_count = scanTlds.length;
      const steps = [
        { step: 'typosquatting', label: `Checking typosquatting across ${scanTlds.length} TLDs...` },
        { step: 'lookalikes', label: 'Checking lookalike domains...' },
        { step: 'subdomain_abuse', label: 'Checking subdomain abuse...' },
        { step: 'social_media', label: 'Checking social media variants...' },
        { step: 'homograph', label: 'Checking homograph attacks...' },
      ];
      const progressStart = results.progress.length;
      for (const step of steps) results.progress.push({ ...step, done: false, complete: false });

      // The probes are independent and DNS-bound; run them together so the
      // slowest one (typos across every TLD) sets the scan time instead of
      // the sum of all five.
      const [typos, lookalikes, subdomains, social, homographs] = await Promise.all([
        this.checkTypoSquats(baseName, mainDomain, scanTlds, isSafe),
        this.checkLookalikes(baseName, mainDomain, scanTlds, isSafe),
        this.checkSubdomainAbuse(mainDomain),
        this.checkSocialMedia(baseName, mainDomain),
        this.checkHomographs(baseName, mainDomain, scanTlds, isSafe),
      ]);

      results.typosquatting = typos.records;
      detections.typosquatting = typos.all || typos.records;
      results.lookalikes = lookalikes.records;
      detections.lookalikes = lookalikes.all || lookalikes.records;
      results.impersonation = subdomains.records;
      detections.impersonation = subdomains.all || subdomains.records;
      results.socialMedia = social.records;
      results.homographs = homographs.records;
      detections.homographs = homographs.all || homographs.records;
      for (let i = 0; i < steps.length; i++) {
        results.progress[progressStart + i].done = true;
        results.progress[progressStart + i].complete = true;
      }

      if (typos.found > 0) {
        results.score -= typos.found * 15;
        results.issues.push({ type: 'typosquatting', count: typos.found, severity: 'high' });
        results.recommendations.push('Consider registering common typosquatting domains to prevent abuse');
      }
      if (lookalikes.found > 0) {
        results.score -= lookalikes.found * 10;
        results.issues.push({ type: 'lookalike', count: lookalikes.found, severity: 'medium' });
        results.recommendations.push('Monitor or register lookalike domains that could be used for phishing');
      }
      if (subdomains.found > 0) {
        results.score -= subdomains.found * 5;
        results.issues.push({ type: 'subdomain_abuse', count: subdomains.found, severity: 'low' });
      }
      if (social.found > 0) {
        results.score -= social.found * 8;
        results.issues.push({ type: 'social_media', count: social.found, severity: 'medium' });
      }
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

    // Non-enumerable: available to the persistence transaction in-process,
    // never serialized into last_results/history payloads.
    Object.defineProperty(results, 'detections', { value: detections, enumerable: false });
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

  // One DNS contract for every similar-domain probe: A records mean a live
  // site, NS records mean the domain is registered even when nothing is
  // hosted yet (parking pages, pre-launch names), MX means it can receive
  // mail. Absence of all three means unregistered.
  async probeDomain(domain) {
    let ips = [];
    try {
      ips = await dns.resolve4(domain);
    } catch (e) {
      // ENOTFOUND = NXDOMAIN (unregistered). Empty answers and ENODATA mean
      // the name exists without an A record, which is where the NS fallback
      // (parked registrations) matters. Skipping the second query for the
      // millions of NXDOMAIN typos keeps a 238-TLD scan under a minute.
      if (e.code !== 'ENODATA') return null;
    }
    let nameservers = [];
    if (ips.length === 0) {
      try { nameservers = await dns.resolveNs(domain); } catch (e) { nameservers = []; }
    }
    if (ips.length === 0 && nameservers.length === 0) return null;
    let mx = [];
    try { mx = await dns.resolveMx(domain); } catch (e) { mx = []; }
    return { ips, nameservers, hasWebsite: ips.length > 0, hasMailServer: mx.length > 0 };
  }

  async checkTypoSquats(baseName, mainDomain, tlds = SCAN_TLDS, isSafe = () => true) {
    const { tldList, candidates } = typoProbeCandidates(baseName, mainDomain, tlds);

    const probes = await mapLimit(candidates, PROBE_CONCURRENCY, async ({ domain, tld: checkTld, sameName }) => {
      const probe = await this.probeDomain(domain);
      if (!probe) return null;
      const base = sameName ? 'same_name' : 'typosquat';
      return {
        domain,
        type: probe.hasMailServer ? `${base}_with_email` : base,
        tld: checkTld,
        status: 'registered',
        hasMailServer: probe.hasMailServer,
        hasWebsite: probe.hasWebsite,
        ips: probe.ips,
      };
    });

    const uniqueRecords = probes
      .filter(Boolean)
      .filter((r, i, arr) => arr.findIndex((x) => x.domain === r.domain) === i);
    const actionable = uniqueRecords.filter((r) => isSafe(r.domain));
    return {
      records: actionable.slice(0, MAX_TYPO_RECORDS),
      found: actionable.length,
      all: uniqueRecords.slice(0, MAX_DETECTIONS),
      tlds_checked: tldList.length,
    };
  }

  async checkLookalikes(baseName, mainDomain, tlds = SCAN_TLDS, isSafe = () => true) {
    const tld = mainDomain.split('.').slice(1).join('.') || 'com';
    const tldList = orderedTlds(tld, tlds);
    // Affixes that read as a service of the brand, not generic infra words
    // ('www', 'ftp', 'smtp' belong to the brand itself far more often than to
    // an attacker and only produced noise).
    const prefixes = ['mail', 'webmail', 'login', 'secure', 'account', 'admin', 'support', 'verify', 'signin', 'billing', 'portal'];
    const suffixes = ['mail', 'email', 'login', 'secure', 'account', 'support', 'verify', 'signin', 'billing', 'portal', 'official'];

    const candidates = [];
    for (const checkTld of tldList) {
      for (const prefix of prefixes) candidates.push({ domain: `${prefix}${baseName}.${checkTld}`, type: 'prefix' });
      for (const suffix of suffixes) candidates.push({ domain: `${baseName}${suffix}.${checkTld}`, type: 'suffix' });
      if (candidates.length >= MAX_LOOKALIKE_PROBES) break;
    }

    const hits = await mapLimit(candidates.slice(0, MAX_LOOKALIKE_PROBES), PROBE_CONCURRENCY, async ({ domain, type }) => {
      if (domain === mainDomain) return null;
      const probe = await this.probeDomain(domain);
      if (!probe) return null;
      return {
        domain,
        type,
        status: probe.hasWebsite ? 'exists' : 'registered',
        hasMailServer: probe.hasMailServer,
        hasWebsite: probe.hasWebsite,
      };
    });

    const all = hits.filter(Boolean).slice(0, MAX_DETECTIONS);
    const actionable = all.filter((r) => isSafe(r.domain));
    return { records: actionable.slice(0, MAX_LOOKALIKE_RECORDS), found: actionable.length, all };
  }

  async checkSubdomainAbuse(mainDomain) {
    const records = [];

    // Only explicit abuse terms: 'mail', 'smtp', 'webmail', 'admin', 'api'
    // and 'support' are normal brand infrastructure and produced false
    // positives. The old brand-name prefix loop was a second typo generator
    // and duplicated the typosquatting section, so it is gone.
    const suspiciousSubdomains = ['phishing', 'fake', 'verify', 'account', 'update', 'secure', 'login'];

    for (const sub of suspiciousSubdomains) {
      const domain = `${sub}.${mainDomain}`;
      try {
        const ips = await dns.resolve(domain);
        records.push({ domain, type: 'abused_subdomain', ips, status: 'active', hasWebsite: true });
      } catch (e) {}
    }

    return { records, found: records.length, all: records };
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

  async checkHomographs(baseName, mainDomain, tlds = SCAN_TLDS, isSafe = () => true) {
    const tld = mainDomain.split('.').slice(1).join('.') || 'com';
    const variants = homographVariants(baseName);
    if (variants.length === 0) return { records: [], found: 0, all: [] };

    const candidates = [];
    for (const variant of variants) {
      for (const checkTld of orderedTlds(tld, tlds)) {
        const unicodeDomain = `${variant}.${checkTld}`;
        const asciiDomain = domainToASCII(unicodeDomain);
        // domainToASCII returns '' for invalid IDNA; probing the raw unicode
        // label would just throw in the resolver.
        if (!asciiDomain || asciiDomain === unicodeDomain || asciiDomain === mainDomain) continue;
        candidates.push({ unicodeDomain, asciiDomain });
      }
    }

    const hits = await mapLimit(candidates, PROBE_CONCURRENCY, async ({ unicodeDomain, asciiDomain }) => {
      const probe = await this.probeDomain(asciiDomain);
      if (!probe) return null;
      return {
        domain: unicodeDomain,
        unicode: unicodeDomain,
        punycode: asciiDomain,
        type: 'homograph',
        status: 'registered',
        hasMailServer: probe.hasMailServer,
        hasWebsite: probe.hasWebsite,
        ips: probe.ips,
      };
    });

    const unique = hits.filter(Boolean).filter((r, i, arr) => arr.findIndex((x) => x.punycode === r.punycode) === i);
    const all = unique.slice(0, MAX_DETECTIONS);
    const actionable = all.filter((r) => isSafe(r.domain));
    return { records: actionable.slice(0, 25), found: actionable.length, all };
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

module.exports = { BrandProtectionService, SCAN_TLDS, orderedTlds, normalizeTldList, typoVariants, typoProbeCandidates, homographVariants, mapLimit, canonicalDomain, applySafeListToResult };