"use client";

import { useState } from "react";
import { Download, Eye, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify, describeError } from "@/components/ui/status";
import { TabHeader } from "@/components/dashboard/settings-ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const selectClass = "h-9 w-full rounded-md border border-input bg-white/[0.02] px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

interface ReportsTabProps {
  domains: any[];
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onOpenDomain?: (domainId: number) => void;
}

/** Reports tab: per-domain HTML report + bulk CSV/JSON export. */
export default function ReportsTab({ domains, apiFetch, onOpenDomain }: ReportsTabProps) {
  const [reportDomainId, setReportDomainId] = useState<number | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

const generateReport = async (domainId: number) => {
  setGeneratingReport(true);
  try {
    const response = await apiFetch(`${API_BASE}/reports/domains/${domainId}/report`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // nexus-report-segbytes.xyz-2026-11-17.html — operator-friendly, sorts naturally
    const domainName = domains.find((d: any) => d.id === domainId)?.name || String(domainId);
    const date = new Date().toISOString().slice(0, 10);
    a.download = `nexus-report-${domainName}-${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    notify('Couldn\'t generate the report.', 'error', describeError(e, 'The report request failed.'));
  } finally {
    setGeneratingReport(false);
  }
};

const exportCSV = async () => {
  try {
    const response = await apiFetch(`${API_BASE}/reports/export/csv`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexusemail-domains.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    notify('Couldn\'t export the CSV.', 'error', describeError(e, 'The export request failed.'));
  }
};

const exportJSON = async () => {
  try {
    const response = await apiFetch(`${API_BASE}/reports/export/json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexusemail-domains.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    notify('Couldn\'t export the JSON.', 'error', describeError(e, 'The export request failed.'));
  }
};

  return (
    <>
      <TabHeader
        title="Reports"
        description="Per-domain HTML reports for stakeholders, plus bulk exports for archive."
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-card p-5">
          <div>
            <h3 className="text-[14px] font-semibold">Single domain report</h3>
            <p className="mt-1 max-w-[55ch] text-[12.5px] leading-5 text-muted-foreground">
              Detailed HTML breakdown of one domain&rsquo;s SPF, DKIM and DMARC posture, ready to share with stakeholders.
            </p>
          </div>
          <div className="mt-5">
            <label htmlFor="report-domain" className="text-[12px] font-medium text-muted-foreground">Domain</label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <select
                id="report-domain"
                className={selectClass + ' min-w-0 sm:flex-1'}
                value={reportDomainId || ''}
                onChange={(e) => setReportDomainId(Number(e.target.value))}
                aria-label="Domain for report"
              >
                <option value="">Select a domain…</option>
                {domains.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <Button
                onClick={() => reportDomainId && generateReport(reportDomainId)}
                disabled={!reportDomainId || generatingReport}
                title={!reportDomainId ? 'Select a domain above first' : undefined}
                className="sm:w-auto"
              >
                {generatingReport ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><FileText className="w-3.5 h-3.5" /> Generate report</>}
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[12px]"
              disabled={!reportDomainId}
              onClick={() => reportDomainId && onOpenDomain?.(reportDomainId)}
            >
              <Eye className="w-3.5 h-3.5" /> Open domain details
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {reportDomainId ? 'Downloads as a self-contained HTML file.' : 'Select a domain to enable report generation.'}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div>
            <h3 className="text-[14px] font-semibold">Bulk export</h3>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Every domain&rsquo;s latest scan in one archive.
            </p>
          </div>
          <div className="mt-4 divide-y divide-border border-y border-border">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium">CSV</p>
                <p className="text-[11px] text-muted-foreground">Spreadsheet-friendly</p>
              </div>
              <Button variant="outline" size="sm" className="flex-shrink-0" onClick={exportCSV}>
                <Download className="w-3.5 h-3.5" /> Download CSV
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium">JSON</p>
                <p className="text-[11px] text-muted-foreground">Full structured data</p>
              </div>
              <Button variant="outline" size="sm" className="flex-shrink-0" onClick={exportJSON}>
                <Download className="w-3.5 h-3.5" /> Download JSON
              </Button>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            Exports include the latest scan per domain and are safe to archive.
          </p>
        </section>
      </div>
    </>
  );
}
