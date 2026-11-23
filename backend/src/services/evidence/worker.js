const os = require('os');
const db = require('../../db/database');
const { collectEvidence } = require('./collectors');
const { putArtifact } = require('./storage');

const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const configuredPoll = Number(process.env.JOB_WORKER_POLL_MS || 1000);
const configuredRetention = Number(process.env.EVIDENCE_RETENTION_DAYS || 365);
const POLL_MS = Number.isFinite(configuredPoll) ? Math.max(250, configuredPoll) : 1000;
const RETENTION_DAYS = Number.isFinite(configuredRetention) ? Math.max(1, configuredRetention) : 365;
const RECOVERY_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const STALE_MINUTES = 15;

let timer = null;
let running = false;
let stopped = true;
let lastRecoveryAt = 0;

function mergeMetadata(threat, evidence) {
  const current = threat && threat.metadata && typeof threat.metadata === 'object' ? threat.metadata : {};
  return { ...current, evidence };
}

function summarize(results) {
  return results.map((result) => ({
    kind: result.kind,
    status: result.status,
    collector: result.collector || result.kind,
    bytes: Buffer.isBuffer(result.bytes) ? result.bytes.length : null,
    error: result.metadata && result.metadata.error ? result.metadata.error : null,
  }));
}

function aggregateEvidenceStatus(results) {
  if (results.some((result) => result.status === 'ok')) return 'complete';
  if (results.some((result) => result.status === 'partial' || result.status === 'skipped')) return 'partial';
  return 'failed';
}

async function enrichThreat(payload) {
  const orgId = payload.orgId || payload.org_id;
  const brandId = Number(payload.brandId || payload.brand_id);
  const threatId = Number(payload.threatId || payload.threat_id);
  if (!orgId || !brandId || !threatId) throw new Error('threat.enrich payload requires orgId, brandId, and threatId');

  const threat = await db.getBrandThreat(threatId, brandId, orgId);
  if (!threat) throw new Error('threat not found');
  await db.updateBrandThreatEnrichment(threatId, brandId, orgId, { enrichment_status: 'running' });

  try {
    const results = await collectEvidence(threat);
    const collectedAt = new Date().toISOString();
    const retentionExpiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    for (const result of results) {
      let stored = null;
      if (Buffer.isBuffer(result.bytes) && result.bytes.length > 0) {
        stored = await putArtifact({
          orgId,
          brandId,
          threatId,
          kind: result.kind,
          buffer: result.bytes,
          mime: result.mime,
        });
      }
      await db.addEvidenceArtifact({
        org_id: orgId,
        brand_id: brandId,
        threat_id: threatId,
        kind: result.kind,
        status: result.status,
        source_url: result.source_url || null,
        storage_key: stored ? stored.storage_key : null,
        mime: result.mime || null,
        bytes: stored ? stored.bytes : null,
        sha256: stored ? stored.sha256 : null,
        collector: result.collector || result.kind,
        collector_version: result.collector_version || '1',
        metadata: result.metadata || {},
        collected_at: collectedAt,
        retention_expires_at: retentionExpiresAt,
      });
    }

    const evidenceStatus = aggregateEvidenceStatus(results);
    const reachable = results.some((result) => result.kind === 'http' && result.status === 'ok');
    const updates = {
      enrichment_status: 'complete',
      evidence_status: evidenceStatus,
      metadata: mergeMetadata(threat, {
        collected_at: collectedAt,
        artifacts: summarize(results),
      }),
    };
    if (reachable) updates.last_seen = collectedAt;
    await db.updateBrandThreatEnrichment(threatId, brandId, orgId, updates);
    return { threatId, evidenceStatus, artifacts: results.length };
  } catch (error) {
    await db.updateBrandThreatEnrichment(threatId, brandId, orgId, {
      enrichment_status: 'failed',
      evidence_status: 'failed',
      metadata: mergeMetadata(threat, { error: error.message || String(error) }),
    }).catch(() => {});
    throw error;
  }
}

async function runJob(job) {
  // Keep the lease alive for the whole run so recoverStaleJobs cannot
  // reclaim a job that is still being worked on.
  const heartbeat = setInterval(() => {
    db.heartbeatJob(job.id, WORKER_ID).catch(() => {});
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  try {
    if (job.type === 'threat.enrich') {
      await enrichThreat(job.payload || {});
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
    await db.completeJob(job.id);
  } catch (error) {
    console.error(`[jobs] ${job.type} ${job.id} failed:`, error.message || error);
    await db.failJob(job.id, error).catch((failure) => console.error('[jobs] failed to record failure:', failure.message));
  } finally {
    clearInterval(heartbeat);
  }
}

async function tick() {
  if (stopped || running) return;
  running = true;
  try {
    if (Date.now() - lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
      lastRecoveryAt = Date.now();
      await db.recoverStaleJobs(STALE_MINUTES);
    }
    const job = await db.claimJob(WORKER_ID);
    if (job) await runJob(job);
  } catch (error) {
    console.error('[jobs] worker tick failed:', error.message || error);
  } finally {
    running = false;
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  }
}

async function startJobWorker() {
  if (process.env.DISABLE_JOB_WORKER === 'true') {
    console.log('[jobs] worker disabled');
    return;
  }
  if (!stopped) return;
  stopped = false;
  lastRecoveryAt = Date.now();
  await db.recoverStaleJobs(STALE_MINUTES).catch(() => {});
  console.log(`[jobs] worker started (${WORKER_ID})`);
  tick();
}

function stopJobWorker() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startJobWorker, stopJobWorker, enrichThreat };
