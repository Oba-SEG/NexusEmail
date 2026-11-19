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

      <div className="mt-6 grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2">
        <section className="border-b border-border p-5 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-[14px] font-semibold">Single domain report</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            Detailed HTML breakdown of one domain&rsquo;s SPF, DKIM and DMARC posture.
          </p>
          <div className="mt-4 space-y-3">
            <select
              className={selectClass}
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
              className="w-full"
              onClick={() => reportDomainId && generateReport(reportDomainId)}
              disabled={!reportDomainId || generatingReport}
              title={!reportDomainId ? 'Select a domain above first' : undefined}
            >
              {generatingReport ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><FileText className="w-3.5 h-3.5" /> Generate report</>}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
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

        <section className="p-5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-[14px] font-semibold">Bulk export</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            Download every domain&rsquo;s latest scan as a single archive.
          </p>
          <div className="mt-4 space-y-2">
            <Button variant="outline" className="w-full justify-between" onClick={exportCSV}>
              <span className="flex items-center gap-2"><Download className="w-3.5 h-3.5" /> CSV</span>
              <span className="text-[11px] text-muted-foreground">Spreadsheet-friendly</span>
            </Button>
            <Button variant="outline" className="w-full justify-between" onClick={exportJSON}>
              <span className="flex items-center gap-2"><Download className="w-3.5 h-3.5" /> JSON</span>
              <span className="text-[11px] text-muted-foreground">Full structured data</span>
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Exports include the latest scan per domain and are safe to archive.
          </p>
        </section>
      </div>
    </>
  );
}
