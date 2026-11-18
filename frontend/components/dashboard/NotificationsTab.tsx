"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { FormField, SaveTestActions, SettingsSection, TabHeader, ToggleRow } from "@/components/dashboard/settings-ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface NotificationsTabProps {
  notifications: any;
  settings: any;
  onSavePref: (key: string, value: boolean) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  loadSettings: () => void;
  sessionGenRef: { current: number };
}

/** Notifications tab: event preferences and every outbound channel
 * (SMTP, Resend, Slack) in one place. Forms live here and unmount with the
 * tab, so no secret survives identity change. */
export default function NotificationsTab({ notifications, settings, onSavePref, apiFetch, loadSettings, sessionGenRef }: NotificationsTabProps) {
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [slackForm, setSlackForm] = useState({ webhook_url: '' });
  const [resendForm, setResendForm] = useState({ api_key: '', from: '' });
  const [testEmailTo, setTestEmailTo] = useState('');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [savingResend, setSavingResend] = useState(false);
  const [testingResend, setTestingResend] = useState(false);
  const dirty = useRef({ slack: false, resend: false });

  // Sync delivery forms from the server config. Deps are the sub-objects,
  // not `settings` itself. Dirty forms are never overwritten: saving the
  // Slack webhook must not clobber an unsaved Resend draft.
  useEffect(() => {
    const smtp = settings?.smtp_config;
    setSmtpForm(smtp ? {
      host: smtp.host || '', port: String(smtp.port || 587), secure: smtp.secure || false,
      user: smtp.user || '', pass: '', from: smtp.from || ''
    } : { host: '', port: '587', secure: false, user: '', pass: '', from: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.smtp_config]);

  useEffect(() => {
    if (!dirty.current.slack) setSlackForm({ webhook_url: settings?.slack_webhook || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.slack_webhook]);

  useEffect(() => {
    if (dirty.current.resend) return;
    const r = settings?.resend_config;
    setResendForm({ api_key: r?.api_key || '', from: r?.from || '' });
    if (r?.from) setTestEmailTo(r.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.resend_config]);

  const saveChannel = async (
    path: string,
    body: any,
    successMessage: string,
    failureMessage: string,
    setSaving: (value: boolean) => void,
  ) => {
    const gen = sessionGenRef.current;
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        notify(failureMessage, 'error', describeApiError(data.error || `HTTP ${res.status}`));
        return;
      }
      notify(successMessage, 'success');
      if (gen === sessionGenRef.current) loadSettings();
    } catch (e) {
      notify(failureMessage, 'error', describeError(e, 'The request failed.'));
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async (
    path: string,
    body: any,
    successMessage: string,
    failureMessage: string,
    setTesting: (value: boolean) => void,
  ) => {
    setTesting(true);
    try {
      const res = await apiFetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      notify(
        data.success ? successMessage : failureMessage,
        data.success ? 'success' : 'error',
        data.success ? undefined : describeApiError(data.error),
      );
    } catch (e) {
      notify(failureMessage, 'error', describeError(e, 'The test could not be run.'));
    } finally {
      setTesting(false);
    }
  };

  const saveSmtp = () => saveChannel('/settings/smtp', smtpForm, 'SMTP settings saved.', 'SMTP settings couldn\'t be saved.', setSavingSmtp);
  const testSmtp = () => testChannel('/settings/smtp/test', undefined, 'SMTP connection successful.', 'SMTP connection failed.', setTestingSmtp);
  const saveSlack = () => saveChannel('/settings/slack', slackForm, 'Slack webhook saved.', 'Slack webhook couldn\'t be saved.', setSavingSlack);
  const testSlack = () => testChannel('/settings/slack/test', undefined, 'Slack test message sent.', 'Slack test failed.', setTestingSlack);
  const saveResend = () => saveChannel('/settings/resend', resendForm, 'Resend settings saved.', 'Resend settings couldn\'t be saved.', setSavingResend);
  const testResend = () => {
    if (!testEmailTo) { notify('Enter a test email address first.', 'info'); return; }
    testChannel('/settings/resend/test', { to: testEmailTo }, 'Test email sent. Check the inbox — and the spam folder.', 'Test email failed.', setTestingResend);
  };

  return (
    <>
      <TabHeader
        title="How we reach you"
        description="Pick which events trigger an alert, and configure every outbound channel in one place."
      />

      <SettingsSection
        title="Notification preferences"
        description="Toggle which events generate an outbound alert."
      >
        {[
          { key: 'scan_completed', label: 'Scan completed', desc: 'Get notified when a domain scan finishes.' },
          { key: 'critical_alerts', label: 'Critical alerts', desc: 'Immediate emails for high-severity issues.' },
          { key: 'weekly_report', label: 'Weekly summary', desc: 'A digest of every domain\u2019s posture each week.' },
        ].map((pref) => (
          <ToggleRow
            key={pref.key}
            label={pref.label}
            description={pref.desc}
            on={!!notifications[pref.key]}
            onClick={() => onSavePref(pref.key, !notifications[pref.key])}
            onLabel="On"
            offLabel="Off"
          />
        ))}
      </SettingsSection>

      <SettingsSection
        icon={Mail}
        title="Email delivery"
        description="SMTP sends directly; Resend sends over HTTPS where outbound SMTP is blocked. Configure one or both."
      >
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SMTP (direct)</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="SMTP host" value={smtpForm.host} onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })} placeholder="smtp.example.com" />
            <FormField label="Port" value={smtpForm.port} onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value })} placeholder="587" />
            <FormField label="Username" value={smtpForm.user} onChange={(e) => setSmtpForm({ ...smtpForm, user: e.target.value })} placeholder="user@example.com" />
            <FormField label="Password" type="password" value={smtpForm.pass} onChange={(e) => setSmtpForm({ ...smtpForm, pass: e.target.value })} placeholder="••••••••" />
            <FormField label="From email" className="sm:col-span-2" value={smtpForm.from} onChange={(e) => setSmtpForm({ ...smtpForm, from: e.target.value })} placeholder="noreply@yourdomain.com" />
            <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={smtpForm.secure} onChange={(e) => setSmtpForm({ ...smtpForm, secure: e.target.checked })} className="accent-emerald-500" />
              <span>Use TLS / SSL</span>
            </label>
          </div>
          <SaveTestActions
            onSave={saveSmtp}
            saving={savingSmtp}
            saveLabel="Save SMTP"
            onTest={testSmtp}
            testing={testingSmtp}
            testLabel="Test connection"
            testIcon="zap"
          />
        </div>

        <div className="hairline" />

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resend (HTTP API)</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Works everywhere — including networks where outbound SMTP is blocked. Free tier: 3,000 emails/month at resend.com.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="API key" value={resendForm.api_key} onChange={(e) => setResendForm({ ...resendForm, api_key: e.target.value })} placeholder="re_xxxxxxxx" />
            <FormField label="From address" value={resendForm.from} onChange={(e) => setResendForm({ ...resendForm, from: e.target.value })} placeholder="noreply@segbytes.xyz" />
            <FormField label="Send test email to" className="sm:col-span-2" value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)} placeholder="you@company.com" />
          </div>
          <SaveTestActions
            onSave={saveResend}
            saving={savingResend}
            saveLabel="Save Resend"
            onTest={testResend}
            testing={testingResend}
            testLabel="Send test email"
          />
          <div className="text-xs text-muted-foreground p-3 rounded-md bg-white/[0.03] border border-white/5 leading-relaxed">
            Until your own domain is verified in Resend, test emails can be sent from <code className="text-emerald-300">onboarding@resend.dev</code> (to your own email only). After verifying <code className="text-emerald-300">segbytes.xyz</code>, set the From address above — SPF/DKIM/DMARC records can then be added automatically via the Cloudflare integration.
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={MessageSquare}
        title="Slack"
        description="Paste a Slack Incoming Webhook URL — alerts land in that channel."
      >
        <FormField
          label="Webhook URL"
          value={slackForm.webhook_url}
          onChange={(e) => setSlackForm({ ...slackForm, webhook_url: e.target.value })}
          placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
        />
        <p className="text-xs text-muted-foreground">
          Slack &rarr; your workspace &rarr; Apps &rarr; Incoming Webhooks &rarr; create for a channel. <a href="https://my.slack.com/apps/A0F7XDUAZ-incoming-webhooks" target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">Open Slack Webhooks</a>
        </p>
        <SaveTestActions
          onSave={saveSlack}
          saving={savingSlack}
          saveLabel="Save Slack"
          onTest={testSlack}
          testing={testingSlack}
          testLabel="Send test message"
        />
      </SettingsSection>
    </>
  );
}
