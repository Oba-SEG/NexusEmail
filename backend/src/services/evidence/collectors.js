const crypto = require('crypto');
const dns = require('dns').promises;
const tls = require('tls');
const { URL } = require('url');
const { validateTargetUrl, resolveSafeTarget, safeFetch } = require('./network');
const { captureScreenshot } = require('./screenshot');

function errorMessage(error) {
  return error && (error.code || error.message) ? String(error.code || error.message) : 'unknown error';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function threatDomain(threat) {
  return String(threat.canonical_domain || threat.domain || '').trim().toLowerCase().replace(/\.$/, '');
}

function threatTarget(threat) {
  const raw = String(threat.threat_url || threat.domain || '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return validateTargetUrl(withScheme);
  } catch {
    return null;
  }
}

function safeDomain(domain) {
  try {
    validateTargetUrl(`https://${domain}`);
    return true;
  } catch {
    return false;
  }
}

function skipped(kind, reason, metadata = {}) {
  return { kind, status: 'skipped', metadata: { reason, ...metadata }, collector: kind, collector_version: '1' };
}

function failed(kind, error, metadata = {}) {
  return { kind, status: 'failed', metadata: { error: errorMessage(error), ...metadata }, collector: kind, collector_version: '1' };
}

async function collectDns(threat) {
  const domain = threatDomain(threat);
  if (!domain) return skipped('dns', 'missing domain');
  if (!safeDomain(domain)) return skipped('dns', 'domain not allowed', { domain });
  const lookups = {
    a: () => dns.resolve4(domain, { ttl: true }),
    aaaa: () => dns.resolve6(domain, { ttl: true }),
    cname: () => dns.resolveCname(domain),
    mx: () => dns.resolveMx(domain),
    ns: () => dns.resolveNs(domain),
    txt: () => dns.resolveTxt(domain),
  };
  const records = {};
  const errors = [];
  let ok = 0;
  await Promise.all(Object.entries(lookups).map(async ([key, lookup]) => {
    try {
      records[key] = await withTimeout(lookup(), 4000, `dns ${key}`);
      ok += 1;
    } catch (error) {
      records[key] = null;
      if (error.code !== 'ENODATA') errors.push({ record: key, error: errorMessage(error) });
    }
  }));
  const status = ok === 0 ? 'failed' : (errors.length > 0 ? 'partial' : 'ok');
  return {
    kind: 'dns',
    status,
    mime: 'application/json',
    collector: 'dns',
    collector_version: '1',
    metadata: { domain, records, errors },
  };
}

function summarizeRdap(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    handle: data.handle || null,
    ldhName: data.ldhName || null,
    status: data.status || null,
    events: Array.isArray(data.events) ? data.events.slice(0, 20) : [],
    nameservers: Array.isArray(data.nameservers) ? data.nameservers.map((item) => item.ldhName).filter(Boolean) : [],
    entities: Array.isArray(data.entities) ? data.entities.slice(0, 20).map((entity) => ({ handle: entity.handle || null, roles: entity.roles || [] })) : [],
  };
}

async function collectRdap(threat) {
  const domain = threatDomain(threat);
  if (!domain) return skipped('rdap', 'missing domain');
  if (!safeDomain(domain)) return skipped('rdap', 'domain not allowed', { domain });
  const source = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    const response = await safeFetch(source, { timeoutMs: 10000, maxBytes: 512 * 1024 });
    const body = response.bodyBuffer;
    let data = null;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch {
      data = null;
    }
    const ok = response.statusCode >= 200 && response.statusCode < 300 && data;
    return {
      kind: 'rdap',
      status: ok ? 'ok' : 'partial',
      source_url: response.finalUrl,
      mime: 'application/json',
      bytes: body,
      sha256: sha256(body),
      collector: 'rdap',
      collector_version: '1',
      metadata: {
        http_status: response.statusCode,
        redirects: response.redirects,
        truncated: response.truncated,
        data: summarizeRdap(data),
      },
    };
  } catch (error) {
    return failed('rdap', error, { source_url: source });
  }
}

function htmlSignals(buffer, mime) {
  if (!String(mime || '').includes('html')) return {};
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 200 * 1024));
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || null;
  return {
    title: title || null,
    forms: (text.match(/<form\b/gi) || []).length,
    login_form: /<input[^>]+type\s*=\s*["']?password/i.test(text),
    payment_form: /(cardnumber|card-number|cc-number|creditcard|credit-card|payment)/i.test(text),
  };
}

async function collectHttp(threat) {
  const target = threatTarget(threat);
  if (!target) return skipped('http', 'missing or invalid URL');
  try {
    const response = await safeFetch(target.toString(), { timeoutMs: 12000, maxBytes: 512 * 1024 });
    const headers = response.headers || {};
    const mime = String(headers['content-type'] || 'application/octet-stream').split(';')[0];
    const summary = {};
    for (const key of ['content-type', 'server', 'location', 'content-length', 'last-modified', 'cf-ray']) {
      if (headers[key] != null) summary[key] = headers[key];
    }
    return {
      kind: 'http',
      status: 'ok',
      source_url: response.finalUrl,
      mime,
      bytes: response.bodyBuffer,
      sha256: sha256(response.bodyBuffer),
      collector: 'http',
      collector_version: '1',
      metadata: {
        http_status: response.statusCode,
        headers: summary,
        redirects: response.redirects,
        truncated: response.truncated,
        ...htmlSignals(response.bodyBuffer, mime),
      },
    };
  } catch (error) {
    return failed('http', error, { source_url: target.toString() });
  }
}

async function collectTls(threat) {
  const target = threatTarget(threat);
  if (!target) return skipped('tls', 'missing or invalid URL');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  try {
    const resolved = await resolveSafeTarget(target);
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const socket = tls.connect({
        host: resolved.address,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 8000,
      }, () => {
        const certificate = socket.getPeerCertificate(true);
        const cipher = socket.getCipher();
        finish({
          kind: 'tls',
          status: certificate && Object.keys(certificate).length > 0 ? 'ok' : 'partial',
          collector: 'tls',
          collector_version: '1',
          metadata: {
            host,
            port: 443,
            authorized: socket.authorized,
            authorization_error: socket.authorizationError || null,
            protocol: socket.getProtocol(),
            cipher: cipher ? { name: cipher.name, version: cipher.version } : null,
            alpn: socket.alpnProtocol || null,
            subject: certificate && certificate.subject ? certificate.subject : null,
            issuer: certificate && certificate.issuer ? certificate.issuer : null,
            valid_from: certificate && certificate.valid_from ? certificate.valid_from : null,
            valid_to: certificate && certificate.valid_to ? certificate.valid_to : null,
            fingerprint256: certificate && certificate.fingerprint256 ? certificate.fingerprint256 : null,
            serial_number: certificate && certificate.serialNumber ? certificate.serialNumber : null,
          },
        });
        socket.end();
      });
      socket.on('timeout', () => {
        socket.destroy();
        fail(new Error('TLS connection timed out'));
      });
      socket.on('error', fail);
    });
    return result;
  } catch (error) {
    return failed('tls', error, { host });
  }
}

async function collectScreenshot(threat) {
  const target = threatTarget(threat);
  if (!target) return skipped('screenshot', 'missing or invalid URL');
  try {
    return await captureScreenshot(target.toString(), { threat });
  } catch (error) {
    return failed('screenshot', error, { source_url: target.toString() });
  }
}

const COLLECTORS = [
  ['dns', collectDns],
  ['rdap', collectRdap],
  ['http', collectHttp],
  ['tls', collectTls],
  ['screenshot', collectScreenshot],
];

async function collectEvidence(threat) {
  const results = await Promise.all(COLLECTORS.map(async ([kind, collector]) => {
    try {
      return await collector(threat);
    } catch (error) {
      return failed(kind, error);
    }
  }));
  return results;
}

module.exports = { collectEvidence, collectDns, collectRdap, collectHttp, collectTls, collectScreenshot, sha256 };
