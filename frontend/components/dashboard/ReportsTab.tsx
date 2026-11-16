"use client";

import { useState } from "react";
import { BarChart3, Download, FileText, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { notify, describeError } from "@/components/ui/status";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface ReportsTabProps {
  domains: any[];
  apiFetch: (url: string, options?: any) => Promise<Response>;
}

/** Reports tab: per-domain HTML report + bulk CSV/JSON export. */
export default function ReportsTab({ domains, apiFetch }: ReportsTabProps) {
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
    a.download = `report-${domainId}-${Date.now()}.html`;
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
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="eyebrow mb-2">Reports</p>
                <h2 className="font-display text-2xl font-bold tracking-tight mb-1">Generate &amp; export</h2>
                <p className="text-sm text-muted-foreground">Per-domain HTML reports for stakeholders. Bulk CSV / JSON exports for archive.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportCSV}>
                  <Download className="w-4 h-4 mr-2" /> Export all (CSV)
                </Button>
                <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportJSON}>
                  <Download className="w-4 h-4 mr-2" /> Export all (JSON)
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <Card className="premium-surface premium-card border-0">
                <CardHeader>
                  <CardTitle className="font-display tracking-tight flex items-center gap-2">
                    <FileText className="w-4 h-4 text-orange-400" /> Single domain report
                  </CardTitle>
                  <CardDescription>Detailed HTML breakdown of one domain&rsquo;s SPF / DKIM / DMARC posture.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <select
                    className="w-full h-10 px-3 rounded-md border border-white/10 bg-background/50 text-sm focus-visible:outline-none focus-visible:border-orange-500/40"
                    value={reportDomainId || ''}
                    onChange={(e) => setReportDomainId(Number(e.target.value))}
                  >
                    <option value="">Select a domain&hellip;</option>
                    {domains.map((d: any) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <Button
                    className="w-full btn-premium-primary border-0"
                    onClick={() => reportDomainId && generateReport(reportDomainId)}
                    disabled={!reportDomainId || generatingReport}
                  >
                    {generatingReport ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating&hellip;</> : <><FileText className="w-4 h-4 mr-2" /> Generate report</>}
                  </Button>
                </CardContent>
              </Card>

              <Card className="premium-surface premium-card border-0">
                <CardHeader>
                  <CardTitle className="font-display tracking-tight flex items-center gap-2">
                    <Download className="w-4 h-4 text-orange-400" /> Bulk export
                  </CardTitle>
                  <CardDescription>Download every domain&rsquo;s latest scan as a single archive.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportCSV}>
                    <Download className="w-4 h-4 mr-2" /> CSV &mdash; spreadsheet-friendly
                  </Button>
                  <Button variant="outline" className="w-full border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportJSON}>
                    <Download className="w-4 h-4 mr-2" /> JSON &mdash; full structured data
                  </Button>
                </CardContent>
              </Card>
            </div>
    </>
  );
}
