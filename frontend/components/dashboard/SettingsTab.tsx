"use client";

import { useEffect, useState } from "react";
import { Activity, Server, Plug, Zap, RefreshCw, Save, CheckCircle, Mail, Wrench, MessageSquare, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { DNS_PROVIDERS } from "@/lib/providers";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface SettingsTabProps {
  settings: any;
  onSettingsChange: (updater: any) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  loadSettings: () => void;
  sessionGenRef: { current: number };
}

/** Settings tab: scanning cadence, auto-remediation, SMTP / Slack / Resend
 * delivery configuration. Delivery forms live here (they unmount with the
 * tab, so no secret survives identity change). */
export default function SettingsTab({ settings, onSettingsChange, apiFetch, loadSettings, sessionGenRef }: SettingsTabProps) {
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [testingSmtp, setTestingSmtp] = useState(false);

  // Sync delivery forms from the server config. Deps are the sub-objects,
  // not `settings` itself: unrelated updates (schedule toggle etc.) keep
  // the same smtp_config/slack_webhook/resend_config references, so a
  // mid-edit form is not wiped.
  useEffect(() => {
    const smtp = settings?.smtp_config;
    setSmtpForm(smtp ? {
      host: smtp.host || '', port: String(smtp.port || 587), secure: smtp.secure || false,
      user: smtp.user || '', pass: '', from: smtp.from || ''
    } : { host: '', port: '587', secure: false, user: '', pass: '', from: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.smtp_config]);


const saveSmtp = async () => {
  const gen = sessionGenRef.current;
  try {
    const res = await apiFetch(`${API_BASE}/settings/smtp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smtpForm)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify('SMTP settings couldn\'t be saved.', 'error', describeApiError(data.error || `HTTP ${res.status}`));
      return;
    }
    notify('SMTP settings saved.', 'success');
    if (gen === sessionGenRef.current) loadSettings();
  } catch (e) {
    notify('SMTP settings couldn\'t be saved.', 'error', describeError(e, 'The request failed.'));
  }
};

const testSmtp = async () => {
  setTestingSmtp(true);
  try {
    const res = await apiFetch(`${API_BASE}/settings/smtp/test`, { method: 'POST' });
    const data = await res.json();
    notify(data.success ? 'SMTP connection successful.' : 'SMTP connection failed.', data.success ? 'success' : 'error', data.success ? undefined : describeApiError(data.error));
  } catch (e) {
    notify('SMTP test failed.', 'error', describeError(e, 'The test could not be run.'));
  } finally {
    setTestingSmtp(false);
  }
};

const toggleSchedule = async (enabled: boolean) => {
  try {
    const res = await apiFetch(`${API_BASE}/settings/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) return;
    // Functional update: two rapid toggles must not resurrect each other's
    // stale snapshot.
    onSettingsChange((cur: any) => ({ ...cur, scan_schedule: { ...(cur?.scan_schedule || {}), enabled } }));
  } catch (e) {
    console.error('Failed to toggle schedule:', e);
  }
};

const toggleAutoRemediation = async (enabled: boolean) => {
  try {
    const res = await apiFetch(`${API_BASE}/settings/auto-remediation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) return;
    onSettingsChange((cur: any) => ({ ...cur, auto_remediation: enabled }));
  } catch (e) {
    console.error('Failed to toggle auto-remediation:', e);
  }
};

  return (
    <>
            <div>
              <p className="eyebrow mb-2">Settings</p>
              <h2 className="font-display text-2xl font-bold tracking-tight mb-1">Operational defaults</h2>
              <p className="text-sm text-muted-foreground">Scanning cadence, auto-remediation policy, outbound SMTP, and connected DNS providers.</p>
            </div>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-400" /> Scanning
                </CardTitle>
                <CardDescription>How and when domains get re-scanned.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { key: 'autoOnAdd', label: 'Auto-scan on add', desc: 'Run a scan immediately when a new domain is added.', on: !!settings?.scan_schedule?.enabled, fn: () => toggleSchedule(!settings?.scan_schedule?.enabled) },
                  { key: 'daily', label: 'Daily scheduled scan', desc: 'Re-scan every domain at 02:00 UTC.', on: !!settings?.scan_schedule?.enabled, fn: () => toggleSchedule(!settings?.scan_schedule?.enabled) },
                ].map((s) => (
                  <div key={s.key} className="flex items-center justify-between p-4 rounded-lg border border-white/5 bg-white/[0.02]">
                    <div>
                      <p className="font-medium text-sm">{s.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`min-w-[78px] ${s.on ? 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/30' : 'text-muted-foreground border border-white/10 hover:bg-white/5'}`}
                      onClick={s.fn}
                    >
                      {s.on ? 'Enabled' : 'Disabled'}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-orange-400" /> Auto-remediation
                </CardTitle>
                <CardDescription>When a connected DNS provider can patch SPF / DMARC, do it automatically.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg border border-white/5 bg-white/[0.02]">
                  <div>
                    <p className="font-medium text-sm">Auto-fix issues</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Apply recommended record changes via your DNS provider integration.</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`min-w-[78px] ${settings?.auto_remediation ? 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/30' : 'text-muted-foreground border border-white/10 hover:bg-white/5'}`}
                    onClick={() => toggleAutoRemediation(!settings?.auto_remediation)}
                  >
                    {settings?.auto_remediation ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <Mail className="w-4 h-4 text-orange-400" /> SMTP configuration
                </CardTitle>
                <CardDescription>Outbound delivery for scan completion, alerts, weekly digests, and takedown emails.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SMTP host</label>
                    <Input value={smtpForm.host} onChange={(e) => setSmtpForm({...smtpForm, host: e.target.value})} placeholder="smtp.example.com" className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port</label>
                    <Input value={smtpForm.port} onChange={(e) => setSmtpForm({...smtpForm, port: e.target.value})} placeholder="587" className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Username</label>
                    <Input value={smtpForm.user} onChange={(e) => setSmtpForm({...smtpForm, user: e.target.value})} placeholder="user@example.com" className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</label>
                    <Input type="password" value={smtpForm.pass} onChange={(e) => setSmtpForm({...smtpForm, pass: e.target.value})} placeholder="••••••••" className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From email</label>
                    <Input value={smtpForm.from} onChange={(e) => setSmtpForm({...smtpForm, from: e.target.value})} placeholder="noreply@yourdomain.com" className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={smtpForm.secure} onChange={(e) => setSmtpForm({...smtpForm, secure: e.target.checked})} className="accent-orange-500" />
                      <span>Use TLS / SSL</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button className="btn-premium-primary border-0" onClick={saveSmtp}>
                    <Save className="w-4 h-4 mr-2" /> Save SMTP
                  </Button>
                  <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={testSmtp} disabled={testingSmtp}>
                    {testingSmtp ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Testing&hellip;</> : <><Zap className="w-4 h-4 mr-2" /> Test connection</>}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <Plug className="w-4 h-4 text-orange-400" /> Connected DNS providers
                </CardTitle>
                <CardDescription>Snapshot of providers configured under <strong>Integrations</strong>.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {DNS_PROVIDERS.map((p: any) => {
                    const creds = settings?.provider_credentials?.[p.name.toLowerCase()];
                    return (
                      <div key={p.name} className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${creds ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200' : 'border-white/5 bg-white/[0.02] text-muted-foreground'}`}>
                        <Server className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{p.name}</span>
                        {creds && <CheckCircle className="w-3 h-3 ml-auto text-emerald-400 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
    </>
  );
}
