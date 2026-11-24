'use strict';

const crypto = require('crypto');
const db = require('../../db/database');
const provider = require('./provider');
const { computeEvidenceGaps } = require('./gaps');

const ROUTES = new Set(['registrar', 'host', 'cdn', 'social', 'app_store', 'safe_browsing', 'unknown']);
const THREAT_TYPES = new Set(['phishing', 'impersonation', 'typosquat', 'parked', 'other']);

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function slug(value) {
  return clean(value, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'signal';
}

function artifactSummary(artifact) {
  const metadata = artifact.metadata || {};
  const base = {
    id: artifact.id,
    kind: artifact.kind,
    status: artifact.status,
    source_url: artifact.source_url || null,
    mime: artifact.mime || null,
    bytes: artifact.bytes || null,
  };
  if (artifact.kind === 'http') {
    return {
      ...base,
      http_status: metadata.http_status ?? null,
      server: metadata.headers?.server || null,
      cf_ray: metadata.headers?.['cf-ray'] || null,
      title: metadata.title || null,
      forms: metadata.forms ?? null,
      login_form: metadata.login_form ?? null,
      payment_form: metadata.payment_form ?? null,
    };
  }
  if (artifact.kind === 'rdap') {
    return {
      ...base,
      domain: metadata.data?.ldhName || null,
      statuses: metadata.data?.status || null,
      nameservers: metadata.data?.nameservers || [],
      entity_roles: (metadata.data?.entities || []).map((entity) => entity.roles),
    };
  }
  if (artifact.kind === 'tls') {
    return {
      ...base,
      authorized: metadata.authorized ?? null,
      issuer: metadata.issuer || null,
      subject: metadata.subject || null,
      valid_to: metadata.valid_to || null,
    };
  }
  if (artifact.kind === 'dns') {
    const records = {};
    for (const [key, value] of Object.entries(metadata.records || {})) {
      records[key] = Array.isArray(value) ? value.slice(0, 5).map((item) => String(item).slice(0, 300)) : value;
    }
    return { ...base, records };
  }
  return base;
}

function buildAssessmentInput(threat, brand, artifacts) {
  return {
    task: 'triage',
    brand: { name: clean(brand?.name, 200), domain: clean(brand?.domain, 200) },
    threat: {
      domain: clean(threat.domain, 200),
      url: threat.threat_url || null,
      threat_type: clean(threat.threat_type, 40),
      severity: clean(threat.severity, 20),
      source: clean(threat.source, 40),
      detected_at: threat.detected_at || null,
    },
    artifacts: artifacts.map(artifactSummary),
  };
}

function validateModelAssessment(raw, artifactIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('assessment is not an object');
  const summary = clean(raw.summary, 800);
  if (summary.length < 20) throw new Error('assessment summary is too short');
  const risk = Number(raw.risk_score);
  if (!Number.isFinite(risk) || risk < 0 || risk > 100) throw new Error('invalid risk_score');
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('invalid confidence');
  const route = ROUTES.has(raw.recommended_route) ? raw.recommended_route : 'unknown';
  const threatType = THREAT_TYPES.has(raw.threat_type) ? raw.threat_type : 'other';

  const signals = (Array.isArray(raw.signals) ? raw.signals : [])
    .slice(0, 8)
    .map((signal) => ({
      key: slug(signal?.key),
      label: clean(signal?.label, 80),
      value: clean(signal?.value, 240),
    }))
    .filter((signal) => signal.label && signal.value);

  const allowed = new Set(artifactIds);
  const citations = [...new Set((Array.isArray(raw.citations) ? raw.citations : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && allowed.has(id)))];
  if (artifactIds.length > 0 && citations.length === 0) throw new Error('assessment has no valid artifact citations');

  return {
    threat_type: threatType,
    risk_score: Math.round(risk),
    confidence: Math.round(confidence * 100) / 100,
    recommended_route: route,
    summary,
    signals,
    citations,
  };
}

function evidenceHash(artifacts) {
  return provider.inputHash(artifacts.map(artifactSummary));
}

function deterministicAssessment(threat, brand, artifacts) {
  const byKind = Object.fromEntries(artifacts.map((artifact) => [artifact.kind, artifact]));
  const http = byKind.http?.metadata || {};
  const rdap = byKind.rdap?.metadata?.data || null;
  const tls = byKind.tls?.metadata || {};
  const signals = [];

  if (byKind.http?.status === 'ok') {
    signals.push({
      key: 'http_live',
      label: 'Live page',
      value: `HTTP ${http.http_status || 'response'}${http.title ? `, title "${clean(http.title, 120)}"` : ''}`,
    });
  }
  if (http.login_form) signals.push({ key: 'login_form', label: 'Credential form', value: 'Page contains a password input.' });
  if (http.payment_form) signals.push({ key: 'payment_form', label: 'Payment language', value: 'Page contains card or payment fields.' });
  if (rdap) {
    signals.push({
      key: 'registration',
      label: 'Registration',
      value: `Nameservers: ${(rdap.nameservers || []).join(', ') || 'none published'}; status: ${(rdap.status || []).join(', ') || 'unknown'}.`,
    });
  }
  if (byKind.tls?.status === 'ok' || byKind.tls?.status === 'partial') {
    signals.push({
      key: 'certificate',
      label: 'Certificate',
      value: `${tls.authorized ? 'Trusted' : 'Untrusted'} certificate${tls.issuer?.O ? ` from ${clean(tls.issuer.O, 80)}` : ''}; valid to ${tls.valid_to || 'unknown'}.`,
    });
  }

  const base = { high: 78, medium: 55, low: 30 }[String(threat.severity || '').toLowerCase()] || 50;
  let risk = Number.isFinite(threat.risk_score) && threat.risk_score != null ? threat.risk_score : base;
  if (http.login_form) risk += 8;
  if (http.payment_form) risk += 8;
  if (byKind.http?.status === 'ok') risk += 4;
  const confidence = Math.min(0.8, 0.55 + (rdap ? 0.1 : 0) + (byKind.http?.status === 'ok' ? 0.05 : 0));
  const route = rdap ? 'registrar'
    : (http.headers?.['cf-ray'] || /cloudflare/i.test(String(http.headers?.server || ''))) ? 'cdn'
      : byKind.http?.status === 'ok' ? 'host' : 'unknown';

  const citations = artifacts.filter((artifact) => artifact.status === 'ok').map((artifact) => artifact.id);
  const cites = citations.length ? citations.map((id) => `#${id}`).join(', ') : 'none';
  const summary = artifacts.length
    ? `${clean(threat.domain, 120)} is suspected ${clean(threat.threat_type || 'impersonation', 40)} of ${clean(brand?.name || brand?.domain, 120)}. ${signals.length} deterministic signal(s) were observed; evidence artifacts ${cites} support this assessment. ${route === 'registrar' ? 'A registrar takedown is the primary route.' : route === 'unknown' ? 'The available evidence does not identify a clear reporting route.' : `The primary reporting route is ${route}.`}`
    : `${clean(threat.domain, 120)} is suspected ${clean(threat.threat_type || 'impersonation', 40)} of ${clean(brand?.name || brand?.domain, 120)}. No evidence artifacts were collected, so this assessment is a low-confidence template.`;

  return {
    threat_type: THREAT_TYPES.has(String(threat.threat_type || '').toLowerCase()) ? String(threat.threat_type).toLowerCase() : 'other',
    risk_score: Math.max(0, Math.min(96, Math.round(risk))),
    confidence: Math.round(confidence * 100) / 100,
    recommended_route: route,
    summary,
    signals,
    citations,
  };
}

function uploadToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requestExpiry() {
  const hours = Math.max(1, Number(process.env.UPLOAD_REQUEST_TTL_HOURS) || 168);
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

async function ensureUploadRequest(threat, artifacts, gaps) {
  if (!gaps.length) return null;
  const existing = await db.getActiveUploadRequest(threat.id, threat.org_id);
  if (existing) {
    const keys = new Set(existing.items.map((item) => item.key));
    const missing = gaps.filter((gap) => !keys.has(gap.key));
    if (!missing.length) return existing;
    return db.updateUploadRequest(existing.id, threat.org_id, { items: [...existing.items, ...missing] });
  }
  return db.addUploadRequest({
    org_id: threat.org_id,
    brand_id: threat.brand_id,
    threat_id: threat.id,
    token_hash: tokenHash(uploadToken()),
    items: gaps,
    reason: gaps[0].reason,
    status: 'pending',
    expires_at: requestExpiry(),
  });
}

async function assessThreat(payload, canContinue) {
  const orgId = payload.orgId || payload.org_id;
  const brandId = Number(payload.brandId || payload.brand_id);
  const threatId = Number(payload.threatId || payload.threat_id);
  if (!orgId || !brandId || !threatId) throw new Error('org, brand, and threat are required');

  const threat = await db.getBrandThreat(threatId, brandId, orgId);
  if (!threat) throw new Error(`threat ${threatId} not found`);
  const brand = await db.getBrand(brandId, orgId);
  const artifacts = await db.getEvidenceArtifacts(threatId, orgId);
  if (canContinue && !(await canContinue())) throw new Error('job guard expired');

  const input = buildAssessmentInput(threat, brand, artifacts);
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const fallback = deterministicAssessment(threat, brand, artifacts);
  let assessment = fallback;
  let providerName = 'deterministic';
  let model = null;
  let tokensInput = null;
  let tokensOutput = null;
  let latencyMs = null;
  let status = 'completed';
  let errorMessage = null;

  if (provider.isConfigured()) {
    try {
      const result = await provider.callModel(input);
      assessment = {
        ...validateModelAssessment(result.output, artifactIds),
        gaps: [],
        generated_by: 'ai',
      };
      providerName = result.provider;
      model = result.model;
      tokensInput = result.tokens_input;
      tokensOutput = result.tokens_output;
      latencyMs = result.latency_ms;
    } catch (error) {
      status = 'fallback';
      errorMessage = clean(error.message, 500);
      assessment = { ...fallback, gaps: [], generated_by: 'deterministic' };
    }
  } else {
    assessment = { ...fallback, gaps: [], generated_by: 'deterministic' };
  }

  assessment.gaps = computeEvidenceGaps(threat, artifacts, assessment.recommended_route);
  if (!assessment.citations.length) {
    assessment.citations = artifacts.filter((artifact) => artifact.status === 'ok').map((artifact) => artifact.id);
  }
  if (canContinue && !(await canContinue())) throw new Error('job guard expired');

  const assessedEvidenceHash = evidenceHash(artifacts);
  const aiRun = await db.addAiRun({
    org_id: orgId,
    brand_id: brandId,
    threat_id: threatId,
    task: 'triage',
    provider: providerName,
    model,
    prompt_version: provider.PROMPT_VERSION,
    input_hash: provider.inputHash(input),
    output: assessment,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    latency_ms: latencyMs,
    status,
    error: errorMessage,
  });

  const uploadRequest = await ensureUploadRequest(threat, artifacts, assessment.gaps);
  await db.updateBrandThreatEnrichment(threatId, brandId, orgId, {
    risk_score: assessment.risk_score,
    confidence: assessment.confidence,
  });

  return { assessment, aiRun, uploadRequest, evidenceHash: assessedEvidenceHash };
}

module.exports = {
  assessThreat,
  buildAssessmentInput,
  evidenceHash,
  deterministicAssessment,
  validateModelAssessment,
  tokenHash,
  uploadToken,
  requestExpiry,
};
