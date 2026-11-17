"use client";

import { useState, useRef } from "react";
import {
  Search, AlertTriangle, CheckCircle, XCircle, Globe, Plus, RefreshCw,
  Zap, Eye, Clock, Wrench, Trash2, CheckSquare, Square, Activity
} from "lucide-react";
import DomainDetailPanel from "@/components/dashboard/DomainDetailPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, dialogFocusReturn,
} from "@/components/ui/dialog";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { PASSING_SCORE, WARNING_SCORE, scoreBand, filterByBand } from "@/lib/scores";
import { recordState } from "@/lib/domainPanel";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface DomainsTabProps {
  domains: any[];
  selectedIds: number[];
  toggleSelect: (id: number) => void;
  toggleSelectAll: () => void;
  setSelectedIds: (ids: number[]) => void;
  scanning: boolean;
  bulkScan: () => void;
  deleteDomains: () => void;
  scanDomain: (domainId: number) => void;
  viewDomain: (domain: any) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  sessionGenRef: { current: number };
  loadDomains: (gen?: number) => void;
  selectedDomain: any;
  fixRecommendations: any;
  detailRefreshing: boolean;
  detailRefreshError: string | null;
  dmarcUploading: boolean;
  dmarcUploadError: string | null;
  dmarcFileRef: React.RefObject<HTMLInputElement | null>;
  uploadDmarcReport: (domainId: number, file: File) => void;
  fixDomain: (domainId: number) => void;
  onClosePanel: () => void;
  showDetails: boolean;
}

/** Domains tab: hero add-card, KPI strip, filter pills and the domain
 * rows. Selection + deletion stay in the Dashboard (they drive the
 * detail-panel machine); this component owns the add/verify UX and
 * resets it on unmount. */
export default function DomainsTab({
  domains, selectedIds, toggleSelect, toggleSelectAll, setSelectedIds,
  scanning, bulkScan, deleteDomains, scanDomain, viewDomain,
  apiFetch, sessionGenRef, loadDomains,
  selectedDomain, fixRecommendations, detailRefreshing, detailRefreshError,
  dmarcUploading, dmarcUploadError, dmarcFileRef, uploadDmarcReport, fixDomain,
  onClosePanel, showDetails,
}: DomainsTabProps) {
  const [domainInput, setDomainInput] = useState("");
  const [addDomainError, setAddDomainError] = useState<string | null>(null);
  const [addDomainSuccess, setAddDomainSuccess] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const verifyOpenerRef = useRef<HTMLButtonElement | null>(null);
  const heroHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyDomain, setVerifyDomain] = useState<any>(null);
  const [verifyToken, setVerifyToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const selectedNames = domains
    .filter((d: any) => selectedIds.includes(d.id))
    .map((d: any) => d.name);
  const shownNames = selectedNames.slice(0, 5);
  const hiddenCount = selectedNames.length - shownNames.length;

  const addDomain = async () => {
    const gen = sessionGenRef.current;
    const raw = domainInput.trim();
    if (!raw) return;
    // Detect multi-domain input: split on newline, comma, semicolon, whitespace
    const tokens = raw.split(/[\s,;]+/).map(t => t.toLowerCase().trim()).filter(Boolean);
    if (tokens.length === 0) return;

    setAddBusy(true);
    setAddDomainError(null);
    setAddDomainSuccess(null);

    try {
      if (tokens.length === 1) {
        const res = await apiFetch(`${API_BASE}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tokens[0] })
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Add failed (HTTP ${res.status})`);
        }
        setAddDomainSuccess(`Added ${tokens[0]} \u2014 scanning\u2026`);
      } else {
        const res = await apiFetch(`${API_BASE}/domains/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domains: tokens })
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Bulk add failed (HTTP ${res.status})`);
        }
        const body = await res.json();
        const summary = `Added ${body.added?.length ?? 0} of ${body.total} (${body.failed?.length ?? 0} failed) \u2014 scanning\u2026`;
        setAddDomainSuccess(summary);
      }

      await apiFetch(`${API_BASE}/domains/bulk-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_ids: [] })
      });

      await loadDomains(gen);
      setDomainInput("");
      setTimeout(() => setAddDomainSuccess(null), 6000);
    } catch (e: any) {
      setAddDomainError(e?.message || 'Failed to add domain');
      console.error('Failed to add domain:', e);
    } finally {
      setAddBusy(false);
    }
  };

  const openVerifyModal = async (domain: any) => {
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domain.id}/verify/generate`);
      const data = await res.json();
      setVerifyDomain(domain);
      setVerifyToken(data.token);
      setShowVerifyModal(true);
    } catch (e) {
      console.error('Failed to generate verification:', e);
    }
  };

  const verifyDomainOwnership = async () => {
    if (!verifyDomain) return;
    const gen = sessionGenRef.current;
    setVerifying(true);
    try {
      const res = await apiFetch(`${API_BASE}/domains/${verifyDomain.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken })
      });
      const data = await res.json();
      
      if (data.verified) {
        notify('Domain verified. Brand Protection and reporting are now unlocked.', 'success');
        setShowVerifyModal(false);
        loadDomains(gen);
      } else {
        notify('Verification failed.', 'error', `${describeApiError(data.reason || 'TXT record not found')} Publish the TXT record, then try again.`);
      }
    } catch (e) {
      notify('Verification failed.', 'error', describeError(e, 'The verification request failed.'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
{/* Hero Search */}
<div className="mb-6">
  <div className="text-center mb-6 max-w-2xl mx-auto">
    <h2 ref={heroHeadingRef} className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-2">
      Add a domain. Watch its posture.
    </h2>
    <p className="text-sm text-muted-foreground">
      We'll scan SPF / DKIM / DMARC, score the result, and surface anything that needs fixing.
    </p>
  </div>
  <div className="relative max-w-2xl mx-auto">
    <Card className="relative premium-surface premium-card border-0">
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Add one domain, or paste many (commas / spaces / newlines)"
              className="h-12 pl-12 bg-background/50 border-white/10 focus-visible:border-orange-500/40"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addDomain()}
            />
          </div>
          <Button
            className="h-12 px-6 btn-premium-primary border-0"
            onClick={addDomain}
            disabled={addBusy}
          >
            {addBusy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add & Scan
          </Button>
        </div>
        {addDomainError && (
          <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/40 text-sm text-red-300">
            {addDomainError}
          </div>
        )}
        {addDomainSuccess && !addDomainError && (
          <div className="mt-3 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
            {addDomainSuccess}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Tip: paste multiple domains separated by commas, spaces, or newlines to bulk-add in one click.
        </p>
      </CardContent>
    </Card>
  </div>
</div>

{showDetails && selectedDomain && (
  <DomainDetailPanel
    selectedDomain={selectedDomain}
    fixRecommendations={fixRecommendations}
    detailRefreshing={detailRefreshing}
    detailRefreshError={detailRefreshError}
    dmarcUploading={dmarcUploading}
    dmarcUploadError={dmarcUploadError}
    dmarcFileRef={dmarcFileRef}
    uploadDmarcReport={uploadDmarcReport}
    fixDomain={fixDomain}
    onClose={onClosePanel}
  />
)}

    {/* Bulk Actions */}
    {selectedIds.length > 0 && (
      <div className="flex items-center gap-3 p-4 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/[0.08] via-orange-500/[0.04] to-transparent">
        <div className="w-9 h-9 rounded-lg bg-orange-500/15 text-orange-300 flex items-center justify-center font-bold text-sm">
          {selectedIds.length}
        </div>
        <span className="text-sm font-medium">{selectedIds.length === 1 ? 'domain' : 'domains'} selected</span>
        <div className="hairline flex-1" />
        <Button size="sm" className="btn-premium-primary border-0 h-8" onClick={bulkScan} disabled={scanning}>
          <Zap className="w-3.5 h-3.5 mr-1.5" /> Scan {selectedIds.length === 1 ? 'this' : 'these'}
        </Button>
        <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-300 hover:bg-red-500/10 hover:border-red-500/50" onClick={(e) => { deleteOpenerRef.current = e.currentTarget; setConfirmDelete(true); }}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setSelectedIds([])}>
          Clear
        </Button>
      </div>
    )}

    {/* T164 — KPI strip: portfolio at-a-glance for the domains you operate */}
    {domains.length > 0 && (() => {
      const total = domains.length;
      const verified = domains.filter((d: any) => d.verified).length;
      const scoredDomains = domains.filter((d: any) => typeof d.last_score === 'number');
      const avgScore = scoredDomains.length > 0
        ? Math.round(scoredDomains.reduce((s: number, d: any) => s + (d.last_score || 0), 0) / scoredDomains.length)
        : null;
      const atRisk = scoredDomains.filter((d: any) => scoreBand(d.last_score) !== 'passing').length;
      const avgScoreColor = avgScore == null ? 'text-muted-foreground' : avgScore >= PASSING_SCORE ? 'text-emerald-400' : avgScore >= WARNING_SCORE ? 'text-amber-400' : 'text-red-400';
      const stats = [
        { label: 'Total domains', value: total, hint: `${total === 1 ? 'domain' : 'domains'} on file`, icon: Globe, accent: 'text-foreground' },
        { label: 'Verified', value: verified, hint: `${total - verified} pending verification`, icon: CheckCircle, accent: verified === total ? 'text-emerald-400' : 'text-foreground' },
        { label: 'Avg health', value: avgScore == null ? '—' : `${avgScore}`, hint: avgScore == null ? 'No scans yet' : avgScore >= PASSING_SCORE ? 'Strong posture' : avgScore >= WARNING_SCORE ? 'Fixes recommended' : 'Action required', icon: Activity, accent: avgScoreColor },
        { label: 'At risk', value: atRisk, hint: atRisk === 0 ? `No domains below ${PASSING_SCORE}` : `${atRisk} below threshold`, icon: AlertTriangle, accent: atRisk > 0 ? 'text-amber-400' : 'text-emerald-400' },
      ];
      return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="premium-surface premium-card border-0 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</p>
                <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className={`font-display text-3xl font-bold tracking-tight tabular-nums ${s.accent}`}>{s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{s.hint}</p>
            </div>
          ))}
          {/* First-scan reassurance: a fresh portfolio legitimately scores
              red — say so instead of leaving silent alarm */}
          {atRisk === total && avgScore != null && (
            <p className="text-xs text-muted-foreground col-span-2 lg:col-span-4 leading-relaxed">
              Red at the start is normal — domains without SPF / DKIM / DMARC records score 0. Open a domain and run Get Fix Records for the SPF / DMARC records to publish, then re-scan; the score moves as DNS changes.
            </p>
          )}
        </div>
      );
    })()}

    {/* Filter pills */}
    {domains.length > 0 && (
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground mr-1">Filter:</p>
        {[
          { key: null, label: 'All', count: domains.length },
          { key: 'passing', label: 'Passing', count: filterByBand(domains, 'passing').length },
          { key: 'warnings', label: 'Warnings', count: filterByBand(domains, 'warnings').length },
          { key: 'failed', label: 'Failed', count: filterByBand(domains, 'failed').length },
        ].map((f) => {
          const active = domainFilter === f.key;
          return (
            <button
              key={f.label}
              onClick={() => setDomainFilter(f.key as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${active ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30' : 'bg-white/[0.03] text-muted-foreground border border-white/5 hover:bg-white/[0.06] hover:text-foreground'}`}
            >
              {f.label}
              <span className={`ml-1.5 ${active ? 'text-orange-400' : 'text-muted-foreground/70'}`}>{f.count}</span>
            </button>
          );
        })}
      </div>
    )}

    {/* Domain list — card rows, not a table */}
    {domains.length === 0 ? (
      <Card className="premium-surface premium-card border-0">
        <CardContent className="p-12 text-center">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-orange-500/10 text-orange-400 items-center justify-center mb-4">
            <Globe className="w-7 h-7" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight mb-1">No domains yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Add a domain in the search above to start scanning SPF / DKIM / DMARC posture.
          </p>
        </CardContent>
      </Card>
    ) : (
      <div className="space-y-2">
        {/* Select-all bar */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
          <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-foreground transition-colors">
            {selectedIds.length === domains.length && domains.length > 0
              ? <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
              : <Square className="w-3.5 h-3.5" />}
            <span>Select all</span>
          </button>
          <div className="hairline flex-1" />
          <span>{filterByBand(domains, domainFilter).length} shown</span>
        </div>

        {filterByBand(domains, domainFilter).map((domain: any) => {
          const score = domain.last_score;
          const hasScore = typeof score === 'number';
          const scoreColor = !hasScore ? '#94a3b8' : scoreBand(score) === 'passing' ? '#86efac' : scoreBand(score) === 'warnings' ? '#fbbf24' : '#fca5a5';
          const scoreRing = !hasScore ? 0 : Math.max(0, Math.min(100, score));
          const isSelected = selectedIds.includes(domain.id);
          const lastScanAgo = (() => {
            if (!domain.last_scan) return 'Never scanned';
            const ms = Date.now() - new Date(domain.last_scan).getTime();
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return 'Just now';
            if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
            if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
            return `${Math.floor(sec / 86400)}d ago`;
          })();
          const spf = recordState(domain.latest_scan, 'spf');
          const dkim = recordState(domain.latest_scan, 'dkim');
          const dmarc = recordState(domain.latest_scan, 'dmarc');
          const pillClass = (row: { tone: string }) =>
            row.tone === 'pass' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' :
            row.tone === 'fail' ? 'bg-red-500/10 text-red-300 border-red-500/30' :
            row.tone === 'warn' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
            'bg-white/5 text-muted-foreground border-white/5';

          return (
            <div
              key={domain.id}
              className={`premium-surface premium-card rounded-xl p-4 ${isSelected ? 'ring-2 ring-orange-500/40 border-orange-500/30' : 'border-0'}`}
            >
              <div className="flex items-center gap-4">
                {/* Selection */}
                <button
                  onClick={() => toggleSelect(domain.id)}
                  className="flex-shrink-0 w-7 h-7 rounded-md border border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5 flex items-center justify-center transition-colors"
                  aria-label={isSelected ? 'Deselect' : 'Select'}
                >
                  {isSelected
                    ? <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
                    : <Square className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>

                {/* Score ring */}
                <div className="relative w-14 h-14 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                    {hasScore && (
                      <circle
                        cx="18" cy="18" r="15.9155" fill="none"
                        stroke={scoreColor} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${scoreRing} ${100 - scoreRing}`}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-display text-base font-bold tabular-nums" style={{ color: scoreColor }}>
                      {hasScore ? score : '—'}
                    </span>
                  </div>
                </div>

                {/* Domain info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-display font-semibold tracking-tight truncate">{domain.name}</p>
                    {domain.verified ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                        <CheckCircle className="w-2.5 h-2.5" /> Verified
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { verifyOpenerRef.current = e.currentTarget; openVerifyModal(domain); }}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 flex-shrink-0 transition-colors"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> Verify
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {[{ k: 'SPF', v: spf }, { k: 'DKIM', v: dkim }, { k: 'DMARC', v: dmarc }].map((p) => (
                      <span key={p.k} title={p.v.tone === 'none' ? 'No scan data' : p.v.label} className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${pillClass(p.v)}`}>
                        {p.k}
                        {p.v.tone !== 'none' && <span className="opacity-70">·</span>}
                        {p.v.tone !== 'none' && <span>{p.v.tone === 'pass' ? '✓' : p.v.tone === 'fail' ? '✕' : '?'}</span>}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {lastScanAgo}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-orange-500/10 hover:text-orange-300" onClick={() => scanDomain(domain.id)} title="Re-scan">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-white/5" onClick={() => viewDomain(domain)} title="Inspect">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-white/5" onClick={() => fixDomain(domain.id)} title="Get fix records">
                    <Wrench className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

{showVerifyModal && verifyDomain && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowVerifyModal(false); }}>
    <DialogContent className="bg-background rounded-lg w-full max-w-lg max-h-[85vh] overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(verifyOpenerRef)}>
      <div className="mb-4">
        <DialogTitle className="text-lg font-bold">Verify Domain Ownership</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground mt-1">
          Prove ownership of {verifyDomain.name} with a DNS record to unlock email security features.
        </DialogDescription>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        To unlock email security features for <span className="font-medium">{verifyDomain.name}</span>, 
        you must prove ownership by adding a DNS record.
      </p>

      <div className="space-y-4">
        <div className="p-3 bg-muted rounded-lg">
          <p className="font-medium text-sm mb-2">TXT Record (Recommended)</p>
          <div className="text-xs space-y-1">
            <p><span className="text-muted-foreground">Name:</span> <code className="bg-background px-1">_nexusemail-verification</code></p>
            <p><span className="text-muted-foreground">Value:</span> <code className="bg-background px-1">_nexusemail-verification={verifyToken}</code></p>
          </div>
        </div>

        <div className="p-3 bg-muted rounded-lg">
          <p className="font-medium text-sm mb-2">CNAME Alternative</p>
          <div className="text-xs space-y-1">
            <p><span className="text-muted-foreground">Name:</span> <code className="bg-background px-1">verify.{verifyDomain.name}</code></p>
            <p><span className="text-muted-foreground">Points to:</span> <code className="bg-background px-1">{verifyToken}.verification.nexusemail.local</code></p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          After adding the record, click Verify below. DNS changes may take a few minutes to propagate.
        </p>

        <div className="flex gap-2">
          <Button onClick={verifyDomainOwnership} disabled={verifying}>
            {verifying ? 'Verifying...' : 'Verify Now'}
          </Button>
          <Button variant="ghost" onClick={() => setShowVerifyModal(false)}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
)}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Confirming clears the selection, so the bulk-actions bar
            // (and the opener) can unmount before focus restores. Fall
            // back to a stable heading when the opener is detached.
            const opener = deleteOpenerRef.current;
            if (opener && opener.isConnected) {
              e.preventDefault();
              opener.focus();
            } else if (heroHeadingRef.current) {
              e.preventDefault();
              heroHeadingRef.current.tabIndex = -1;
              heroHeadingRef.current.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length === 1 ? '1 domain' : `${selectedIds.length} domains`}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="text-sm text-muted-foreground">
                  This removes the domains and their scans. It cannot be undone.
                </p>
                <ul className="mt-2 space-y-0.5 text-sm text-foreground/90">
                  {shownNames.map((n: string) => (
                    <li key={n} className="font-mono">{n}</li>
                  ))}
                  {hiddenCount > 0 && <li>+ {hiddenCount} more…</li>}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                setConfirmDelete(false);
                deleteDomains();
              }}
            >
              Delete {selectedIds.length === 1 ? '1 domain' : `${selectedIds.length} domains`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
