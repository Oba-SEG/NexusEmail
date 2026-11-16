"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle, MessageSquare, Mail, Save, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify, describeError, describeApiError } from "@/components/ui/status";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface NotificationsTabProps {
  notifications: any;
  settings: any;
  onSavePref: (key: string, value: boolean) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  loadSettings: () => void;
}

/** Notifications tab: event preferences + Slack / Resend delivery. Forms
 * live here and unmount with the tab (no webhook URL or API key survives
 * identity change). */
export default function NotificationsTab({ notifications, settings, onSavePref, apiFetch, loadSettings }: NotificationsTabProps) {
  const [slackForm, setSlackForm] = useState({ webhook_url: '' });
  const [resendForm, setResendForm] = useState({ api_key: '', from: '' });
  const [testEmailTo, setTestEmailTo] = useState('');
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [savingResend, setSavingResend] = useState(false);
  const [testingResend, setTestingResend] = useState(false);

  // Sync delivery forms from the server config. Deps are the sub-objects,
  // not `settings` itself, so a mid-edit form is not wiped by unrelated
  // settings updates.
  useEffect(() => {
    setSlackForm({ webhook_url: settings?.slack_webhook || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.slack_webhook]);

  useEffect(() => {
    const r = settings?.resend_config;
    setResendForm({ api_key: r?.api_key || '', from: r?.from || '' });
    if (r?.from) setTestEmailTo(r.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.resend_config]);


const saveSlack = async () => {
setSavingSlack(true);
try {
  const res = await apiFetch(`${API_BASE}/settings/slack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slackForm)
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    notify('Slack webhook couldn\'t be saved.', 'error', describeApiError(data.error || `HTTP ${res.status}`));
    return;
  }
  notify('Slack webhook saved.', 'success');
  loadSettings();
} catch (e) {
  notify('Slack webhook couldn\'t be saved.', 'error', describeError(e, 'The request failed.'));
} finally {
  setSavingSlack(false);
}
};

const testSlack = async () => {
setTestingSlack(true);
try {
  const res = await apiFetch(`${API_BASE}/settings/slack/test`, { method: 'POST' });
  const data = await res.json();
  notify(data.success ? 'Slack test message sent.' : 'Slack test failed.', data.success ? 'success' : 'error', data.success ? undefined : describeApiError(data.error));
} catch (e) {
  notify('Slack test failed.', 'error', describeError(e, 'The test could not be run.'));
} finally {
  setTestingSlack(false);
}
};

const saveResend = async () => {
setSavingResend(true);
try {
  const res = await apiFetch(`${API_BASE}/settings/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resendForm)
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    notify('Resend settings couldn\'t be saved.', 'error', describeApiError(data.error || `HTTP ${res.status}`));
    return;
  }
  notify('Resend settings saved.', 'success');
  loadSettings();
} catch (e) {
  notify('Resend settings couldn\'t be saved.', 'error', describeError(e, 'The request failed.'));
} finally {
  setSavingResend(false);
}
};

const testResend = async () => {
if (!testEmailTo) { notify('Enter a test email address first.', 'info'); return; }
setTestingResend(true);
try {
  const res = await apiFetch(`${API_BASE}/settings/resend/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: testEmailTo })
  });
  const data = await res.json();
  notify(data.success ? 'Test email sent. Check the inbox — and the spam folder.' : 'Test email failed.', data.success ? 'success' : 'error', data.success ? undefined : describeApiError(data.error));
} catch (e) {
  notify('Test email failed.', 'error', describeError(e, 'The test could not be run.'));
} finally {
  setTestingResend(false);
}
};

  return (
    <>
            <div>
              <p className="eyebrow mb-2">Notifications</p>
              <h2 className="font-display text-2xl font-bold tracking-tight mb-1">How we reach you</h2>
              <p className="text-sm text-muted-foreground">
                Pick which events trigger an email and where they get delivered. SMTP delivery is configured in Settings.
              </p>
            </div>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight">Notification preferences</CardTitle>
                <CardDescription>Toggle which events generate an outbound email.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { key: 'scan_completed', label: 'Scan completed', desc: 'Get notified when a domain scan finishes.', icon: CheckCircle },
                  { key: 'critical_alerts', label: 'Critical alerts', desc: 'Immediate emails for high-severity issues.', icon: AlertTriangle },
                  { key: 'weekly_report', label: 'Weekly summary', desc: 'A digest of every domain\u2019s posture each week.', icon: BarChart3 },
                ].map((pref) => {
                  const on = !!notifications[pref.key];
                  return (
                    <div key={pref.key} className="flex items-center justify-between p-4 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <div className="flex items-start gap-3">
                        <div>
                          <p className="font-medium text-sm">{pref.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{pref.desc}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`min-w-[70px] ${on ? 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 hover:text-orange-200 border border-orange-500/30' : 'text-muted-foreground border border-white/10 hover:bg-white/5'}`}
                        onClick={() => onSavePref(pref.key, !on)}
                      >
                        {on ? 'On' : 'Off'}
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-orange-400" /> Slack
                </CardTitle>
                <CardDescription>Paste a Slack Incoming Webhook URL — alerts land in that channel.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Webhook URL</label>
                  <Input
                    value={slackForm.webhook_url}
                    onChange={(e) => setSlackForm({ ...slackForm, webhook_url: e.target.value })}
                    placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
                    className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Slack &rarr; your workspace &rarr; Apps &rarr; Incoming Webhooks &rarr; create for a channel. <a href="https://my.slack.com/apps/A0F7XDUAZ-incoming-webhooks" target="_blank" rel="noreferrer" className="text-orange-300 hover:underline">Open Slack Webhooks</a>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveSlack} disabled={savingSlack} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                    <Save className="w-4 h-4 mr-2" /> {savingSlack ? 'Saving…' : 'Save Slack'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={testSlack} disabled={testingSlack} className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5">
                    <Send className="w-4 h-4 mr-2" /> {testingSlack ? 'Sending…' : 'Send test message'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="premium-surface premium-card border-0">
              <CardHeader>
                <CardTitle className="font-display tracking-tight flex items-center gap-2">
                  <Mail className="w-4 h-4 text-orange-400" /> Email delivery (Resend)
                </CardTitle>
                <CardDescription>
                  HTTP-based sending that works everywhere — including networks where outbound SMTP is blocked. Free tier: 3,000 emails/month at resend.com.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">API key</label>
                    <Input
                      value={resendForm.api_key}
                      onChange={(e) => setResendForm({ ...resendForm, api_key: e.target.value })}
                      placeholder="re_xxxxxxxx"
                      className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From address</label>
                    <Input
                      value={resendForm.from}
                      onChange={(e) => setResendForm({ ...resendForm, from: e.target.value })}
                      placeholder="noreply@segbytes.xyz"
                      className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Send test email to</label>
                  <Input
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    placeholder="you@company.com"
                    className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveResend} disabled={savingResend} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                    <Save className="w-4 h-4 mr-2" /> {savingResend ? 'Saving…' : 'Save Resend'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={testResend} disabled={testingResend} className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5">
                    <Send className="w-4 h-4 mr-2" /> {testingResend ? 'Sending…' : 'Send test email'}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground p-3 rounded-md bg-white/[0.03] border border-white/5 leading-relaxed">
                  Until your own domain is verified in Resend, test emails can be sent from <code className="text-orange-300">onboarding@resend.dev</code> (to your own email only). After verifying <code className="text-orange-300">segbytes.xyz</code>, set the From address above — SPF/DKIM/DMARC records can then be added automatically via the Cloudflare integration.
                </div>
              </CardContent>
            </Card>
    </>
  );
}
