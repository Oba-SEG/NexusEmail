"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Download, ExternalLink, FileJson, Globe2, Lock, RefreshCw, Server, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify, describeApiError } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle, dialogFocusReturn,
} from "@/components/ui/dialog";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const KIND_META: Record<string, { label: string; icon: any }> = {
  dns: { label: 'DNS records', icon: Globe2 },
  rdap: { label: 'RDAP registration', icon: FileJson },
  http: { label: 'HTTP response', icon: Server },
  tls: { label: 'TLS certificate', icon: Lock },
  screenshot: { label: 'Screenshot', icon: Camera },
};

interface ThreatEvidenceDialogProps {
  open: boolean;
  onClose: () => void;
  brandId: number;
  threat: any;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  tokenRef: { current: string | null };
  onAuthFailure: (requestToken?: string | null) => void;
  openerRef: { current: HTMLButtonElement | null };
}

function statusVariant(status: string) {
  if (status === 'ok' || status === 'complete') return 'default';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function formatBytes(value: number | null | undefined) {
  if (!value) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('Could not read file'));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function artifactSummary(artifact: any) {
  const metadata = artifact.metadata || {};
  if (artifact.kind === 'dns') {
    const records = metadata.records || {};
    const count = (value: any) => (Array.isArray(value) ? value.length : 0);
    return `A ${count(records.a)} · AAAA ${count(records.aaaa)} · MX ${count(records.mx)} · NS ${count(records.ns)} · TXT ${count(records.txt)}`;
  }
  if (artifact.kind === 'rdap') {
    const data = metadata.data || {};
    const rdapStatus = Array.isArray(data.status) ? data.status.join(', ') : data.status;
    return [data.ldhName, rdapStatus, metadata.http_status ? `HTTP ${metadata.http_status}` : null].filter(Boolean).join(' · ') || 'RDAP response';
  }
  if (artifact.kind === 'http') {
    return [`HTTP ${metadata.http_status}`, metadata.headers?.server, metadata.headers?.['content-type']].filter(Boolean).join(' · ');
  }
  if (artifact.kind === 'tls') {
    return [metadata.subject?.CN, metadata.issuer?.CN, metadata.valid_to ? `valid to ${metadata.valid_to}` : null].filter(Boolean).join(' · ');
  }
  if (artifact.kind === 'screenshot') {
    return metadata.reason || [metadata.width && `${metadata.width}×${metadata.height}`, metadata.engine].filter(Boolean).join(' · ');
  }
  if (String(artifact.kind).startsWith('upload_')) {
    return [metadata.label, metadata.original_filename, metadata.scan?.scanner ? `scanned by ${metadata.scan.scanner}` : null].filter(Boolean).join(' · ');
  }
  return metadata.reason || metadata.error || '';
}

export default function ThreatEvidenceDialog({
  open, onClose, brandId, threat, apiFetch, tokenRef, onAuthFailure, openerRef,
}: ThreatEvidenceDialogProps) {
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [enrichmentStatus, setEnrichmentStatus] = useState('pending');
  const [evidenceStatus, setEvidenceStatus] = useState('pending');
  const [enrichmentActive, setEnrichmentActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<any | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState('none');
  const [assessmentActive, setAssessmentActive] = useState(false);
  const [assessmentProvider, setAssessmentProvider] = useState<string | null>(null);
  const [assessmentProviderError, setAssessmentProviderError] = useState<string | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [uploadRequest, setUploadRequest] = useState<any | null>(null);
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const apiFetchRef = useRef(apiFetch);
  const onAuthFailureRef = useRef(onAuthFailure);
  const tokenRefRef = useRef(tokenRef);
  const loadSeqRef = useRef(0);
  const assessmentSeqRef = useRef(0);
  apiFetchRef.current = apiFetch;
  onAuthFailureRef.current = onAuthFailure;
  tokenRefRef.current = tokenRef;

  const loadEvidence = useCallback(async () => {
    if (!threat?.id) return;
    const seq = ++loadSeqRef.current;
    const requestToken = tokenRefRef.current.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetchRef.current(`${API_BASE}/brands/${brandId}/threats/${threat.id}/evidence`);
      if (res.status === 401) {
        onAuthFailureRef.current(requestToken);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // A newer request superseded this one; never let an older poll
      // overwrite a newer collection's status.
      if (seq !== loadSeqRef.current) return null;
      setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
      setEnrichmentStatus(data.enrichment_status || 'pending');
      setEvidenceStatus(data.evidence_status || 'pending');
      setEnrichmentActive(Boolean(data.enrichment_active));
      return {
        enrichmentStatus: data.enrichment_status || 'pending',
        evidenceStatus: data.evidence_status || 'pending',
        enrichmentActive: Boolean(data.enrichment_active),
      };
    } catch (e) {
      if (seq !== loadSeqRef.current) return null;
      setError(describeApiError(e instanceof Error ? e.message : null));
      return null;
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [brandId, threat?.id]);

  const loadAssessment = useCallback(async () => {
    if (!threat?.id) return null;
    const seq = ++assessmentSeqRef.current;
    const requestToken = tokenRefRef.current.current;
    setAssessmentLoading(true);
    setAssessmentError(null);
    try {
      const res = await apiFetchRef.current(`${API_BASE}/brands/${brandId}/threats/${threat.id}/assessment`);
      if (res.status === 401) {
        onAuthFailureRef.current(requestToken);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== assessmentSeqRef.current) return null;
      setAssessment(data.assessment || null);
      setAssessmentStatus(data.assessment_status || 'none');
      setAssessmentActive(Boolean(data.assessment_active));
      setAssessmentProvider(data.assessment_provider || null);
      setAssessmentProviderError(data.assessment_error || null);
      setUploadRequest(data.upload_request || null);
      return { active: Boolean(data.assessment_active), status: data.assessment_status || 'none' };
    } catch (e) {
      if (seq !== assessmentSeqRef.current) return null;
      setAssessmentError(describeApiError(e instanceof Error ? e.message : null));
      return null;
    } finally {
      if (seq === assessmentSeqRef.current) setAssessmentLoading(false);
    }
  }, [brandId, threat?.id]);

  useEffect(() => {
    if (open && threat?.id) {
      loadEvidence();
      loadAssessment();
    }
    return () => {
      // Invalidate any in-flight load when the dialog closes or the
      // selected threat changes.
      loadSeqRef.current += 1;
      assessmentSeqRef.current += 1;
    };
  }, [open, threat?.id, loadEvidence, loadAssessment]);

  // Keep refreshing while a collection is still in flight. Without this the
  // dialog would show the pre-collection snapshot forever if the worker
  // finishes after the initial load (or after the manual six-poll loop).
  useEffect(() => {
    if (!open || !threat?.id) return undefined;
    if (enrichmentStatus !== 'pending' && enrichmentStatus !== 'running') return undefined;
    // `pending` without a queued job is stale state, not work in flight.
    if (!enrichmentActive) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const status = await loadEvidence();
      if (cancelled) return;
      const next = status?.enrichmentStatus;
      if (next && next !== 'pending' && next !== 'running') {
        // Assessment is enqueued once enrichment finishes.
        await loadAssessment();
        return;
      }
      if (!status?.enrichmentActive) return;
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, threat?.id, enrichmentStatus, enrichmentActive, loadEvidence, loadAssessment]);

  // Assessment runs as a background job after enrichment. Poll only while
  // that job is actually queued, never just because a status says pending.
  useEffect(() => {
    if (!open || !threat?.id || !assessmentActive) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const status = await loadAssessment();
      if (cancelled || !status?.active) return;
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, threat?.id, assessmentActive, loadAssessment]);

  const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot' && artifact.storage_key);
  const screenshotId = screenshot?.id;
  const screenshotKey = screenshot?.storage_key;
  const screenshotCollectedAt = screenshot?.collected_at;
  useEffect(() => {
    if (!open || !screenshotId) {
      setPreviewUrl(null);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const requestToken = tokenRefRef.current.current;
    apiFetchRef.current(`${API_BASE}/brands/${brandId}/evidence/${screenshotId}`)
      .then(async (res) => {
        if (res.status === 401) {
          onAuthFailureRef.current(requestToken);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [brandId, open, screenshotId, screenshotKey, screenshotCollectedAt]);

  const enrich = async () => {
    if (!threat?.id || enriching) return;
    const requestToken = tokenRefRef.current.current;
    setEnriching(true);
    try {
      const res = await apiFetchRef.current(`${API_BASE}/brands/${brandId}/threats/${threat.id}/enrich`, { method: 'POST' });
      if (res.status === 401) {
        onAuthFailureRef.current(requestToken);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notify('Evidence collection queued', 'info');
      // The dialog's polling effect takes over from here and stops as soon
      // as the worker reports a terminal status.
      await loadEvidence();
    } catch (e) {
      notify('Could not queue evidence collection', 'error', describeApiError(e instanceof Error ? e.message : null));
    } finally {
      setEnriching(false);
    }
  };

  const assess = async () => {
    if (!threat?.id || assessing) return;
    const requestToken = tokenRefRef.current.current;
    setAssessing(true);
    try {
      const res = await apiFetchRef.current(`${API_BASE}/brands/${brandId}/threats/${threat.id}/assess`, { method: 'POST' });
      if (res.status === 401) {
        onAuthFailureRef.current(requestToken);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notify('Assessment queued', 'info');
      await loadAssessment();
    } catch (e) {
      notify('Could not queue assessment', 'error', describeApiError(e instanceof Error ? e.message : null));
    } finally {
      setAssessing(false);
    }
  };

  const uploadEvidence = async (itemKey: string, file: File) => {
    if (!uploadRequest?.id || uploadingItem) return;
    const requestToken = tokenRefRef.current.current;
    setUploadingItem(itemKey);
    setUploadError(null);
    try {
      const tokenRes = await apiFetchRef.current(
        `${API_BASE}/brands/${brandId}/upload-requests/${uploadRequest.id}/token`,
        { method: 'POST' }
      );
      if (tokenRes.status === 401) {
        onAuthFailureRef.current(requestToken);
        return;
      }
      if (!tokenRes.ok) throw new Error(`HTTP ${tokenRes.status}`);
      const { token } = await tokenRes.json();
      const data_base64 = await fileToBase64(file);
      const res = await apiFetchRef.current(`${API_BASE}/uploads/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: itemKey, filename: file.name, mime: file.type, data_base64 }),
      });
      if (res.status === 401) {
        onAuthFailureRef.current(requestToken);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      notify('Evidence uploaded', 'success');
      await Promise.all([loadEvidence(), loadAssessment()]);
    } catch (e) {
      setUploadError(describeApiError(e instanceof Error ? e.message : null));
    } finally {
      setUploadingItem(null);
    }
  };

  if (!open || !threat) return null;

  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-h-[85vh] w-full max-w-2xl overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(openerRef)}>
        <div>
          <DialogTitle className="font-mono text-[15px]">Evidence: {threat.domain}</DialogTitle>
          <DialogDescription>
            Deterministic DNS, registration, HTTP, TLS and screenshot artifacts collected for this threat.
          </DialogDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-y border-border/60 py-3">
          <Badge variant={statusVariant(evidenceStatus)}>Evidence {evidenceStatus}</Badge>
          <Badge variant="outline">Enrichment {enrichmentStatus}</Badge>
          {enrichmentStatus === 'pending' && !enrichmentActive && (
            <span className="text-[11px] text-muted-foreground">Collection not queued</span>
          )}
          <Button size="sm" variant="outline" onClick={enrich} disabled={enriching}>
            <RefreshCw className={`w-3.5 h-3.5 ${enriching ? 'animate-spin' : ''}`} />
            {enriching ? 'Collecting' : 'Collect evidence'}
          </Button>
          <Button size="sm" variant="outline" onClick={assess} disabled={assessing}>
            <Sparkles className={`w-3.5 h-3.5 ${assessing ? 'animate-pulse' : ''}`} />
            {assessing ? 'Assessing' : 'Assess'}
          </Button>
        </div>

        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <p className="text-[12px] font-medium">Assessment</p>
            {assessment && (
              <Badge variant={assessment.generated_by === 'ai' ? 'default' : 'secondary'}>
                {assessment.generated_by === 'ai' ? 'AI' : 'Rules fallback'}
              </Badge>
            )}
            {assessmentActive && <Badge variant="outline">Queued</Badge>}
            {assessment?.risk_score != null && <Badge variant="outline">Risk {assessment.risk_score}/100</Badge>}
            {assessment?.confidence != null && (
              <span className="text-[10px] text-muted-foreground">confidence {Math.round(assessment.confidence * 100)}%</span>
            )}
          </div>

          {assessmentLoading && !assessment ? (
            <p className="mt-2 text-[11px] text-muted-foreground">Loading assessment…</p>
          ) : assessmentError ? (
            <p className="mt-2 text-[11px] text-red-400">{assessmentError}</p>
          ) : assessment ? (
            <div className="mt-2 space-y-2">
              <p className="text-[12px] text-muted-foreground">{assessment.summary}</p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="text-muted-foreground">
                  Route <span className="text-foreground">{String(assessment.recommended_route || 'unknown').replace(/_/g, ' ')}</span>
                </span>
                {Array.isArray(assessment.citations) && assessment.citations.length > 0 && (
                  <span className="text-muted-foreground">
                    Cites {assessment.citations.map((id: number) => `#${id}`).join(', ')}
                  </span>
                )}
              </div>
              {Array.isArray(assessment.signals) && assessment.signals.length > 0 && (
                <ul className="space-y-1 text-[11px]">
                  {assessment.signals.map((signal: any) => (
                    <li key={signal.key} className="flex gap-2">
                      <span className="shrink-0 font-medium">{signal.label}</span>
                      <span className="text-muted-foreground">{signal.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              {assessmentProviderError && (
                <p className="text-[10px] text-amber-400">
                  {assessmentProvider ? `Model fallback (${assessmentProvider}): ` : 'Model fallback: '}
                  {assessmentProviderError}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">Assessment {assessmentStatus}</p>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No assessment yet. It is generated after evidence collection, or run it manually.
            </p>
          )}
        </div>

        {uploadRequest && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Upload className="h-4 w-4 text-amber-400" />
              <p className="text-[12px] font-medium">Evidence requested</p>
              <Badge variant="secondary">{uploadRequest.status}</Badge>
            </div>
            {uploadRequest.reason && <p className="mt-1 text-[11px] text-muted-foreground">{uploadRequest.reason}</p>}
            <div className="mt-2 space-y-2">
              {uploadRequest.items.map((item: any) => (
                <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-[11px] font-medium">
                      {item.uploaded && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                      {item.label || item.key}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{item.reason}</p>
                  </div>
                  {item.uploaded ? (
                    <Badge variant="default">Uploaded</Badge>
                  ) : (
                    <label className={`shrink-0 cursor-pointer rounded-md border border-border/60 px-2 py-1 text-[11px] hover:bg-accent ${uploadingItem ? 'opacity-60' : ''}`}>
                      {uploadingItem === item.key ? 'Uploading…' : 'Choose file'}
                      <input
                        type="file"
                        className="sr-only"
                        accept={(item.accepted_mime || []).join(',')}
                        disabled={!!uploadingItem}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = '';
                          if (file) uploadEvidence(item.key, file);
                        }}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {uploadError && <p className="mt-2 text-[11px] text-red-400">{uploadError}</p>}
            {uploadRequest.expires_at && (
              <p className="mt-2 text-[10px] text-muted-foreground">Request expires {formatDateTime(uploadRequest.expires_at)}</p>
            )}
          </div>
        )}

        {loading && artifacts.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Loading evidence…</p>
        ) : error ? (
          <p className="text-[12px] text-red-400">{error}</p>
        ) : artifacts.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No evidence collected yet. Run collection to gather artifacts.</p>
        ) : (
          <div className="space-y-3">
            {artifacts.map((artifact) => {
              const meta = KIND_META[artifact.kind]
                || (String(artifact.kind).startsWith('upload_')
                  ? { label: artifact.metadata?.label || 'Uploaded evidence', icon: Upload }
                  : { label: artifact.kind, icon: FileJson });
              const Icon = meta.icon;
              return (
                <div key={artifact.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium">{meta.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{artifactSummary(artifact)}</p>
                      </div>
                    </div>
                    <Badge variant={statusVariant(artifact.status)}>{artifact.status}</Badge>
                  </div>

                  {artifact.source_url && (
                    <a className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline" href={artifact.source_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3" /> Open source
                    </a>
                  )}

                  {artifact.storage_key && (
                    <a
                      className="mt-2 ml-3 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      href={`${API_BASE}/brands/${brandId}/evidence/${artifact.id}${artifact.kind === 'screenshot' ? '?download=1' : ''}`}
                    >
                      <Download className="h-3 w-3" /> Download
                    </a>
                  )}

                  {artifact.kind === 'screenshot' && previewUrl && (
                    <img src={previewUrl} alt={`Screenshot of ${threat.domain}`} className="mt-3 max-h-72 w-full rounded-md border border-border/60 object-contain" />
                  )}

                  {artifact.metadata?.error && <p className="mt-2 text-[11px] text-red-400">{artifact.metadata.error}</p>}
                  {artifact.metadata?.reason && <p className="mt-2 text-[11px] text-muted-foreground">{artifact.metadata.reason}</p>}

                  <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                    {artifact.collected_at && <span>Collected {formatDateTime(artifact.collected_at)}</span>}
                    {formatBytes(artifact.bytes) && <span>{formatBytes(artifact.bytes)}</span>}
                    {artifact.collector && <span>via {artifact.collector}</span>}
                    {artifact.sha256 && (
                      <span className="font-mono" title={artifact.sha256}>sha256 {String(artifact.sha256).slice(0, 12)}…</span>
                    )}
                  </div>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground">Raw metadata</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px] text-muted-foreground">{JSON.stringify(artifact.metadata || {}, null, 2)}</pre>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
