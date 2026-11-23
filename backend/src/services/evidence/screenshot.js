const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { validateTargetUrl, safeFetch } = require('./network');

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

function positiveInt(value, fallback, max = 4096) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.floor(parsed)) : fallback;
}

function baseArtifact(extra) {
  return { kind: 'screenshot', collector: 'screenshot', collector_version: '1', ...extra };
}

async function readLimited(response, maxBytes) {
  if (!response.body) throw new Error('screenshot service returned no body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('screenshot exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function captureViaService(targetUrl) {
  const endpoint = new URL(process.env.SCREENSHOT_SERVICE_URL);
  const token = process.env.SCREENSHOT_SERVICE_TOKEN;
  if (token && endpoint.protocol !== 'https:') {
    throw new Error('SCREENSHOT_SERVICE_URL must use HTTPS when SCREENSHOT_SERVICE_TOKEN is set');
  }
  endpoint.searchParams.set('url', targetUrl);
  const serviceWidth = positiveInt(process.env.SCREENSHOT_SERVICE_WIDTH, 1280);
  const serviceHeight = positiveInt(process.env.SCREENSHOT_SERVICE_HEIGHT, 720);
  endpoint.searchParams.set('width', String(serviceWidth));
  endpoint.searchParams.set('height', String(serviceHeight));
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`screenshot service returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_SCREENSHOT_BYTES) throw new Error('screenshot exceeds size limit');
  const buffer = await readLimited(response, MAX_SCREENSHOT_BYTES);
  if (buffer.length === 0) throw new Error('screenshot service returned an empty body');
  const mime = String(response.headers.get('content-type') || 'image/png').split(';')[0];
  if (!mime.startsWith('image/')) throw new Error('screenshot service did not return an image');
  return baseArtifact({
    status: 'ok',
    source_url: targetUrl,
    mime,
    bytes: buffer,
    metadata: { engine: 'service', service: endpoint.origin, width: serviceWidth, height: serviceHeight },
  });
}

async function captureViaChrome(targetUrl, chromeBin) {
  // Chrome follows redirects itself and cannot be told to re-check each hop,
  // so walk the chain with the SSRF-safe fetcher first. Any private or
  // blocked hop aborts the capture. Residual risk is a DNS change between
  // this check and Chrome's own resolution, which is why local capture stays
  // opt-in behind SCREENSHOT_ALLOW_LOCAL=1 and off in every shipped config.
  await safeFetch(targetUrl, { maxRedirects: 5, maxBytes: 1024, timeoutMs: 10000, totalTimeoutMs: 15000 });
  const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexus-evidence-'));
  const outputPath = path.join(profileDir, 'screenshot.png');
  const width = positiveInt(process.env.SCREENSHOT_WIDTH, 1280);
  const height = positiveInt(process.env.SCREENSHOT_HEIGHT, 720);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-sync',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=5000',
    '--run-all-compositor-stages-before-draw',
    `--screenshot=${outputPath}`,
  ];
  if (process.env.SCREENSHOT_NO_SANDBOX === '1') args.push('--no-sandbox');
  args.push(targetUrl);
  try {
    await new Promise((resolve, reject) => {
      execFile(chromeBin, args, {
        timeout: positiveInt(process.env.SCREENSHOT_TIMEOUT_MS, 25000, 120000),
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}${stderr ? `: ${String(stderr).slice(0, 500)}` : ''}`;
          reject(error);
          return;
        }
        resolve();
      });
    });
    const buffer = await fs.promises.readFile(outputPath);
    if (buffer.length === 0) throw new Error('Chrome produced an empty screenshot');
    if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error('screenshot exceeds size limit');
    return baseArtifact({
      status: 'ok',
      source_url: targetUrl,
      mime: 'image/png',
      bytes: buffer,
      metadata: { engine: 'chrome-headless', width, height },
    });
  } finally {
    await fs.promises.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function captureScreenshot(targetUrl, options = {}) {
  const target = validateTargetUrl(targetUrl);
  if (process.env.SCREENSHOT_SERVICE_URL) return captureViaService(target.toString());
  const chromeBin = process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  if (!chromeBin) {
    return baseArtifact({ status: 'skipped', metadata: { reason: 'screenshot collector is not configured' } });
  }
  if (process.env.SCREENSHOT_ALLOW_LOCAL !== '1') {
    return baseArtifact({ status: 'skipped', metadata: { reason: 'local screenshot disabled; set SCREENSHOT_ALLOW_LOCAL=1' } });
  }
  return captureViaChrome(target.toString(), chromeBin);
}

module.exports = { captureScreenshot };
