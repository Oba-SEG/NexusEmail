const express = require('express');
const path = require('path');
const router = express.Router();
const { BrandProtectionService, canonicalDomain } = require('../services/brandProtection');
const { performBrandScan, nextScanFor, ALLOWED_SCHEDULES } = require('../services/brandScan');
const db = require('../db/database');
const { readArtifact } = require('../services/evidence/storage');
const { tokenHash, uploadToken, requestExpiry } = require('../services/ai/assessment');
const { uploadKind } = require('../services/ai/gaps');
const { captureException } = require('../capture');

const brandService = new BrandProtectionService();

// T162 — Brand Protection routes now use the relational tables (brands /
// brand_threats / brand_takedowns / brand_takedown_replies /
// brand_safe_entries / brand_alerts) added in this same change.
//
// API response shape is preserved: each brand object still contains nested
// threats[], takedowns[] (with replies[]), and safe_list[], so the frontend
// doesn't need to change. Hydration happens server-side via getBrandFull /
// getBrandsFull, which join the relational tables.

router.get('/settings', async (req, res, next) => {
  try {
    res.json({
      reply_to: await db.getSetting('brand_protection_reply_to', req.orgId) || 'legal@yourcompany.com'
    });
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const { reply_to } = req.body;
    if (reply_to) {
      await db.setSetting('brand_protection_reply_to', reply_to, req.orgId);
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    res.json(await db.getBrandsFull(req.orgId));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { domain, brand_name, scan_schedule } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    if (scan_schedule !== undefined && !ALLOWED_SCHEDULES.includes(scan_schedule)) {
      return res.status(400).json({ error: `Invalid scan schedule. Allowed: ${ALLOWED_SCHEDULES.join(', ')}.` });
    }
    const schedule = scan_schedule || 'daily';
    const created = await db.addBrand({
      domain,
      brand_name,
      scan_schedule: schedule,
      next_scan: nextScanFor(schedule),
    }, req.orgId);
    res.json({ success: true, ...created, threats: [], takedowns: [], safe_list: [] });
  } catch (err) { next(err); }
});

router.post('/scan/all', async (req, res, next) => {
  try {
    const brands = await db.getBrands(req.orgId);
    const results = [];

    for (const brand of brands) {
      try {
        const result = await performBrandScan(brand, req.orgId);
        result.brand_id = brand.id;
        results.push(result);
      } catch (e) {
        captureException(e);
        results.push({ domain: brand.domain, error: e.message, brand_id: brand.id });
      }
    }

    res.json({ scanned: brands.length, results });
  } catch (err) { next(err); }
});

router.post('/check/:id', async (req, res, next) => {
  try {
    const brand = await db.getBrand(parseInt(req.params.id), req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const result = await performBrandScan(brand, req.orgId);
    if (result.skipped === 'already_running' || result.skipped === 'claim_lost') {
      return res.status(409).json({ error: 'A scan is already running for this brand — try again in a moment.' });
    }
    if (result.skipped === 'inactive' || result.skipped === 'deleted') {
      return res.status(409).json({ error: 'This brand is not active.' });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// Alerts routes (must be before /:id)
router.get('/alerts', async (req, res, next) => {
  try {
    res.json(await db.getBrandAlerts(req.orgId, 50));
  } catch (err) { next(err); }
});

router.delete('/alerts/:alertId', async (req, res, next) => {
  try {
    await db.deleteBrandAlert(parseInt(req.params.alertId), req.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/alerts/clear', async (req, res, next) => {
  try {
    await db.clearBrandAlerts(req.orgId);
    res.json({ success: true, message: 'All alerts cleared' });
  } catch (err) { next(err); }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const brand = await db.getBrand(parseInt(req.params.id), req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const scans = await db.getBrandScans(brand.id, 20, req.orgId);
    res.json(scans.map((s) => ({
      id: s.id,
      scanned_at: s.scanned_at,
      score: s.score,
      tld_count: s.tld_count || null,
      typosquatting: (s.typosquatting || []).length,
      lookalikes: (s.lookalikes || []).length,
      impersonation: (s.impersonation || []).length,
      homographs: (s.homographs || []).length,
      social_media: (s.socialMedia || []).length,
    })));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const brand = await db.getBrandFull(parseInt(req.params.id), req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    res.json(brand);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { scan_schedule, alerts_enabled, brand_name } = req.body;
    if (scan_schedule !== undefined && !ALLOWED_SCHEDULES.includes(scan_schedule)) {
      return res.status(400).json({ error: `Invalid scan schedule. Allowed: ${ALLOWED_SCHEDULES.join(', ')}.` });
    }
    const updates = {};
    if (scan_schedule !== undefined) updates.scan_schedule = scan_schedule;
    if (alerts_enabled !== undefined) updates.alerts_enabled = alerts_enabled;
    if (brand_name) updates.brand_name = brand_name;

    if (scan_schedule !== undefined) {
      updates.next_scan = scan_schedule === 'manual' ? null : nextScanFor(scan_schedule);
    }

    const updated = await db.updateBrand(parseInt(req.params.id), updates, req.orgId);
    if (!updated) return res.status(404).json({ error: 'Brand not found' });
    res.json({ success: true, ...updated });
  } catch (err) { next(err); }
});

router.post('/:id/safe', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    // Canonical (IDNA) form: scan threats are stored canonically, so a
    // unicode submission must match the same key.
    const normalized = canonicalDomain(req.body.domain);
    if (!normalized) return res.status(400).json({ error: 'Domain is required' });
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    await db.addSafeEntry(brandId, normalized, req.orgId);
    // Purge by canonical comparison so legacy non-canonical rows match too.
    const threats = await db.getBrandThreats(brandId, req.orgId);
    for (const threat of threats) {
      if (canonicalDomain(threat.domain) === normalized) {
        await db.deleteBrandThreatByDomain(brandId, threat.domain, req.orgId);
      }
    }

    res.json({ success: true, message: `Added ${normalized} to safe list` });
  } catch (err) { next(err); }
});

router.delete('/:id/safe', async (req, res, next) => {
  try {
    const normalized = canonicalDomain(req.body.domain);
    if (!normalized) return res.status(400).json({ error: 'Domain is required' });
    const brandId = parseInt(req.params.id);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    // Remove every stored spelling that matches canonically (legacy unicode
    // entries were saved before canonicalization), atomically so a partial
    // failure can't leave one spelling still suppressing the domain.
    await db.withTransaction(async (tx) => {
      const entries = await db.getBrandSafeList(brandId, req.orgId, tx);
      for (const entry of entries) {
        if (canonicalDomain(entry) === normalized) {
          await db.removeSafeEntry(brandId, entry, req.orgId, tx);
        }
      }
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/takedown', async (req, res, next) => {
  try {
  const { domain, threat_type, evidence, contact_email } = req.body;
  const brandId = parseInt(req.params.id);
  const brand = await db.getBrand(brandId, req.orgId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Lookup registrar for the BAD domain (not the brand)
  const domainRegistrar = await brandService.getRegistrarInfo(domain);
  const registrar = domainRegistrar.registrar ? domainRegistrar : { registrar: 'Unknown', abuse_email: null };

  const baseTakedown = {
    domain,
    threat_type: threat_type || 'impersonation',
    evidence: evidence || {},
    contact_email: contact_email || 'legal@brand.com',
    status: 'pending',
    submitted_at: new Date().toISOString(),
    provider: registrar.registrar,
    abuse_email: registrar.abuse_email,
    email_template: brandService.buildTakedownEmail(domain, brand.brand_name, registrar.registrar, threat_type),
    sent: false,
    notes: ''
  };

  // Try to send the abuse email; notify Slack regardless of whether an
  // abuse address was resolved.
  const senderEmail = contact_email || 'legal@yourcompany.com';

  try {
    const { NotificationService } = require('../services/notifications');
    const notifService = await NotificationService.createForOrg(req.orgId);

    if (registrar.abuse_email && (notifService.transporter || notifService.resend)) {
      const emailResult = await notifService.sendNotification(
        registrar.abuse_email,
        `[Brand Abuse Report] ${domain} - ${threat_type || 'Impersonation'}`,
        baseTakedown.email_template,
        { replyTo: senderEmail, cc: senderEmail }
      );
      if (emailResult.success) {
        baseTakedown.sent = true;
        baseTakedown.status = 'sent';
        baseTakedown.sent_at = new Date().toISOString();
        baseTakedown.sender_email = senderEmail;
      }
    }
    if (notifService.slackWebhook) {
      await notifService.sendSlack({
        text: registrar.abuse_email
          ? `⚖️ *Takedown submitted:* ${domain} (${threat_type || 'impersonation'}) → ${registrar.registrar} <${registrar.abuse_email}>`
          : `⚖️ *Takedown submitted (manual send needed):* ${domain} (${threat_type || 'impersonation'}) — no abuse contact resolved for ${registrar.registrar}`
      });
    }
  } catch (e) {
  captureException(e);
    console.error('Failed to send takedown notification:', e.message);
  }

  const takedown = await db.addBrandTakedown(baseTakedown, brandId, req.orgId);
  res.json({ success: true, takedown_id: takedown.id, takedown });
  } catch (err) { next(err); }
});

router.get('/:id/takedowns', async (req, res, next) => {
  try {
    const brand = await db.getBrand(parseInt(req.params.id), req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    res.json(await db.getBrandTakedowns(brand.id, req.orgId));
  } catch (err) { next(err); }
});

// Add reply to takedown
router.post('/:id/takedown/:takedownId/reply', async (req, res, next) => {
  try {
    const { from, subject, body, direction } = req.body;
    const brandId = parseInt(req.params.id);
    const takedownId = parseInt(req.params.takedownId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const reply = await db.addTakedownReply({ from, subject, body, direction: direction || 'incoming' }, takedownId, brandId, req.orgId);
    if (!reply) return res.status(404).json({ error: 'Takedown not found' });

    // If incoming reply on a 'sent' takedown, advance status to waiting_response
    if ((direction || 'incoming') === 'incoming') {
    const tdRow = (await db.getBrandTakedowns(brandId, req.orgId)).find(t => t.id === takedownId);
    if (tdRow && tdRow.status === 'sent') {
      // expectedStatus guards against clobbering a concurrent status change.
      await db.updateBrandTakedown(takedownId, brandId, { status: 'waiting_response' }, req.orgId, 'sent');
    }
    }

    res.json({ success: true, reply });
  } catch (err) { next(err); }
});

router.patch('/:id/takedown/:takedownId', async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const brandId = parseInt(req.params.id);
    const takedownId = parseInt(req.params.takedownId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const updates = {};
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    const updated = await db.updateBrandTakedown(takedownId, brandId, updates, req.orgId);
    if (!updated) return res.status(404).json({ error: 'Takedown not found' });

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/threat', async (req, res, next) => {
  try {
    const { domain, threat_url, threat_type, severity, notes } = req.body;
    if (!domain && !threat_url) return res.status(400).json({ error: 'Domain or threat URL is required' });
    const brandId = parseInt(req.params.id);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    let canonical = canonicalDomain(domain);
    if (threat_url) {
      let parsed;
      try {
        parsed = new URL(threat_url);
      } catch {
        return res.status(400).json({ error: 'Threat URL must be a valid URL' });
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Threat URL must use HTTP or HTTPS' });
      }
      if (!canonical) canonical = canonicalDomain(parsed.hostname);
    }
    const threat = await db.addBrandThreat({
      domain: canonical || domain,
      threat_url: threat_url || null,
      canonical_domain: canonical || null,
      threat_type,
      severity,
      notes,
      detected_at: new Date().toISOString(),
    }, brandId, req.orgId);

    const jobId = await db.enqueueJob({
      type: 'threat.enrich',
      payload: { orgId: req.orgId, brandId, threatId: threat.id },
      dedupeKey: `threat.enrich:${threat.id}`,
    }).catch(async (error) => {
      captureException(error);
      // Do not leave the threat in `pending` with no job behind it: the
      // dialog would show active work that can never finish.
      await db.updateBrandThreatEnrichment(threat.id, brandId, req.orgId, {
        enrichment_status: 'failed',
        evidence_status: 'failed',
      }).catch((updateError) => captureException(updateError));
      return null;
    });

    res.json({ success: true, threat_id: threat.id, evidence_job_id: jobId });
  } catch (err) { next(err); }
});

router.get('/:id/threats', async (req, res, next) => {
  try {
    const brand = await db.getBrand(parseInt(req.params.id), req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    res.json(await db.getBrandThreats(brand.id, req.orgId));
  } catch (err) { next(err); }
});

router.get('/:id/threats/:threatId/evidence', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const threatId = parseInt(req.params.threatId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    // The dialog only polls while a job is actually queued. Legacy rows can
    // carry a pending status with no job, and polling them forever would
    // hammer the API without ever advancing. Read this before the status so
    // a worker's committed final state is observed when no job is active.
    const enrichmentActive = await db.isThreatEnrichmentQueued(threatId);
    const threat = await db.getBrandThreat(threatId, brandId, req.orgId);
    if (!threat) return res.status(404).json({ error: 'Threat not found' });
    const artifacts = await db.getEvidenceArtifacts(threatId, req.orgId);
    res.json({
      threat_id: threatId,
      enrichment_status: threat.enrichment_status,
      evidence_status: threat.evidence_status,
      enrichment_active: enrichmentActive,
      artifacts,
    });
  } catch (err) { next(err); }
});

function decorateUploadRequest(request, artifacts) {
  if (!request) return null;
  const byKind = new Map((artifacts || []).map((artifact) => [artifact.kind, artifact]));
  const items = request.items.map((item) => {
    const kind = uploadKind(item.key);
    const artifact = byKind.get(kind);
    return { ...item, upload_kind: kind, uploaded: !!artifact, artifact_id: artifact?.id || null };
  });
  return {
    id: request.id,
    threat_id: request.threat_id,
    brand_id: request.brand_id,
    reason: request.reason,
    status: request.status,
    expires_at: request.expires_at,
    items,
  };
}

router.get('/:id/threats/:threatId/assessment', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const threatId = parseInt(req.params.threatId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const threat = await db.getBrandThreat(threatId, brandId, req.orgId);
    if (!threat) return res.status(404).json({ error: 'Threat not found' });
    const [run, request, artifacts] = await Promise.all([
      db.getLatestAiRun(threatId, req.orgId, 'triage'),
      db.getActiveUploadRequest(threatId, req.orgId),
      db.getEvidenceArtifacts(threatId, req.orgId),
    ]);
    res.json({
      threat_id: threatId,
      assessment: run?.output || null,
      assessment_status: run ? run.status : 'none',
      assessment_provider: run?.provider || null,
      assessment_model: run?.model || null,
      assessment_error: run?.error || null,
      assessment_created_at: run?.created_at || null,
      assessment_active: await db.isThreatAssessmentQueued(threatId),
      upload_request: decorateUploadRequest(request, artifacts),
    });
  } catch (err) { next(err); }
});

router.post('/:id/threats/:threatId/assess', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const threatId = parseInt(req.params.threatId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const threat = await db.getBrandThreat(threatId, brandId, req.orgId);
    if (!threat) return res.status(404).json({ error: 'Threat not found' });
    const { id: jobId, created } = await db.enqueueJobDetailed({
      type: 'threat.assess',
      payload: { orgId: req.orgId, brandId, threatId },
      dedupeKey: `threat.assess:${threatId}`,
    });
    res.status(202).json({ success: true, job_id: jobId, threat_id: threatId, queued: created });
  } catch (err) { next(err); }
});

router.post('/:id/upload-requests/:requestId/token', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const requestId = parseInt(req.params.requestId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const request = await db.getUploadRequest(requestId, req.orgId);
    if (!request || request.brand_id !== brandId) return res.status(404).json({ error: 'Upload request not found' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Upload request is no longer pending' });
    if (Date.parse(request.expires_at) <= Date.now()) return res.status(410).json({ error: 'Upload request has expired' });
    const token = uploadToken();
    const expiresAt = requestExpiry();
    const updated = await db.updateUploadRequest(requestId, req.orgId, {
      token_hash: tokenHash(token),
      expires_at: expiresAt,
    });
    res.json({ success: true, token, expires_at: updated.expires_at, upload_path: `/api/uploads/${token}` });
  } catch (err) { next(err); }
});

router.post('/:id/threats/:threatId/enrich', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const threatId = parseInt(req.params.threatId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const threat = await db.getBrandThreat(threatId, brandId, req.orgId);
    if (!threat) return res.status(404).json({ error: 'Threat not found' });
    const { id: jobId, created } = await db.withTransaction(async (tx) => {
      const result = await db.enqueueJobDetailed({
        type: 'threat.enrich',
        payload: { orgId: req.orgId, brandId, threatId },
        dedupeKey: `threat.enrich:${threatId}`,
      }, tx);
      // Same transaction as the insert: a worker can only see the job once
      // the pending status is committed, so it cannot finish first and have
      // this write overwrite `complete` with `pending`.
      if (result.created) {
        await db.updateBrandThreatEnrichment(threatId, brandId, req.orgId, { enrichment_status: 'pending' }, tx);
      }
      return result;
    });
    res.status(202).json({ success: true, job_id: jobId, threat_id: threatId, queued: created });
  } catch (err) { next(err); }
});

router.get('/:id/evidence/:artifactId', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    const artifactId = parseInt(req.params.artifactId);
    const brand = await db.getBrand(brandId, req.orgId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const artifact = await db.getEvidenceArtifact(artifactId, req.orgId);
    if (!artifact || artifact.brand_id !== brandId) return res.status(404).json({ error: 'Evidence artifact not found' });
    if (!artifact.storage_key) return res.status(404).json({ error: 'Artifact has no stored file', artifact });
    const buffer = await readArtifact(artifact.storage_key);
    const isImage = String(artifact.mime || '').startsWith('image/');
    const forceDownload = req.query.download === '1';
    const extension = path.extname(artifact.storage_key || '');
    res.setHeader('Content-Type', isImage ? artifact.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isImage && !forceDownload ? 'inline' : 'attachment'}; filename="${artifact.kind}-${artifact.id}${extension}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    if (err && err.code === 'ENOENT') return res.status(404).json({ error: 'Evidence file not found' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const brandId = parseInt(req.params.id);
    // Foreign keys with ON DELETE CASCADE handle threats / takedowns /
    // replies / safe_entries / alerts cleanup automatically.
    const ok = await db.deleteBrand(brandId, req.orgId);
    res.json({ success: ok });
  } catch (err) { next(err); }
});

module.exports = router;
