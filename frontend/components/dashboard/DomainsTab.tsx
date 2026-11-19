"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search, AlertTriangle, CheckCircle, Globe, Plus, RefreshCw,
  Zap, Eye, Clock, Wrench, Trash2, CheckSquare, Square
} from "lucide-react";
import DomainDetailPanel from "@/components/dashboard/DomainDetailPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, dialogFocusReturn,
} from "@/components/ui/dialog";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { TabHeader } from "@/components/dashboard/settings-ui";
import { PASSING_SCORE, WARNING_SCORE, scoreBand, filterByBand } from "@/lib/scores";
import { recordState } from "@/lib/domainPanel";
import { cn } from "@/lib/utils";

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

/** Domains tab: add form, portfolio stats, status filters and the domain
 * table. Selection + deletion stay in the Dashboard (they drive the
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

  // Slide-over drawer: modal dialog semantics — Escape closes, focus moves
  // in on open, Tab is contained, and focus returns to the opener (the
  // Inspect button) on dismissal.
  const drawerRef = useRef<HTMLDivElement>(null);
  const inspectOpenerRef = useRef<HTMLButtonElement>(null);
  // onClosePanel is recreated by the parent each render — keep the latest
  // in a ref so the focus lifecycle below keys ONLY on open/close state.
  const onClosePanelRef = useRef(onClosePanel);
  onClosePanelRef.current = onClosePanel;
  useEffect(() => {
    if (!showDetails) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClosePanelRef.current(); };
    window.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      const opener = inspectOpenerRef.current;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [showDetails]);
  const trapDrawerTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const c = drawerRef.current;
    if (!c) return;
    const focusables = Array.from(
      c.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!c.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <>
      <TabHeader
        headingRef={heroHeadingRef}
        title="Domains"
        description="SPF, DKIM and DMARC posture for the domains you operate."
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Add one domain, or paste several"
                className="w-full pl-8 sm:w-[320px]"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addDomain()}
              />
            </div>
            <Button onClick={addDomain} disabled={addBusy}>
              {addBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add &amp; scan
            </Button>
          </div>
        }
      />

      {addDomainError && (
        <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {addDomainError}
        </div>
      )}
      {addDomainSuccess && !addDomainError && (
        <div className="mt-4 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-300">
          {addDomainSuccess}
        </div>
      )}

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-[12px] font-medium">
            {selectedIds.length} {selectedIds.length === 1 ? 'domain' : 'domains'} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={bulkScan} disabled={scanning}>
              <Zap className="w-3.5 h-3.5" /> Scan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
              onClick={(e) => { deleteOpenerRef.current = e.currentTarget; setConfirmDelete(true); }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Portfolio stats */}
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
          { label: 'Domains', value: total, hint: 'on file', accent: 'text-foreground' },
          { label: 'Verified', value: verified, hint: `${total - verified} pending`, accent: verified === total ? 'text-emerald-400' : 'text-foreground' },
          { label: 'Average health', value: avgScore == null ? '—' : `${avgScore}`, hint: avgScore == null ? 'No scans yet' : avgScore >= PASSING_SCORE ? 'Strong posture' : avgScore >= WARNING_SCORE ? 'Fixes recommended' : 'Action required', accent: avgScoreColor },
          { label: 'At risk', value: atRisk, hint: `below ${PASSING_SCORE}`, accent: atRisk > 0 ? 'text-amber-400' : 'text-emerald-400' },
        ];
        return (
          <>
            <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4">
              {stats.map((s, i) => (
                <div
                  key={s.label}
                  className={cn(
                    "px-4 py-3.5",
                    i < 2 && "border-b border-border sm:border-b-0",
                    i % 2 === 1 && "border-l border-border"
                  )}
                >
                  <p className="text-[12px] text-muted-foreground">{s.label}</p>
                  <p className={cn("mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.02em]", s.accent)}>{s.value}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</p>
                </div>
              ))}
            </div>
            {atRisk === total && avgScore != null && (
              <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
                New portfolios start at 0 until SPF, DKIM and DMARC records exist. Open a domain and run Get fix records, then re-scan.
              </p>
            )}
          </>
        );
      })()}

      {/* Filter */}
      {domains.length > 0 && (
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground">Filter</span>
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
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
                  className={`h-7 rounded px-2.5 text-[12px] font-medium transition-colors ${active ? 'bg-white/[0.07] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f.label}
                  <span className={`ml-1.5 tabular-nums ${active ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>{f.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Domain table */}
      {domains.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Globe className="w-5 h-5" />
          </div>
          <h3 className="text-[14px] font-semibold">No domains yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-5 text-muted-foreground">
            Add a domain above to start scanning SPF, DKIM and DMARC posture.
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-white/[0.02] text-left text-[12px] font-medium text-muted-foreground">
                  <th className="w-10 px-3 py-2.5">
                    <button
                      onClick={toggleSelectAll}
                      aria-label={selectedIds.length === domains.length && domains.length > 0 ? 'Deselect all' : 'Select all'}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selectedIds.length === domains.length && domains.length > 0
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Domain</th>
                  <th className="px-3 py-2.5 font-medium">Records</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Last scan</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filterByBand(domains, domainFilter).map((domain: any) => {
                  const score = domain.last_score;
                  const hasScore = typeof score === 'number';
                  const band = hasScore ? scoreBand(score) : null;
                  const scoreText = band === 'passing' ? 'text-emerald-400' : band === 'warnings' ? 'text-amber-400' : band === 'failed' ? 'text-red-400' : 'text-muted-foreground';
                  const scoreBar = band === 'passing' ? 'bg-emerald-400' : band === 'warnings' ? 'bg-amber-400' : band === 'failed' ? 'bg-red-400' : 'bg-white/20';
                  const scoreRing = !hasScore ? 0 : Math.max(0, Math.min(100, score));
                  const isSelected = selectedIds.includes(domain.id);
                  const lastScanAgo = (() => {
                    if (!domain.last_scan) return 'Never';
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
                    row.tone === 'pass' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' :
                    row.tone === 'fail' ? 'border-red-500/25 bg-red-500/10 text-red-300' :
                    row.tone === 'warn' ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' :
                    'border-border bg-white/[0.03] text-muted-foreground';

                  return (
                    <tr
                      key={domain.id}
                      className={`border-b border-border last:border-0 transition-colors hover:bg-white/[0.02] ${isSelected ? 'bg-primary/[0.04]' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <button
                          onClick={() => toggleSelect(domain.id)}
                          className="flex h-4 w-4 items-center justify-center rounded border border-input hover:border-primary/50"
                          aria-label={isSelected ? 'Deselect' : 'Select'}
                        >
                          {isSelected
                            ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                            : <Square className="w-3.5 h-3.5 text-muted-foreground/50" />}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap font-mono text-[12.5px] font-medium">{domain.name}</span>
                          {domain.verified ? (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                              <CheckCircle className="w-3 h-3" /> Verified
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { verifyOpenerRef.current = e.currentTarget; openVerifyModal(domain); }}
                              className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
                            >
                              <AlertTriangle className="w-3 h-3" /> Verify
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          {[{ k: 'SPF', v: spf }, { k: 'DKIM', v: dkim }, { k: 'DMARC', v: dmarc }].map((p) => (
                            <span key={p.k} title={p.v.tone === 'none' ? 'No scan data' : p.v.label} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${pillClass(p.v)}`}>
                              {p.k}
                              {p.v.tone !== 'none' && <span className="opacity-60">·</span>}
                              {p.v.tone !== 'none' && <span>{p.v.tone === 'pass' ? '✓' : p.v.tone === 'fail' ? '✕' : '?'}</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-7 text-right text-[12px] font-medium tabular-nums ${scoreText}`}>
                            {hasScore ? score : '—'}
                          </span>
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                            <div className={`h-full rounded-full ${scoreBar}`} style={{ width: `${scoreRing}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1" title={domain.last_scan ? new Date(domain.last_scan).toISOString() : undefined}>
                          <Clock className="w-3 h-3" /> {lastScanAgo}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => scanDomain(domain.id)} title="Re-scan">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { inspectOpenerRef.current = e.currentTarget; viewDomain(domain); }} title="Inspect">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => fixDomain(domain.id)} title="Get fix records">
                            <Wrench className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showDetails && selectedDomain && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${selectedDomain.name} details`}>
          <div className="absolute inset-0 bg-black/60 drawer-backdrop" onClick={onClosePanel} />
          <div ref={drawerRef} onKeyDown={trapDrawerTab} className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-border bg-card shadow-2xl drawer-slide-in">
            <DomainDetailPanel
              key={selectedDomain.id}
              apiFetch={apiFetch}
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
          </div>
        </div>
      )}

      {showVerifyModal && verifyDomain && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowVerifyModal(false); }}>
          <DialogContent className="max-h-[85vh] w-full max-w-lg overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(verifyOpenerRef)}>
            <div>
              <DialogTitle>Verify domain ownership</DialogTitle>
              <DialogDescription className="mt-1">
                Add one DNS record to prove you own {verifyDomain.name} and unlock Brand Protection.
              </DialogDescription>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-border bg-white/[0.02] p-3">
                <p className="text-[12px] font-medium">TXT record (recommended)</p>
                <dl className="mt-2 space-y-1 text-[11.5px]">
                  <div className="flex gap-2"><dt className="w-12 shrink-0 text-muted-foreground">Name</dt><dd className="break-all font-mono">_nexusemail-verification</dd></div>
                  <div className="flex gap-2"><dt className="w-12 shrink-0 text-muted-foreground">Value</dt><dd className="break-all font-mono">_nexusemail-verification={verifyToken}</dd></div>
                </dl>
              </div>

              <div className="rounded-md border border-border bg-white/[0.02] p-3">
                <p className="text-[12px] font-medium">CNAME alternative</p>
                <dl className="mt-2 space-y-1 text-[11.5px]">
                  <div className="flex gap-2"><dt className="w-12 shrink-0 text-muted-foreground">Name</dt><dd className="break-all font-mono">verify.{verifyDomain.name}</dd></div>
                  <div className="flex gap-2"><dt className="w-12 shrink-0 text-muted-foreground">Target</dt><dd className="break-all font-mono">{verifyToken}.verification.nexusemail.local</dd></div>
                </dl>
              </div>

              <p className="text-[12px] leading-5 text-muted-foreground">
                DNS changes can take a few minutes to propagate. Publish the record, then verify.
              </p>

              <div className="flex gap-2 pt-1">
                <Button onClick={verifyDomainOwnership} disabled={verifying}>
                  {verifying ? 'Verifying…' : 'Verify now'}
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
                <p className="text-[13px] text-muted-foreground">
                  This removes the domains and their scans. It cannot be undone.
                </p>
                <ul className="mt-2 space-y-0.5 text-[13px] text-foreground/90">
                  {shownNames.map((n: string) => (
                    <li key={n} className="font-mono text-[12px]">{n}</li>
                  ))}
                  {hiddenCount > 0 && <li>+ {hiddenCount} more…</li>}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
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
