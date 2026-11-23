"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TabHeader } from "@/components/dashboard/settings-ui";
import { notify, describeError } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface ThreatAlertsTabProps {
  apiFetch: (url: string, options?: any) => Promise<Response>;
  sessionGenRef: { current: number };
  tokenRef: { current: string | null };
  onAuthFailure: (requestToken?: string | null) => void;
  onAlertCountChange?: (count: number) => void;
  onOpenBrand?: (brandId: number) => void;
}

const severityClass = (severity?: string) => {
  if (severity === 'high' || severity === 'critical') return 'text-red-300';
  if (severity === 'medium') return 'text-amber-300';
  return 'text-muted-foreground';
};

/** Persistent threat-alert queue. Alerts are addressable (?tab=threats),
 * carry a link back to the monitored brand, and can be dismissed — the
 * e-mail/Slack notifications deep-link here instead of a dead end. */
export default function ThreatAlertsTab({
  apiFetch, sessionGenRef, tokenRef, onAuthFailure, onAlertCountChange, onOpenBrand,
}: ThreatAlertsTabProps) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [clearing, setClearing] = useState(false);
  const loadSeqRef = useRef(0);

  const loadAlerts = async (gen: number = sessionGenRef.current) => {
    const seq = ++loadSeqRef.current;
    setState('loading');
    setError('');
    const requestToken = tokenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts`);
      if (gen !== sessionGenRef.current || seq !== loadSeqRef.current) return;
      if (res.status === 401) {
        onAuthFailure(requestToken);
        return;
      }
      if (!res.ok) {
        setState('error');
        setError(`Couldn't load threat alerts (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current || seq !== loadSeqRef.current) return;
      const list = Array.isArray(data) ? data : [];
      setAlerts(list);
      setState('ready');
      onAlertCountChange?.(list.length);
    } catch (e) {
      if (gen !== sessionGenRef.current || seq !== loadSeqRef.current) return;
      setState('error');
      setError(describeError(e, "The request failed."));
    }
  };

  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissAlert = async (alert: any) => {
    const gen = sessionGenRef.current;
    setDismissing((prev) => new Set(prev).add(alert.id));
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts/${alert.id}`, { method: 'DELETE' });
      if (gen !== sessionGenRef.current) return;
      if (!res.ok && res.status !== 404) {
        notify("Couldn't dismiss the alert.", 'error', `HTTP ${res.status}`);
        return;
      }
      setAlerts((prev) => {
        const next = prev.filter((a) => a.id !== alert.id);
        onAlertCountChange?.(next.length);
        return next;
      });
      notify('Alert dismissed.', 'success');
    } catch (e) {
      if (gen === sessionGenRef.current) {
        notify("Couldn't dismiss the alert.", 'error', describeError(e, 'The request failed.'));
      }
    } finally {
      if (gen === sessionGenRef.current) {
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(alert.id);
          return next;
        });
      }
    }
  };

  const clearAll = async () => {
    const gen = sessionGenRef.current;
    setClearing(true);
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts/clear`, { method: 'POST' });
      if (gen !== sessionGenRef.current) return;
      if (!res.ok) {
        notify("Couldn't clear the alerts.", 'error', `HTTP ${res.status}`);
        return;
      }
      setConfirmClear(false);
      setAlerts([]);
      onAlertCountChange?.(0);
      notify('All threat alerts cleared.', 'success');
    } catch (e) {
      if (gen === sessionGenRef.current) {
        notify("Couldn't clear the alerts.", 'error', describeError(e, 'The request failed.'));
      }
    } finally {
      if (gen === sessionGenRef.current) setClearing(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAlerts = alerts.filter((alert: any) => {
    const sev = String(alert.severity || 'medium').toLowerCase();
    const severityMatch = severity === 'all'
      || (severity === 'high' ? sev === 'high' || sev === 'critical' : sev === severity);
    const text = `${alert.domain || ''} ${alert.brand_name || ''} ${alert.message || ''}`.toLowerCase();
    return severityMatch && (!normalizedQuery || text.includes(normalizedQuery));
  });

  return (
    <>
      <TabHeader
        title="Threat alerts"
        description="Lookalikes and impersonation attempts found across the brands you monitor."
        action={
          alerts.length > 0 ? (
            <>
              <span className="text-[12px] text-muted-foreground">{alerts.length} open</span>
              <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Clear all
              </Button>
            </>
          ) : undefined
        }
      />

      {state === 'loading' && (
        <p className="mt-8 text-[13px] text-muted-foreground" role="status">Loading threat alerts…</p>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-start gap-3 border-l border-red-500/40 py-1 pl-4">
          <p className="text-[13px] text-red-300">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadAlerts()}>Retry</Button>
        </div>
      )}

      {state === 'ready' && alerts.length === 0 && (
        <div className="border-y border-border px-6 py-16 text-center">
          <p className="text-[15px] font-semibold">No open threat alerts</p>
          <p className="mx-auto mt-1 max-w-[48ch] text-[12.5px] leading-5 text-muted-foreground">
            New lookalikes and impersonation attempts appear here after each brand scan. Nothing needs attention right now.
          </p>
        </div>
      )}

      {state === 'ready' && alerts.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-3 pb-3">
            <div className="relative w-full sm:w-[240px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search alerts"
                aria-label="Search threat alerts"
                className="h-8 w-full border-0 border-b border-border bg-transparent pl-8 text-[12.5px] focus-visible:border-primary focus-visible:ring-0"
              />
            </div>
            <div className="inline-flex items-center gap-1">
              {(['all', 'high', 'medium', 'low'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setSeverity(level)}
                  aria-pressed={severity === level}
                  className={`h-7 rounded-md px-2 text-[12px] font-medium capitalize transition-colors ${severity === level ? 'bg-white/[0.07] text-foreground' : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground'}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <span role="status" className="ml-auto text-[12px] text-muted-foreground">
              {filteredAlerts.length} of {alerts.length} alert{alerts.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="border-y border-border">
          <div className="flex items-center justify-between border-b border-border py-2.5">
            <p className="section-label">Alert queue</p>
            <p className="text-[10.5px] text-muted-foreground">Newest first</p>
          </div>
          <ul className="divide-y divide-border">
            {filteredAlerts.map((alert: any) => (
              <li key={alert.id} className="flex flex-wrap items-start gap-3 py-3.5">
                <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${String(alert.severity || 'medium').toLowerCase() === 'high' || String(alert.severity).toLowerCase() === 'critical' ? 'bg-red-400' : String(alert.severity || 'medium').toLowerCase() === 'medium' ? 'bg-amber-400' : 'bg-white/30'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {alert.domain && (
                      <span className="break-all font-mono text-[12.5px] text-foreground">{alert.domain}</span>
                    )}
                    <span className={`text-[10.5px] font-medium capitalize ${severityClass(alert.severity)}`}>
                      {alert.severity || 'medium'}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-foreground">{alert.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {alert.brand_name ? `${alert.brand_name} · ` : ''}
                    {formatDateTime(alert.created_at || alert.timestamp)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {alert.brand_id && onOpenBrand && (
                    <Button variant="outline" size="sm" onClick={() => onOpenBrand(alert.brand_id)}>
                      <ExternalLink className="w-3.5 h-3.5" /> Open brand
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label={`Dismiss alert for ${alert.domain || alert.brand_name || 'brand'}`}
                    title="Dismiss"
                    disabled={dismissing.has(alert.id)}
                    onClick={() => dismissAlert(alert)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
            {filteredAlerts.length === 0 && (
              <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                No alerts match the current filter.
              </li>
            )}
          </ul>
          </div>
        </div>
      )}

      <AlertDialog open={confirmClear} onOpenChange={(o) => { if (!o) setConfirmClear(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all threat alerts?</AlertDialogTitle>
            <AlertDialogDescription>
              The alert queue is emptied. Threats stay in each brand&apos;s history, so the evidence is not lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={clearing}
              onClick={(e) => { e.preventDefault(); clearAll(); }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
