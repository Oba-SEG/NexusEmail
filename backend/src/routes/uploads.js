'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { putArtifact } = require('../services/evidence/storage');
const { uploadKind } = require('../services/ai/gaps');
const { MAX_BYTES, validateUpload } = require('../services/uploads/validate');

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads; try again later' },
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/:token', uploadLimiter, async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(404).json({ error: 'Upload request not found' });
    const request = await db.getUploadRequestByTokenHash(hashToken(token));
    if (!request) return res.status(404).json({ error: 'Upload request not found' });
    if (request.org_id !== req.orgId) return res.status(403).json({ error: 'Upload request does not belong to this organization' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Upload request is no longer pending' });
    if (Date.parse(request.expires_at) <= Date.now()) return res.status(410).json({ error: 'Upload request has expired' });

    const { item, filename, mime, data_base64 } = req.body || {};
    const definition = request.items.find((entry) => entry.key === item);
    if (!definition) return res.status(400).json({ error: 'Unknown evidence item' });
    if (typeof data_base64 !== 'string' || !data_base64.trim()) return res.status(400).json({ error: 'File data is required' });
    const encoded = data_base64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return res.status(400).json({ error: 'File data is not valid base64' });
    if (encoded.length > Math.ceil(MAX_BYTES * 4 / 3) + 4) return res.status(413).json({ error: 'File is too large' });
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'File is empty' });
    if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
      return res.status(400).json({ error: 'File data is not valid base64' });
    }

    const checked = await validateUpload({
      buffer,
      filename,
      declaredMime: mime,
      acceptedMime: definition.accepted_mime,
    });

    const stored = await putArtifact({
      orgId: request.org_id,
      brandId: request.brand_id,
      threatId: request.threat_id,
      kind: uploadKind(item),
      buffer,
      mime: checked.mime,
    });
    const retentionDays = Math.max(1, Number(process.env.EVIDENCE_RETENTION_DAYS) || 365);
    const artifact = await db.addEvidenceArtifact({
      org_id: request.org_id,
      brand_id: request.brand_id,
      threat_id: request.threat_id,
      kind: uploadKind(item),
      status: 'ok',
      source_url: null,
      storage_key: stored.storage_key,
      mime: checked.mime,
      bytes: stored.bytes,
      sha256: stored.sha256,
      collector: 'upload',
      collector_version: '1',
      metadata: {
        request_id: request.id,
        item,
        label: definition.label,
        original_filename: checked.filename,
        scan: checked.scan,
      },
      visibility: 'user',
      collected_at: new Date().toISOString(),
      retention_expires_at: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
    });

    const artifacts = await db.getEvidenceArtifacts(request.threat_id, request.org_id);
    const kinds = new Set(artifacts.map((entry) => entry.kind));
    const fulfilled = request.items.every((entry) => kinds.has(uploadKind(entry.key)));
    if (fulfilled) {
      await db.updateUploadRequest(request.id, request.org_id, {
        status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
      });
      await db.enqueueJob({
        type: 'threat.assess',
        payload: { orgId: request.org_id, brandId: request.brand_id, threatId: request.threat_id },
        dedupeKey: `threat.assess:${request.threat_id}`,
      }).catch((error) => {
        console.warn(`[jobs] failed to queue assessment after uploads for threat ${request.threat_id}:`, error.message);
      });
    }

    res.status(201).json({
      success: true,
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        status: artifact.status,
        mime: artifact.mime,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      },
      request_status: fulfilled ? 'fulfilled' : 'pending',
    });
  } catch (error) {
    if (error && error.status && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
