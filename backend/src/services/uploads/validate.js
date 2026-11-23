'use strict';

const path = require('path');

const MAX_BYTES = Math.max(1024, Number(process.env.UPLOAD_MAX_BYTES) || 25 * 1024 * 1024);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'message/rfc822',
  'application/vnd.ms-outlook',
]);

function normalizeMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function detectMime(buffer, declared, filename) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'application/vnd.ms-outlook';
  const head = buffer.subarray(0, 4096).toString('utf8');
  if (/^(from|received|return-path|subject|date|mime-version):/im.test(head)) return 'message/rfc822';
  // Never trust a filename or a client-declared type: without a magic/header
  // match the upload is unsupported, even if it is named `.pdf` or `.png`.
  return null;
}

function scanForMalware(buffer, mime, filename) {
  const text = buffer.toString('latin1');
  if (text.includes(EICAR)) throw Object.assign(new Error('Upload rejected by malware scan'), { status: 422 });
  if (mime === 'application/pdf') {
    const head = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('latin1');
    if (/\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/.test(head)) {
      throw Object.assign(new Error('Active content in PDF uploads is not allowed'), { status: 422 });
    }
  }
  if (mime === 'message/rfc822' || mime === 'application/vnd.ms-outlook') {
    if (buffer.length > MAX_BYTES) throw Object.assign(new Error('Upload is too large'), { status: 400 });
  }
  return { filename: path.basename(String(filename || 'upload')).replace(/[^\w.\- ]/g, '_').slice(0, 200), mime };
}

async function externalScan(buffer, mime, filename) {
  const url = process.env.UPLOAD_SCANNER_URL;
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': mime,
        'x-filename': filename,
        ...(process.env.UPLOAD_SCANNER_TOKEN ? { authorization: `Bearer ${process.env.UPLOAD_SCANNER_TOKEN}` } : {}),
      },
      body: buffer,
    });
    if (!response.ok) throw new Error(`scanner returned ${response.status}`);
    const result = await response.json().catch(() => null);
    if (!result || result.clean !== true) {
      throw Object.assign(new Error('Upload rejected by malware scan'), { status: 422 });
    }
    return { scanner: 'external', clean: true };
  } catch (error) {
    if (error.status === 422) throw error;
    throw Object.assign(new Error('Upload scanner is unavailable; try again later'), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

async function validateUpload({ buffer, filename, declaredMime, acceptedMime }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error('File is empty'), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error(`File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit`), { status: 413 });
  }
  const declared = normalizeMime(declaredMime);
  const detected = detectMime(buffer, declared, filename);
  if (!ALLOWED_MIME.has(detected)) {
    throw Object.assign(new Error('Unsupported file type'), { status: 400 });
  }
  if (declared && !GENERIC_MIME.has(declared) && declared !== detected) {
    throw Object.assign(new Error('File content does not match its declared type'), { status: 400 });
  }
  const accepted = Array.isArray(acceptedMime) && acceptedMime.length ? new Set(acceptedMime) : null;
  if (accepted && !accepted.has(detected)) {
    throw Object.assign(new Error('File type is not accepted for this evidence item'), { status: 400 });
  }

  const scanned = scanForMalware(buffer, detected, filename);
  const external = await externalScan(buffer, detected, scanned.filename);
  return { mime: detected, filename: scanned.filename, scan: external || { scanner: 'builtin', clean: true } };
}

module.exports = { MAX_BYTES, validateUpload, detectMime };
