"use client";

import { useState } from "react";
import { Upload, Wrench, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import CopyButton from "@/components/dashboard/CopyButton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { recordState, recordToneClass } from "@/lib/domainPanel";

interface DomainDetailPanelProps {
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
  const toggleIssue = (key: string) => {
    setOpenIssues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
  <Card className="border-orange-500/50 mb-6">
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <div>
        <CardTitle className="text-lg">{selectedDomain.name}</CardTitle>
        <CardDescription>Scan Results & Recommended Fixes</CardDescription>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => fixDomain(selectedDomain.id)}>
          <Wrench className="w-4 h-4 mr-1" /> Get Fix Records
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </CardHeader>
    <CardContent>
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
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            {cards.map((c) => (
              <div key={c.key} className={`p-4 rounded-lg border ${recordToneClass[c.row.tone]}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">{c.key}</p>
                  <span className="text-xs cursor-help" title={c.tip}>?</span>
                </div>
                <p className="font-semibold">{c.row.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* DMARC Aggregate Reports (issue #64): upload RFC 7489 XML */}
      <div className="mb-4 p-4 rounded-lg border bg-background">
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-sm">DMARC Aggregate Reports</p>
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
          <div className="space-y-2">
            {selectedDomain.dmarc_reports.map((r: any, i: number) => {
              const ins = r.insights || {};
              const unauthorized = (ins.extRecChecks || []).filter((c: any) => c.status === 'not_authorized');
              return (
                <div key={r.id || i} className="p-2 rounded border text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.report?.orgName || 'Unknown reporter'}</span>
                    <span className="text-muted-foreground">
                      {r.report?.begin ? new Date(r.report.begin * 1000).toLocaleString() : ''} · {r.report?.reportId || ''}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {ins.totalMessages ?? 0} messages · {ins.passingMessages ?? 0} aligned · {ins.failingMessages ?? 0} failed
                    {(ins.failingSources || []).length > 0 && (
                      <span> · top fail source: {ins.failingSources[0].ip} ({ins.failingSources[0].count})</span>
                    )}
                  </div>
                  {unauthorized.length > 0 && (
                    <div className="mt-1 text-amber-500">
                      External report destination(s) lack authorization (RFC 7489 §7.1): {unauthorized.map((c: any) => c.destination).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : !detailRefreshing && !detailRefreshError ? (
          <p className="text-xs text-muted-foreground">No aggregate reports ingested yet. Export the XML your inbox receives at the rua address and upload it here.</p>
        ) : null}
      </div>

      {/* Issues — expandable rows with the fix inline (hover tooltips
          are invisible on touch/keyboard) */}
      {selectedDomain.issues?.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="font-medium text-sm">Issues Found:</p>
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
        <div className="space-y-3 mt-4 p-4 bg-orange-500/10 rounded-lg border border-orange-500/30">
          <p className="font-medium text-sm">Recommended DNS Records:</p>
          <div className="grid gap-2 text-xs font-mono">
            {fixRecommendations.recommended_records?.spf && (
              <div className="p-2 bg-background rounded border flex items-center gap-2">
                <span className="text-muted-foreground flex-shrink-0">SPF:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.spf.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.spf.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.dmarc && (
              <div className="p-2 bg-background rounded border flex items-center gap-2">
                <span className="text-muted-foreground flex-shrink-0">DMARC:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.dmarc.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.dmarc.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.mta_sts && (
              <div className="p-2 bg-background rounded border flex items-center gap-2">
                <span className="text-muted-foreground flex-shrink-0">MTA-STS:</span>
                <span className="flex-1 break-all">{fixRecommendations.recommended_records.mta_sts.recommended}</span>
                <CopyButton value={fixRecommendations.recommended_records.mta_sts.recommended} label="Copy" />
              </div>
            )}
            {fixRecommendations.recommended_records?.tls_rpt && (
              <div className="p-2 bg-background rounded border flex items-center gap-2">
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
    </CardContent>
  </Card>
  );
}
