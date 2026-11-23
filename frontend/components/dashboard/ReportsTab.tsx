"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Link2,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify, describeError } from "@/components/ui/status";
import { TabHeader, SettingsSection, ToggleRow } from "@/components/dashboard/settings-ui";
import { formatDateTime } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const selectClass = "h-9 w-full rounded-md border border-input bg-white/[0.02] px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

interface ReportsTabProps {
  domains: any[];
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onOpenDomain?: (domainId: number) => void;
}

interface GeneratedReport {
  id: number;
  domain_id?: number;
  domain_name: string;
  score?: number | null;
  range_days?: number;
  generated_at: string;
  html: string;
}

interface ReportSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string;
  slack: boolean;
  last_run: string | null;
  last_result: { email?: string; slack?: string } | null;
}

const EMPTY_SCHEDULE: ReportSchedule = {
  enabled: false,
  frequency: 'weekly',
  recipients: '',
  slack: false,
  last_run: null,
  last_result: null,
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reports: generate shareable per-domain reports, keep a history with
 * inline preview, export scoped scan data, and schedule a digest. */
export default function ReportsTab({ domains, apiFetch, onOpenDomain }: ReportsTabProps) {
  const [reportDomainId, setReportDomainId] = useState<number | ''>('');
  const [rangeDays, setRangeDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<GeneratedReport | null>(null);

  const [reports, setReports] = useState<any[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [exportIds, setExportIds] = useState<number[]>([]);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [scheduleState, setScheduleState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scheduleError, setScheduleError] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const domainList = useMemo(() => (Array.isArray(domains) ? domains : []), [domains]);
  const selectedDomain = domainList.find((d: any) => d.id === reportDomainId);

  useEffect(() => {
    let cancelled = false;
    setHistoryState('loading');
    setHistoryError('');
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/reports`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setReports(Array.isArray(data) ? data : []);
          setHistoryState('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryState('error');
          setHistoryError(describeError(e, 'The report history could not be loaded.'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiFetch, historyTick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/settings/report-schedule`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSchedule({ ...EMPTY_SCHEDULE, ...data });
          setScheduleState('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setScheduleState('error');
          setScheduleError(describeError(e, 'The delivery schedule could not be loaded.'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const generateReport = async () => {
    if (!reportDomainId) return;
    setGenerating(true);
    try {
      const res = await apiFetch(`${API_BASE}/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_id: reportDomainId, range_days: rangeDays }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPreview(data);
      setHistoryTick((t) => t + 1);
      notify('Report generated.', 'success', 'It is available in the history below for sharing and download.');
    } catch (e) {
      notify('Couldn\'t generate the report.', 'error', describeError(e, 'The report request failed.'));
    } finally {
      setGenerating(false);
    }
  };

  const openStoredReport = async (id: number) => {
    try {
      const res = await apiFetch(`${API_BASE}/reports/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPreview(data);
    } catch (e) {
      notify('Couldn\'t open the report.', 'error', describeError(e, 'The report could not be loaded.'));
    }
  };

  const downloadStoredReport = async (id: number, domainName?: string, generatedAt?: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/reports/${id}/download`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const date = (generatedAt || new Date().toISOString()).slice(0, 10);
      saveBlob(blob, `nexus-report-${domainName || 'domain'}-${date}.html`);
    } catch (e) {
      notify('Couldn\'t download the report.', 'error', describeError(e, 'The download failed.'));
    }
  };

  const shareReport = async (id: number) => {
    try {
      const res = await apiFetch(`${API_BASE}/reports/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_days: 7 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const url = `${API_BASE}/reports/shared/${data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        notify('Share link copied.', 'success', `Anyone with the link can view this report until ${formatDateTime(data.expires_at)}.`);
      } catch {
        window.prompt('Copy this share link:', url);
      }
    } catch (e) {
      notify('Couldn\'t create a share link.', 'error', describeError(e, 'Sharing failed.'));
    }
  };

  const deleteReport = async (id: number) => {
    try {
      const res = await apiFetch(`${API_BASE}/reports/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      if (preview?.id === id) setPreview(null);
      setHistoryTick((t) => t + 1);
      notify('Report deleted.', 'success');
    } catch (e) {
      notify('Couldn\'t delete the report.', 'error', describeError(e, 'The delete request failed.'));
    }
  };

  const downloadExport = async (format: 'csv' | 'json') => {
    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (exportIds.length) params.set('domains', exportIds.join(','));
      if (exportFrom) params.set('from', new Date(`${exportFrom}T00:00:00`).toISOString());
      if (exportTo) params.set('to', new Date(`${exportTo}T23:59:59.999`).toISOString());
      const res = await apiFetch(`${API_BASE}/reports/export/${format}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      saveBlob(blob, format === 'csv' ? `nexusemail-records-${date}.csv` : `nexusemail-export-${date}.json`);
    } catch (e) {
      notify(`Couldn't export the ${format.toUpperCase()}.`, 'error', describeError(e, 'The export request failed.'));
    } finally {
      setExporting(null);
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    setSavingSchedule(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/report-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: schedule.enabled,
          frequency: schedule.frequency,
          recipients: schedule.recipients,
          slack: schedule.slack,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSchedule({ ...EMPTY_SCHEDULE, ...data });
      setScheduleState('ready');
      notify('Delivery schedule saved.', 'success');
    } catch (e) {
      notify('Couldn\'t save the schedule.', 'error', describeError(e, 'The schedule was not saved.'));
    } finally {
      setSavingSchedule(false);
    }
  };

  const toggleExportDomain = (id: number) => {
    setExportIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const lastRunLabel = schedule?.last_run
    ? `${formatDateTime(schedule.last_run)}${schedule.last_result
      ? ` · email ${schedule.last_result.email || '—'}${schedule.last_result.slack && schedule.last_result.slack !== 'skipped' ? ` · Slack ${schedule.last_result.slack}` : ''}`
      : ''}`
    : 'Not sent yet.';

  return (
    <>
      <TabHeader
        title="Reports"
        description="Create shareable reports, review past results, export raw data and schedule a digest."
      />

      <div className="space-y-8">
        <SettingsSection
          title="Single domain report"
          description="One shareable report with your score, DNS evidence, trends, DMARC totals and recommended fixes."
          contentClassName="space-y-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 sm:flex-1">
              <label htmlFor="report-domain" className="text-[11.5px] font-medium text-muted-foreground">Domain</label>
              <select
                id="report-domain"
                className={`${selectClass} mt-1.5`}
                value={reportDomainId}
                onChange={(e) => setReportDomainId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Select a domain…</option>
                {domainList.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:w-[150px]">
              <label htmlFor="report-range" className="text-[11.5px] font-medium text-muted-foreground">History window</label>
              <select
                id="report-range"
                className={`${selectClass} mt-1.5`}
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={generateReport} disabled={!reportDomainId || generating}>
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {generating ? 'Generating…' : 'Generate report'}
              </Button>
              {selectedDomain && onOpenDomain ? (
                <Button variant="outline" onClick={() => onOpenDomain(selectedDomain.id)}>
                  <Eye className="w-3.5 h-3.5" /> Open domain details
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            Generated reports are stored in the history below and can be downloaded or shared as an expiring link.
          </p>
        </SettingsSection>

        {preview ? (
          <SettingsSection
            title={`Preview — ${preview.domain_name}`}
            description={`Generated ${formatDateTime(preview.generated_at)}${typeof preview.score === 'number' ? ` · score ${preview.score}/100` : ''}.`}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => shareReport(preview.id)}>
                  <Link2 className="w-3.5 h-3.5" /> Copy link
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadStoredReport(preview.id, preview.domain_name, preview.generated_at)}>
                  <Download className="w-3.5 h-3.5" /> Download
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPreview(null)} title="Close preview" aria-label="Close preview">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            }
            contentClassName="mt-4"
          >
            <iframe
              title={`Report preview for ${preview.domain_name}`}
              srcDoc={preview.html}
              sandbox=""
              className="h-[70vh] w-full rounded-md border border-border bg-white"
            />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Report history"
          description="Every generated report, newest first. Links expire after 7 days; downloads never do."
          actions={
            <Button size="sm" variant="outline" onClick={() => setHistoryTick((t) => t + 1)} disabled={historyState === 'loading'}>
              <RefreshCw className={`w-3.5 h-3.5 ${historyState === 'loading' ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          }
          contentClassName="mt-1"
        >
          {historyState === 'loading' ? (
            <p className="text-[12.5px] text-muted-foreground">Loading reports…</p>
          ) : historyState === 'error' ? (
            <p className="text-[12.5px] text-red-400">{historyError}</p>
          ) : reports.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No reports generated yet.</p>
          ) : (
            <div className="overflow-x-auto border-y border-border">
              <table className="ledger-table w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2.5 font-medium">Domain</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Score</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">Window</th>
                    <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Generated</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report: any) => (
                    <tr key={report.id} className="ledger-row border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <span className="whitespace-nowrap font-mono text-[12.5px] font-medium">{report.domain_name || `Domain ${report.domain_id}`}</span>
                        <span className="mt-0.5 block text-[10.5px] text-muted-foreground sm:hidden">
                          {typeof report.score === 'number' ? `Score ${report.score}` : 'Not scored'} · {formatDateTime(report.generated_at)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-[12px] tabular-nums sm:table-cell">
                        {typeof report.score === 'number' ? `${report.score}/100` : '—'}
                      </td>
                      <td className="hidden px-4 py-3 text-[12px] text-muted-foreground md:table-cell">
                        {report.range_days ? `${report.range_days} days` : '—'}
                      </td>
                      <td className="hidden px-4 py-3 text-[12px] text-muted-foreground lg:table-cell">
                        {formatDateTime(report.generated_at)}
                      </td>
                      <td className="px-4 py-3">
                        {confirmDeleteId === report.id ? (
                          <div className="flex items-center justify-end gap-2 text-[12px]">
                            <span className="text-muted-foreground">Delete?</span>
                            <button onClick={() => deleteReport(report.id)} className="font-medium text-red-300 hover:text-red-200">Confirm</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openStoredReport(report.id)} title="Preview" aria-label={`Preview report for ${report.domain_name || report.domain_id}`}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => shareReport(report.id)} title="Copy share link" aria-label={`Copy share link for ${report.domain_name || report.domain_id}`}>
                              <Link2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadStoredReport(report.id, report.domain_name, report.generated_at)} title="Download HTML" aria-label={`Download report for ${report.domain_name || report.domain_id}`}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:bg-red-500/10 hover:text-red-300" onClick={() => setConfirmDeleteId(report.id)} title="Delete report" aria-label={`Delete report for ${report.domain_name || report.domain_id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title="Bulk exports"
          description="Choose a CSV with one row per scan (including DNS evidence) or a JSON archive with full scan data. Defaults to all domains and the last 30 days."
          contentClassName="space-y-4"
        >
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11.5px] font-medium text-muted-foreground">Domains</p>
              <button
                type="button"
                onClick={() => setExportIds([])}
                className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Use all domains
              </button>
            </div>
            <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border">
              {domainList.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">No domains yet.</p>
              ) : domainList.map((d: any) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-2 text-[12.5px] last:border-0 hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                    checked={exportIds.includes(d.id)}
                    onChange={() => toggleExportDomain(d.id)}
                  />
                  <span className="font-mono">{d.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {exportIds.length === 0 ? 'No domains selected — exports include every domain.' : `${exportIds.length} domain${exportIds.length === 1 ? '' : 's'} selected.`}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
            <div>
              <label htmlFor="export-from" className="text-[11.5px] font-medium text-muted-foreground">From</label>
              <Input id="export-from" type="date" className="mt-1.5" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
            </div>
            <div>
              <label htmlFor="export-to" className="text-[11.5px] font-medium text-muted-foreground">To</label>
              <Input id="export-to" type="date" className="mt-1.5" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadExport('csv')} disabled={exporting !== null}>
              {exporting === 'csv' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting === 'csv' ? 'Exporting…' : 'Download CSV'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadExport('json')} disabled={exporting !== null}>
              {exporting === 'json' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting === 'json' ? 'Exporting…' : 'Download JSON'}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Scheduled delivery"
          description="Email a digest with the full report attached to your team, and post a summary to Slack if a webhook is set."
          contentClassName="space-y-4"
        >
          {scheduleState === 'loading' ? (
            <p className="text-[12.5px] text-muted-foreground">Loading delivery schedule…</p>
          ) : scheduleState === 'error' || !schedule ? (
            <p className="text-[12.5px] text-red-400">{scheduleError}</p>
          ) : (
            <>
              <ToggleRow
                label="Scheduled digest"
                description="Nexus checks hourly and sends when your chosen interval is due."
                on={schedule.enabled}
                onClick={() => { if (!savingSchedule) setSchedule({ ...schedule, enabled: !schedule.enabled }); }}
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-[160px]">
                  <label htmlFor="schedule-frequency" className="text-[11.5px] font-medium text-muted-foreground">Frequency</label>
                  <select
                    id="schedule-frequency"
                    className={`${selectClass} mt-1.5`}
                    disabled={savingSchedule}
                    value={schedule.frequency}
                    onChange={(e) => setSchedule({ ...schedule, frequency: e.target.value as ReportSchedule['frequency'] })}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="min-w-0 sm:flex-1">
                  <label htmlFor="schedule-recipients" className="text-[11.5px] font-medium text-muted-foreground">Recipients</label>
                  <Input
                    id="schedule-recipients"
                    className="mt-1.5"
                    disabled={savingSchedule}
                    placeholder="security@example.com, ops@example.com"
                    value={schedule.recipients}
                    onChange={(e) => setSchedule({ ...schedule, recipients: e.target.value })}
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                  disabled={savingSchedule}
                  checked={schedule.slack}
                  onChange={(e) => setSchedule({ ...schedule, slack: e.target.checked })}
                />
                Also post the summary to the configured Slack webhook
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={saveSchedule} disabled={savingSchedule} aria-busy={savingSchedule}>
                  {savingSchedule ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {savingSchedule ? 'Saving…' : 'Save schedule'}
                </Button>
                <p className="text-[11px] text-muted-foreground">Last run: {lastRunLabel}</p>
              </div>
            </>
          )}
        </SettingsSection>
      </div>
    </>
  );
}
