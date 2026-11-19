"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Wrench, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import CopyButton from "@/components/dashboard/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
import { recordState, dnsEvidence, scoreBreakdownRows } from "@/lib/domainPanel";

/** Dedupe key: report IDs are only unique per reporter, so the key is
 * reporter-scoped; fallback keys live in a separate namespace. */
function reportKey(r: any): string {
  const org = r.report?.orgName || '?';
  if (r.report?.reportId) return JSON.stringify(['id', org, r.report.reportId]);
  return JSON.stringify(['fb', org, r.report?.begin || 0]);
}

/** Complete failing-source aggregation for one report — the stored
 * records carry every source, unlike the capped insights list. */
function failingSources(r: any): { ip: string; count: number }[] {
  const records = r.report?.records;
  if (Array.isArray(records)) {
    const byIp = new Map<string, number>();
    for (const rec of records) {
      if (rec.dkimAligned === true || rec.spfAligned === true) continue;
      const ip = rec.sourceIp || 'unknown';
      byIp.set(ip, (byIp.get(ip) || 0) + (rec.count || 0));
    }
    return Array.from(byIp.entries()).map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count);
  }
  return r.insights?.failingSources || [];
}

interface DomainDetailPanelProps {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  selectedDomain: any;
  fixRecommendations: any;
  detailRefreshing: boolean;
  detailRefreshError: string | null;
  dmarcUploading: boolean;
  dmarcUploadError: string | null;
  dmarcFileRef: React.RefObject<HTMLInputElement>;
  uploadDmarcReport: (domainId: number, file: File) => void;
  fixDomain: (domainId: number) => void;
  onClose: () => void;
}

/** Domain details panel (Inspect): DNS status cards, DMARC aggregate
 * reports, issue rows and fix recommendations. Presentational — all state
 * and request generation guards live in the Dashboard (they are part of
 * the domain-selection state machine covered by lib/domainPanel tests). */
export default function DomainDetailPanel({
  apiFetch,
  selectedDomain,
  fixRecommendations,
  detailRefreshing,
  detailRefreshError,
  dmarcUploading,
  dmarcUploadError,
  dmarcFileRef,
  uploadDmarcReport,
  fixDomain,
  onClose,
}: DomainDetailPanelProps) {
  const [openIssues, setOpenIssues] = useState<Set<string>>(new Set());
  const [selectorInput, setSelectorInput] = useState('');
  const [checkingSelector, setCheckingSelector] = useState(false);
  const [selectorResults, setSelectorResults] = useState<{ selector: string; found: boolean; text: string }[]>([]);
  const checkDkimSelector = async () => {
    const selector = selectorInput.trim();
    if (!selector || !apiFetch) return;
    setCheckingSelector(true);
    try {
      const res = await apiFetch(`${API_BASE}/domains/${selectedDomain.id}/dkim-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector }),
      });
      const data = await res.json();
      if (data.error) {
        setSelectorResults((r) => [{ selector, found: false, text: data.error }, ...r]);
      } else if (data.found) {
        const errText = Array.isArray(data.errors) && data.errors.length ? ` — ${data.errors[0]}` : '';
        const text = data.valid
          ? `Valid DKIM key — ${data.keySize || 'unknown size'} ${data.algorithm || ''}`.trim()
          : `DKIM record published but the key is not valid${errText}`;
        // Replace any earlier row for this selector — a re-check updates
        // its row (also keeps React sibling keys unique).
        setSelectorResults((r) => [{ selector: data.selector, found: data.valid, text }, ...r.filter((x) => x.selector !== data.selector)]);
        setSelectorInput('');
      } else {
        setSelectorResults((r) => [{ selector, found: false, text: data.message || data.error || 'Not published' }, ...r.filter((x) => x.selector !== selector)]);
      }
    } catch {
      setSelectorResults((r) => [{ selector, found: false, text: 'The check could not be run — try again.' }, ...r.filter((x) => x.selector !== selector)]);
    } finally {
      setCheckingSelector(false);
    }
  };
  const fixSectionRef = useRef<HTMLDivElement>(null);
  const prevFixRef = useRef<any>(null);
  // Fresh fix records appear below the fold — scroll them into view once
  // per result, so the operator sees the output of Get fix records
  useEffect(() => {
    if (fixRecommendations && fixRecommendations !== prevFixRef.current) {
      prevFixRef.current = fixRecommendations;
      fixSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [fixRecommendations]);
  const [openReports, setOpenReports] = useState<Set<string>>(new Set());
  const [showAllReports, setShowAllReports] = useState(false);
  const toggleIssue = (key: string) => {
    setOpenIssues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
  <div className="min-h-full bg-card">
    <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-card/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate font-mono text-[16px] font-semibold">{selectedDomain.name}</h2>
          {selectedDomain.verified && (
            <span className="rounded border border-emerald-500/20 bg-emerald-500/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-300">
              Owner verified
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Scan results and recommended fixes
          {selectedDomain.latest_scan?.scanned_at && (
            <> · {formatDateTime(selectedDomain.latest_scan.scanned_at)}</>
          )}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" className="max-sm:flex-1" onClick={() => fixDomain(selectedDomain.id)}>
          <Wrench className="w-3.5 h-3.5" /> Get fix records
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" title="Close">
          Close
        </Button>
      </div>
    </header>
    <div className="space-y-4 px-4 py-5 sm:px-6">
      {/* Authentication records: one row per record, never three cramped cards. */}
      {(() => {
        const spfRow = recordState(selectedDomain.latest_scan, 'spf');
        const dkimRow = recordState(selectedDomain.latest_scan, 'dkim');
        const dmarcRow = recordState(selectedDomain.latest_scan, 'dmarc');
        const cards = [
          { key: 'SPF', row: spfRow, desc: 'Authorizes senders for your domain', tip: "Sender Policy Framework - Specifies which mail servers can send email for your domain" },
          { key: 'DKIM', row: dkimRow, desc: 'Digital signature verification', tip: "DomainKeys Identified Mail - Cryptographic signature to verify email hasn't been tampered" },
          { key: 'DMARC', row: dmarcRow, desc: 'Policy for SPF/DKIM failures', tip: 'Domain-based Message Authentication - Policy for handling failed auth' }
        ];
        const dot = (tone: string) =>
          tone === 'pass' ? 'bg-emerald-400' :
          tone === 'fail' ? 'bg-red-400' :
          tone === 'warn' ? 'bg-amber-400' :
          'bg-white/25';
        const text = (tone: string) =>
          tone === 'pass' ? 'text-emerald-300' :
          tone === 'fail' ? 'text-red-300' :
          tone === 'warn' ? 'text-amber-300' :
          'text-muted-foreground';
        return (
          <section className="overflow-hidden rounded-xl border border-border" aria-label="Authentication records">
            {cards.map((c, i) => (
              <div
                key={c.key}
                className={`flex flex-wrap items-start gap-x-3 px-4 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <span aria-hidden="true" className={`mt-[7px] h-2 w-2 flex-shrink-0 rounded-full ${dot(c.row.tone)}`} />
                <span className="w-14 flex-shrink-0 pt-px font-mono text-[11.5px] font-medium text-muted-foreground">{c.key}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[12.5px] font-medium ${text(c.row.tone)}`}>{c.row.label}</p>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">{c.desc}</p>
                </div>
                <span className="cursor-help rounded border border-border px-1.5 text-[10px] leading-4 text-muted-foreground" title={c.tip} aria-label={c.tip}>?</span>
              </div>
            ))}
          </section>
        );
      })()}

      {/* Health score breakdown — makes the number auditable */}
      {(() => {
        const bd = scoreBreakdownRows(selectedDomain.latest_scan?.score_breakdown);
        if (!bd) return null;
        return (
          <section className="rounded-xl border border-border p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="section-label">Health score</p>
                <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                  {bd.total}<span className="text-[13px] font-normal text-muted-foreground"> / 100</span>
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">Weighted across records and policy</p>
            </div>
            <div className="mt-5 space-y-3">
              {bd.rows.map((r) => (
                <div key={r.key} title={r.hint}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{r.got}{r.max > 0 ? ` / ${r.max}` : ' (not scored)'}</span>
                  </div>
                  {r.max > 0 && (
                    <div className="h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${r.got >= r.max * 0.7 ? 'bg-emerald-400' : r.got > 0 ? 'bg-amber-400' : 'bg-red-400/70'}`}
                        style={{ width: `${Math.min(100, Math.round((r.got / r.max) * 100))}%` }}
                      />
                    </div>
                  )}
                  {r.max === 0 && (
                    <p className="text-[11px] text-muted-foreground">{r.hint}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
              Score = SPF + DKIM + DMARC (incl. impersonation penalties) + TLS-RPT, clamped to 100. Hover a row for its weight; the fixes below raise the corresponding bar.
            </p>
          </section>
        );
      })()}

      {/* DNS evidence — shows exactly what the scanner queried and what
          came back, so an all-red result is visibly live-DNS truth, not a
          scanner failure. */}
      {(() => {
        const evidence = dnsEvidence(selectedDomain.latest_scan, selectedDomain.name);
        if (!evidence.length) return null;
        const nonePublished = evidence.filter((r) => ['SPF', 'DKIM', 'DMARC'].includes(r.check) && !r.found).length === 3;
        return (
          <section className="overflow-hidden rounded-xl border border-border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[13px] font-medium">What we checked · live DNS</h3>
              {selectedDomain.latest_scan?.scanned_at && (
                <span className="text-[11px] text-muted-foreground">
                  {formatDateTime(selectedDomain.latest_scan.scanned_at)}
                </span>
              )}
            </header>
            {nonePublished && (
              <p className="mx-4 mt-3 rounded-md border border-border bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                No email authentication records are published for this domain yet — this result mirrors your live DNS,
                not a scanner error. Run Get Fix Records below for the exact records to add at your DNS provider, then re-scan.
              </p>
            )}
            <div className="overflow-x-auto px-4 py-2">
              <table className="w-full text-[11.5px]">
                <tbody>
                  {evidence.map((r) => (
                    <tr key={r.check} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 font-medium">{r.check}</td>
                      <td className="hidden whitespace-nowrap py-2 pr-3 font-mono text-[11px] text-muted-foreground sm:table-cell">{r.query}</td>
                      <td className={`break-all py-2 ${r.found ? 'text-foreground' : 'text-muted-foreground'}`}>{r.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-4 py-3">
              <label htmlFor="dkim-selector" className="text-[11px] font-medium text-muted-foreground">Check a specific DKIM selector</label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="dkim-selector"
                  className="h-9 flex-1 text-[12px]"
                  placeholder="e.g. resend, google, selector1"
                  value={selectorInput}
                  onChange={(e) => setSelectorInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && checkDkimSelector()}
                />
                <Button size="sm" variant="outline" className="h-9" onClick={checkDkimSelector} disabled={checkingSelector || !selectorInput.trim()}>
                  {checkingSelector ? 'Checking…' : 'Check selector'}
                </Button>
              </div>
              {selectorResults.map((r) => (
                <p key={r.selector + r.text} className={`mt-2 text-[11.5px] ${r.found ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                  <span className="font-mono">{r.selector}</span> — {r.text}
                </p>
              ))}
            </div>
          </section>
        );
      })()}

      {/* DMARC Aggregate Reports (issue #64): upload RFC 7489 XML */}
      <section className="overflow-hidden rounded-xl border border-border">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[13px] font-medium">DMARC Aggregate Reports</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Upload RFC 7489 XML from your rua mailbox</p>
          </div>
          <div>
            <input
              ref={dmarcFileRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f && selectedDomain) uploadDmarcReport(selectedDomain.id, f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" disabled={dmarcUploading} onClick={() => dmarcFileRef.current && dmarcFileRef.current.click()}>
              <Upload className="w-3.5 h-3.5" /> {dmarcUploading ? 'Uploading...' : 'Upload XML'}
            </Button>
          </div>
        </header>
        <div className="px-4 py-3">
        {dmarcUploadError && (
          <p className="mb-2 text-[11.5px] text-red-400">{dmarcUploadError}</p>
        )}
        {detailRefreshError ? (
          <p className="mb-2 text-[11.5px] text-red-400">{detailRefreshError} — the report list below may be incomplete.</p>
        ) : null}
        {detailRefreshing && !detailRefreshError ? (
          <p className="mb-2 text-[11.5px] text-muted-foreground">Loading aggregate reports…</p>
        ) : null}
        {!detailRefreshing && selectedDomain.dmarc_reports?.length > 0 ? (
          (() => {
            // duplicate ingests of the same report collapse into one row —
            // the freshest copy wins (insights may differ if DNS changed
            // between ingests)
            const groups = new Map<string, any>();
            for (const r of selectedDomain.dmarc_reports) {
              const key = reportKey(r);
              const prev = groups.get(key);
              if (!prev || (r.id ?? 0) > (prev.id ?? 0)) groups.set(key, r);
            }
            const reports = Array.from(groups.values()).sort((a: any, b: any) => (b.report?.begin || 0) - (a.report?.begin || 0));
            const sourceCount = new Set(
              reports.flatMap((r: any) => failingSources(r).map((s: any) => s.ip))
            ).size;
            const visible = showAllReports ? reports : reports.slice(0, 10);
            return (
              <div>
                <p className="text-[11.5px] text-muted-foreground">
                  {reports.length} report{reports.length === 1 ? '' : 's'} · {sourceCount} unique failing source{sourceCount === 1 ? '' : 's'}
                  {selectedDomain.dmarc_reports.length > reports.length && (
                    <> · {selectedDomain.dmarc_reports.length - reports.length} duplicate ingest{selectedDomain.dmarc_reports.length - reports.length === 1 ? '' : 's'} collapsed</>
                  )}
                </p>
                <div className="mt-1">
                {visible.map((r: any) => {
                  const ins = r.insights || {};
                  const sources = failingSources(r);
                  const unauthorized = (ins.extRecChecks || []).filter((c: any) => c.status === 'not_authorized');
                  const unresolved = (ins.extRecChecks || []).filter((c: any) => c.status === 'unknown');
                  const key = reportKey(r);
                  const open = openReports.has(key);
                  return (
                    <div key={key} className="border-b border-border/70 last:border-0">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenReports((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        aria-expanded={open}
                        className="flex w-full items-start gap-3 px-0 py-3 text-left transition-colors hover:bg-white/[0.02]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-medium">{r.report?.orgName || 'Unknown reporter'}</span>
                            <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                              {r.report?.begin ? formatDateTime(new Date(r.report.begin * 1000)) : ''}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                            {ins.totalMessages ?? 0} messages · {ins.passingMessages ?? 0} aligned · {ins.failingMessages ?? 0} failed
                            {sources.length > 0 && (
                              <> · top fail source: {sources[0].ip} ({sources[0].count})</>
                            )}
                          </span>
                        </span>
                        {open
                          ? <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                          : <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
                      </button>
                      {open && (
                        <div className="space-y-1.5 pb-3 pl-0 text-[11.5px]">
                          <p className="text-muted-foreground">Report ID: {r.report?.reportId || '—'}</p>
                          {ins.reportedPolicyDomain && (
                            <p className="text-muted-foreground">Policy domain: {ins.reportedPolicyDomain}</p>
                          )}
                          {sources.length > 0 && (
                            <div>
                              <p className="font-medium">Failing sources</p>
                              <ul className="space-y-0.5 text-muted-foreground">
                                {sources.map((s: any, si: number) => (
                                  <li key={si}>{s.ip} — {s.count} message{s.count === 1 ? '' : 's'}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {unauthorized.length > 0 && (
                            <div className="text-amber-300">
                              External report destination(s) lack authorization (RFC 7489 §7.1): {unauthorized.map((c: any) => c.destination).join(', ')}
                            </div>
                          )}
                          {unresolved.length > 0 && (
                            <div className="text-muted-foreground">
                              Reporting-destination authorization could not be verified (DNS lookup failed) for: {unresolved.map((c: any) => c.destination).join(', ')}
                            </div>
                          )}
                          {sources.length === 0 && unauthorized.length === 0 && unresolved.length === 0 && (
                            (ins.extRecChecks || []).length > 0 ? (
                              <p className="text-muted-foreground">No failing sources; all reporting destinations verified authorized.</p>
                            ) : (
                              <p className="text-muted-foreground">No failing sources in this report.</p>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                {reports.length > 10 && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAllReports(true)} disabled={showAllReports}>
                    {showAllReports ? `Showing all ${reports.length}` : `Show all ${reports.length} reports`}
                  </Button>
                )}
              </div>
            );
          })()
        ) : !detailRefreshing && !detailRefreshError ? (
          <p className="text-[11.5px] leading-5 text-muted-foreground">No aggregate reports ingested yet. Export the XML your inbox receives at the rua address and upload it here.</p>
        ) : null}
        </div>
      </section>

      {/* Issues — expandable rows with the fix inline (hover tooltips
          are invisible on touch/keyboard) */}
      {selectedDomain.issues?.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
          <header className="border-b border-amber-500/20 px-4 py-3">
            <h3 className="text-[13px] font-medium">Issues found</h3>
          </header>
          {selectedDomain.issues.map((issue: any, i: number) => {
            const key = issue.type || String(i);
            const fixText: Record<string, string> = {
              'SPF': "Add a TXT record at the domain root: v=spf1 include:_spf.yourdomain.com ~all (adjust the include to your mail provider).",
              'DMARC': "Add a TXT record at _dmarc.yourdomain.com: v=DMARC1; p=quarantine; rua=mailto:reports@yourdomain.com.",
              'MTA-STS': "Add a TXT record at _mta-sts.yourdomain.com with your SMTP TLS policy id.",
              'TLS-RPT': "Add a TXT record at _smtp._tls.yourdomain.com: v=TLSRPTv1; rua=mailto:reports@yourdomain.com.",
            };
            const recKey: Record<string, string> = { 'SPF': 'spf', 'DMARC': 'dmarc', 'MTA-STS': 'mta_sts', 'TLS-RPT': 'tls_rpt' };
            const rec = fixRecommendations?.recommended_records?.[recKey[issue.type]];
            const open = openIssues.has(key + i);
            return (
              <div key={i} className="border-b border-amber-500/15 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleIssue(key + i)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-amber-500/[0.06]"
                >
                  {open ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-amber-400" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-amber-400" />}
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                  <span className="flex-1 text-[12.5px] leading-5">{issue.message || issue.type || issue}</span>
                  {issue.type && (
                    <span className="flex-shrink-0 text-[11px] text-amber-300">{open ? "Hide fix" : "Show fix"}</span>
                  )}
                </button>
                {open && (
                  <div className="space-y-2 px-4 pb-3 pl-10">
                    <p className="text-[11.5px] leading-5 text-foreground/90">{fixText[issue.type] || "Open the Get Fix Records output below for the exact record to publish."}</p>
                    {rec?.recommended && (
                      <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2 font-mono text-[11px]">
                        <span className="flex-1 break-all">{rec.recommended}</span>
                        <CopyButton value={rec.recommended} label="Copy" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Recommendations Section */}
      {fixRecommendations && (
        <section ref={fixSectionRef} className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.05]">
          <header className="border-b border-primary/20 px-4 py-3">
            <h3 className="text-[13px] font-medium">Recommended DNS records</h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Publish these at your DNS provider, then re-scan.</p>
          </header>
          <div className="divide-y divide-border/60">
            {fixRecommendations.recommended_records?.spf && (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 flex-shrink-0 font-mono text-[11px] text-muted-foreground">SPF</span>
                <span className="flex-1 break-all font-mono text-[11.5px]">{fixRecommendations.recommended_records.spf.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.spf.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.dmarc && (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 flex-shrink-0 font-mono text-[11px] text-muted-foreground">DMARC</span>
                <span className="flex-1 break-all font-mono text-[11.5px]">{fixRecommendations.recommended_records.dmarc.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.dmarc.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.mta_sts && (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 flex-shrink-0 font-mono text-[11px] text-muted-foreground">MTA-STS</span>
                <span className="flex-1 break-all font-mono text-[11.5px]">{fixRecommendations.recommended_records.mta_sts.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.mta_sts.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.tls_rpt && (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 flex-shrink-0 font-mono text-[11px] text-muted-foreground">TLS-RPT</span>
                <span className="flex-1 break-all font-mono text-[11.5px]">{fixRecommendations.recommended_records.tls_rpt.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.tls_rpt.recommended} label="Copy" />
              </div>
            )}
          </div>
          <footer className="border-t border-primary/20 px-4 py-2.5 text-[11px] text-muted-foreground">
            Provider: {fixRecommendations.email_provider?.provider} · Auto-fix: {fixRecommendations.auto_fix_supported ? 'Supported' : 'Manual only'}
          </footer>
        </section>
      )}
    </div>
  </div>
  );
}
