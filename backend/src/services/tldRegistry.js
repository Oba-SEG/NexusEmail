const db = require('../db/database');
const { SCAN_TLDS } = require('./brandProtection');

// Domains.co.za reseller API (v3 key auth). There is no dedicated "list
// TLDs" call in v3, but /domain/domain/checkTlds without a `tlds` filter
// checks a single SLD against every TLD the account can register — its
// response keys are therefore the account's full supported-TLD universe.
// One call takes ~1-2 minutes, so the list is cached for a day and refreshed
// in the background; scans always get a list immediately.
const API_BASE = 'https://api-v3.domains.co.za/api';
const CACHE_KEY = 'domainscoza_tlds';
const API_KEY_SETTING = 'domainscoza_api_key';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 180000;
const PROBE_SLD = 'nexusemailtldprobe';

const TLD_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

let memory = { orgId: null, tlds: null, at: 0 };
const inflight = new Map();

function cleanTlds(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(
    list
      .map((t) => String(t || '').trim().toLowerCase())
      .filter((t) => t && t.length <= 63 && TLD_RE.test(t)),
  )];
}

// Pure parser for the checkTlds response, exported for tests.
function parseTldResponse(payload) {
  const arr = payload && payload.arrTLDs;
  if (!arr || typeof arr !== 'object' || Array.isArray(arr)) return [];
  return cleanTlds(Object.keys(arr));
}

async function apiKeyFor(orgId) {
  const fromEnv = String(process.env.DOMAINSCOZA_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const fromSettings = String((await db.getSetting(API_KEY_SETTING, orgId)) || '').trim();
  return fromSettings || null;
}

async function fetchTlds(apiKey) {
  const response = await fetch(`${API_BASE}/domain/domain/checkTlds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: apiKey, sld: PROBE_SLD }).toString(),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Domains.co.za TLD API returned HTTP ${response.status}`);
  const data = await response.json();
  if (Number(data && data.intReturnCode) !== 1) {
    throw new Error(`Domains.co.za TLD API error: ${(data && (data.strMessage || data.strReason)) || 'unknown'}`);
  }
  const tlds = parseTldResponse(data);
  if (tlds.length < 10) throw new Error('Domains.co.za TLD API returned an implausibly small TLD list');
  return tlds;
}

function refreshTlds(orgId) {
  if (inflight.has(orgId)) return inflight.get(orgId);
  const job = (async () => {
    try {
      const apiKey = await apiKeyFor(orgId);
      if (!apiKey) throw new Error('no Domains.co.za API key configured');
      const tlds = await fetchTlds(apiKey);
      const at = Date.now();
      await db.setSetting(CACHE_KEY, JSON.stringify({ tlds, fetched_at: at }), orgId);
      memory = { orgId, tlds, at };
      return tlds;
    } finally {
      inflight.delete(orgId);
    }
  })();
  inflight.set(orgId, job);
  return job;
}

// Returns the TLD universe to scan. Never throws: stale cache first, then
// (blocking only when no cache exists) the API, then the bundled fallback.
async function getScanTlds(orgId) {
  const now = Date.now();
  if (memory.orgId === orgId && memory.tlds && now - memory.at < CACHE_TTL_MS) {
    return memory.tlds;
  }

  let cached = null;
  try {
    cached = JSON.parse((await db.getSetting(CACHE_KEY, orgId)) || 'null');
  } catch (e) {
    cached = null;
  }
  const cachedTlds = cleanTlds(cached && cached.tlds);
  const fetchedAt = Number(cached && cached.fetched_at) || 0;

  if (cachedTlds.length && now - fetchedAt < CACHE_TTL_MS) {
    memory = { orgId, tlds: cachedTlds, at: fetchedAt };
    return cachedTlds;
  }
  if (cachedTlds.length && now - fetchedAt < CACHE_STALE_MS) {
    refreshTlds(orgId).catch((err) => {
      console.warn('[tldRegistry] background TLD refresh failed:', err.message);
    });
    memory = { orgId, tlds: cachedTlds, at: now };
    return cachedTlds;
  }

  try {
    return await refreshTlds(orgId);
  } catch (err) {
    console.warn('[tldRegistry] using fallback TLD list:', err.message);
  }
  return cachedTlds.length ? cachedTlds : SCAN_TLDS;
}

module.exports = { getScanTlds, refreshTlds, parseTldResponse, cleanTlds, CACHE_KEY };
