const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateUpload, detectMime } = require('../src/services/uploads/validate');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const EICAR = Buffer.from('%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const EML = Buffer.from('From: attacker@example.com\r\nSubject: Verify your account\r\n\r\nClick here');

describe('upload content validation', () => {
  test('detects supported types by magic bytes', () => {
    assert.equal(detectMime(PNG, 'image/png', 'shot.png'), 'image/png');
    assert.equal(detectMime(PDF, 'application/pdf', 'cert.pdf'), 'application/pdf');
    assert.equal(detectMime(EML, 'application/octet-stream', 'phish.eml'), 'message/rfc822');
  });

  test('accepts a PNG for a screenshot slot', async () => {
    const result = await validateUpload({
      buffer: PNG,
      filename: 'screenshot.png',
      declaredMime: 'image/png',
      acceptedMime: ['image/png', 'image/jpeg', 'application/pdf'],
    });
    assert.equal(result.mime, 'image/png');
    assert.equal(result.scan.clean, true);
  });

  test('rejects content that lies about its type', async () => {
    await assert.rejects(
      validateUpload({ buffer: PDF, filename: 'x.png', declaredMime: 'image/png', acceptedMime: ['image/png'] }),
      /does not match/
    );
    await assert.rejects(
      validateUpload({ buffer: PNG, filename: 'x.png', declaredMime: 'image/png', acceptedMime: ['application/pdf'] }),
      /not accepted/
    );
    await assert.rejects(
      validateUpload({ buffer: Buffer.from('<svg><script/></svg>'), filename: 'x.svg', declaredMime: 'image/svg+xml' }),
      /Unsupported/
    );
    await assert.rejects(
      validateUpload({ buffer: Buffer.from('not an image'), filename: 'x.png', declaredMime: 'image/png', acceptedMime: ['image/png'] }),
      /Unsupported/
    );
  });

  test('rejects EICAR and active PDF content', async () => {
    await assert.rejects(
      validateUpload({ buffer: EICAR, filename: 'invoice.pdf', declaredMime: 'application/pdf', acceptedMime: ['application/pdf'] }),
      (error) => error.status === 422 && /malware/.test(error.message)
    );
    await assert.rejects(
      validateUpload({ buffer: Buffer.from('%PDF-1.7\n/OpenAction 1 0 R\n'), filename: 'x.pdf', declaredMime: 'application/pdf', acceptedMime: ['application/pdf'] }),
      /Active content/
    );
  });

  test('fails closed when a configured scanner is unavailable', async () => {
    process.env.UPLOAD_SCANNER_URL = 'http://127.0.0.1:1/scan';
    try {
      await assert.rejects(
        validateUpload({ buffer: PNG, filename: 'x.png', declaredMime: 'image/png', acceptedMime: ['image/png'] }),
        (error) => error.status === 503
      );
    } finally {
      delete process.env.UPLOAD_SCANNER_URL;
    }
  });
});
