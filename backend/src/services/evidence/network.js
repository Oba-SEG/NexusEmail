const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function ipv4ToInt(address) {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inV4Block(address, base, bits) {
  const value = ipv4ToInt(address);
  const network = ipv4ToInt(base);
  if (value == null || network == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}

function mappedIpv4(value) {
  const dotted = value.match(/^(?:::ffff:|(?:0:){5}ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = value.match(/^(?:::ffff:|(?:0:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateIp(address) {
  const value = String(address || '').trim().toLowerCase().split('%')[0];
  if (!value) return true;
  const family = net.isIP(value);
  if (family === 4) return BLOCKED_V4.some(([base, bits]) => inV4Block(value, base, bits));
  if (family !== 6) return true;
  const mapped = mappedIpv4(value);
  if (mapped) return isPrivateIp(mapped);
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (/^fe[c-f]/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8')) return true;
  if (/^2001:0{1,4}:/.test(value)) return true;
  if (value.startsWith('64:ff9b')) return true;
  if (value.startsWith('2002:')) return true;
  if (/^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(value)) return true;
  return false;
}

function validateTargetUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(String(input));
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Only ports 80 and 443 are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new Error('URL host is required');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private hostnames are not allowed');
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private addresses are not allowed');
  return url;
}

async function resolveSafeTarget(input) {
  const url = validateTargetUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  }
  if (!addresses || addresses.length === 0) throw new Error('Host did not resolve');
  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) throw new Error('Host resolves to a private address');
  }
  return { url, address: addresses[0].address, family: addresses[0].family, addresses };
}

function requestOnce(target, options = {}) {
  const maxBytes = options.maxBytes || 512 * 1024;
  const timeoutMs = options.timeoutMs || 10000;
  const transport = target.url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
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
    const request = transport.request({
      protocol: target.url.protocol,
      hostname: target.url.hostname.replace(/^\[|\]$/g, ''),
      port: target.url.port || undefined,
      path: `${target.url.pathname || '/'}${target.url.search || ''}`,
      method: options.method || 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-encoding': 'identity',
        'user-agent': options.userAgent || 'NexusBrandProtection/1.0 (+https://brandprotection.segbytes.xyz)',
        ...(options.headers || {}),
      },
      lookup: (hostname, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) {
          callback(null, [{ address: target.address, family: target.family }]);
          return;
        }
        callback(null, target.address, target.family);
      },
      servername: target.url.hostname.replace(/^\[|\]$/g, ''),
      rejectUnauthorized: options.allowInvalidTls ? false : true,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      let truncated = false;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          truncated = true;
          response.destroy();
          finish({
            statusCode: response.statusCode,
            headers: response.headers,
            bodyBuffer: Buffer.concat(chunks),
            bytes,
            truncated,
          });
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish({
        statusCode: response.statusCode,
        headers: response.headers,
        bodyBuffer: Buffer.concat(chunks),
        bytes,
        truncated,
      }));
      response.on('error', fail);
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', fail);
    request.end(options.body || undefined);
  });
}

async function safeFetch(input, options = {}) {
  let current = validateTargetUrl(input);
  const redirects = [];
  const maxRedirects = options.maxRedirects ?? 5;
  for (let index = 0; index <= maxRedirects; index += 1) {
    const target = await resolveSafeTarget(current);
    const result = await requestOnce(target, options);
    const location = result.headers && result.headers.location;
    if (location && [301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (index === maxRedirects) throw new Error('Too many redirects');
      const next = new URL(location, current).toString();
      validateTargetUrl(next);
      redirects.push({ from: current.toString(), to: next, status: result.statusCode });
      current = new URL(next);
      continue;
    }
    return { ...result, finalUrl: current.toString(), redirects };
  }
  throw new Error('Too many redirects');
}

module.exports = { isPrivateIp, validateTargetUrl, resolveSafeTarget, safeFetch };
