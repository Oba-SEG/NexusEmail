"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Wrench, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import CopyButton from "@/components/dashboard/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
import { recordState, recordToneClass, dnsEvidence, scoreBreakdownRows } from "@/lib/domainPanel";

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
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
      <div className="min-w-0">
        <h2 className="truncate font-mono text-[15px] font-semibold">{selectedDomain.name}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Scan results and recommended fixes</p>
      </div>
      <div className="flex flex-shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={() => fixDomain(selectedDomain.id)}>
          <Wrench className="w-3.5 h-3.5" /> Get fix records
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
    <div className="space-y-4 px-5 py-4">
      {/* DNS Status Cards */}
      {(() => {
        const spfRow = recordState(selectedDomain.latest_scan, 'spf');
        const dkimRow = recordState(selectedDomain.latest_scan, 'dkim');
        const dmarcRow = recordState(selectedDomain.latest_scan, 'dmarc');
        const cards = [
          { key: 'SPF', row: spfRow, desc: 'Authorizes senders for your domain', tip: "Sender Policy Framework - Specifies which mail servers can send email for your domain" },
          { key: 'DKIM', row: dkimRow, desc: 'Digital signature verification', tip: "DomainKeys Identified Mail - Cryptographic signature to verify email hasn't been tampered" },
          { key: 'DMARC', row: dmarcRow, desc: 'Policy for SPF/DKIM failures', tip: 'Domain-based Message Authentication - Policy for handling failed auth' }
        ];
        return (
          <div className="grid gap-2 md:grid-cols-3">
            {cards.map((c) => (
              <div key={c.key} className={`rounded-md border p-3 ${recordToneClass[c.row.tone]}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-muted-foreground">{c.key}</p>
                  <span className="cursor-help text-[11px] text-muted-foreground" title={c.tip}>?</span>
                </div>
                <p className="mt-1 text-[13px] font-semibold">{c.row.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Health score breakdown — makes the number auditable */}
      {(() => {
        const bd = scoreBreakdownRows(selectedDomain.latest_scan?.score_breakdown);
        if (!bd) return null;
        return (
          <div className="rounded-lg border border-border bg-white/[0.02] p-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="font-medium text-sm">Health score</p>
              <p className="text-[20px] font-semibold tabular-nums tracking-[-0.02em]">{bd.total}<span className="text-sm text-muted-foreground font-normal">/100</span></p>
            </div>
            <div className="space-y-2">
              {bd.rows.map((r) => (
                <div key={r.key} title={r.hint}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-muted-foreground tabular-nums">{r.got}{r.max > 0 ? ` / ${r.max}` : ' (not scored)'}</span>
                  </div>
                  {r.max > 0 && (
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${r.got >= r.max * 0.7 ? 'bg-emerald-500' : r.got > 0 ? 'bg-amber-500' : 'bg-red-500/60'}`}
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
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Score = SPF + DKIM + DMARC (incl. impersonation penalties) + TLS-RPT, clamped to 100. Hover a row for its weight; the fixes below raise the corresponding bar.
            </p>
          </div>
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
          <div className="rounded-lg border border-border bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-medium">What we checked · live DNS</p>
              {selectedDomain.latest_scan?.scanned_at && (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(selectedDomain.latest_scan.scanned_at)}
                </span>
              )}
            </div>
            {nonePublished && (
              <p className="mb-3 rounded-md border border-border bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                No email authentication records are published for this domain yet — this result mirrors your live DNS,
                not a scanner error. Run Get Fix Records below for the exact records to add at your DNS provider, then re-scan.
              </p>
            )}
            <table className="w-full text-[12px]">
              <tbody>
                {evidence.map((r) => (
                  <tr key={r.check} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{r.check}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{r.query}</td>
                    <td className={`py-1.5 text-xs break-all ${r.found ? 'text-foreground' : 'text-muted-foreground'}`}>{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 pt-3 border-t border-border/60">
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 text-[12px]"
                  placeholder="Check a specific DKIM selector (e.g. resend, google, selector1)"
                  value={selectorInput}
                  onChange={(e) => setSelectorInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && checkDkimSelector()}
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={checkDkimSelector} disabled={checkingSelector || !selectorInput.trim()}>
                  {checkingSelector ? 'Checking…' : 'Check selector'}
                </Button>
              </div>
              {selectorResults.map((r) => (
                <p key={r.selector + r.text} className={`text-xs mt-2 ${r.found ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                  <span className="font-mono">{r.selector}</span> — {r.text}
                </p>
              ))}
            </div>
          </div>
        );
      })()}

      {/* DMARC Aggregate Reports (issue #64): upload RFC 7489 XML */}
      <div className="rounded-lg border border-border bg-white/[0.02] p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-medium">DMARC Aggregate Reports</p>
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
              <Upload className="w-4 h-4 mr-1" /> {dmarcUploading ? 'Uploading...' : 'Upload XML'}
            </Button>
          </div>
        </div>
        {dmarcUploadError && (
          <p className="text-xs text-red-500 mb-2">{dmarcUploadError}</p>
        )}
        {detailRefreshError ? (
          <p className="text-xs text-red-500 mb-2">{detailRefreshError} — the report list below may be incomplete.</p>
        ) : null}
        {detailRefreshing && !detailRefreshError ? (
          <p className="text-xs text-muted-foreground mb-2">Loading aggregate reports…</p>
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
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {reports.length} report{reports.length === 1 ? '' : 's'} · {sourceCount} unique failing source{sourceCount === 1 ? '' : 's'}
                  {selectedDomain.dmarc_reports.length > reports.length && (
                    <> · {selectedDomain.dmarc_reports.length - reports.length} duplicate ingest{selectedDomain.dmarc_reports.length - reports.length === 1 ? '' : 's'} collapsed</>
                  )}
                </p>
                {visible.map((r: any) => {
                  const ins = r.insights || {};
                  const sources = failingSources(r);
                  const unauthorized = (ins.extRecChecks || []).filter((c: any) => c.status === 'not_authorized');
                  const unresolved = (ins.extRecChecks || []).filter((c: any) => c.status === 'unknown');
                  const key = reportKey(r);
                  const open = openReports.has(key);
                  return (
                    <div key={key} className="rounded border text-xs overflow-hidden">
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
                        className="w-full p-2 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{r.report?.orgName || 'Unknown reporter'}</span>
                          <span className="text-muted-foreground flex-shrink-0">
                            {r.report?.begin ? formatDateTime(new Date(r.report.begin * 1000)) : ''}
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {ins.totalMessages ?? 0} messages · {ins.passingMessages ?? 0} aligned · {ins.failingMessages ?? 0} failed
                          {sources.length > 0 && (
                            <> · top fail source: {sources[0].ip} ({sources[0].count})</>
                          )}
                        </div>
                      </button>
                      {open && (
                        <div className="px-2 pb-2 space-y-2 border-t pt-2">
                          <p className="text-muted-foreground">Report ID: {r.report?.reportId || '—'}</p>
                          {ins.reportedPolicyDomain && (
                            <p className="text-muted-foreground">Policy domain: {ins.reportedPolicyDomain}</p>
                          )}
                          {sources.length > 0 && (
                            <div>
                              <p className="font-medium mb-1">Failing sources</p>
                              <ul className="space-y-0.5 text-muted-foreground">
                                {sources.map((s: any, si: number) => (
                                  <li key={si}>{s.ip} — {s.count} message{s.count === 1 ? '' : 's'}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {unauthorized.length > 0 && (
                            <div className="text-amber-500">
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
                {reports.length > 10 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllReports(true)} disabled={showAllReports}>
                    {showAllReports ? `Showing all ${reports.length}` : `Show all ${reports.length} reports`}
                  </Button>
                )}
              </div>
            );
          })()
        ) : !detailRefreshing && !detailRefreshError ? (
          <p className="text-xs text-muted-foreground">No aggregate reports ingested yet. Export the XML your inbox receives at the rua address and upload it here.</p>
        ) : null}
      </div>

      {/* Issues — expandable rows with the fix inline (hover tooltips
          are invisible on touch/keyboard) */}
      {selectedDomain.issues?.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-[13px] font-medium">Issues found</p>
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
              <div key={i} className="rounded bg-amber-500/10 border border-amber-500/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleIssue(key + i)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 p-2 text-left cursor-pointer hover:bg-amber-500/15 transition-colors"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-amber-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="text-sm flex-1">{issue.message || issue.type || issue}</span>
                  {issue.type && (
                    <span className="text-xs text-amber-300 flex-shrink-0">{open ? "Hide fix" : "Show fix"}</span>
                  )}
                </button>
                {open && (
                  <div className="px-2 pb-2 pl-8 space-y-2">
                    <p className="text-xs text-foreground/90">{fixText[issue.type] || "Open the Get Fix Records output below for the exact record to publish."}</p>
                    {rec?.recommended && (
                      <div className="flex items-center gap-2 p-2 rounded bg-background border font-mono text-xs">
                        <span className="flex-1 break-all">{rec.recommended}</span>
                        <CopyButton value={rec.recommended} label="Copy" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recommendations Section */}
      {fixRecommendations && (
        <div ref={fixSectionRef} className="mt-4 space-y-3 rounded-lg border border-primary/25 bg-primary/[0.06] p-4">
          <p className="text-[13px] font-medium">Recommended DNS records</p>
          <div className="grid gap-2 text-xs font-mono">
            {fixRecommendations.recommended_records?.spf && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-black/20 p-2">
                <span className="text-muted-foreground flex-shrink-0">SPF:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.spf.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.spf.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.dmarc && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-black/20 p-2">
                <span className="text-muted-foreground flex-shrink-0">DMARC:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.dmarc.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.dmarc.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.mta_sts && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-black/20 p-2">
                <span className="text-muted-foreground flex-shrink-0">MTA-STS:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.mta_sts.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.mta_sts.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.tls_rpt && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-black/20 p-2">
                <span className="text-muted-foreground flex-shrink-0">TLS-RPT:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.tls_rpt.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.tls_rpt.recommended} label="Copy" />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Provider: {fixRecommendations.email_provider?.provider} | Auto-fix: {fixRecommendations.auto_fix_supported ? 'Supported' : 'Manual only'}
          </p>
        </div>
      )}
    </div>
  </div>
  );
}
