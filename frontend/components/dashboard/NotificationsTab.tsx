"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  configLoaded?: boolean;
  configError?: string;
  onRetryConfig?: () => void;
  canManageSmtp?: boolean;
}

/** Notifications tab: event preferences and every outbound channel
 * (SMTP, Resend, Slack) in one place. Forms live here and unmount with the
 * tab, so no secret survives identity change. */
export default function NotificationsTab({ notifications, settings, onSavePref, apiFetch, loadSettings, sessionGenRef, configLoaded = false, configError = '', onRetryConfig, canManageSmtp = true }: NotificationsTabProps) {
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [slackForm, setSlackForm] = useState({ webhook_url: '' });
  const [resendForm, setResendForm] = useState({ api_key: '', from: '' });
  const [testEmailTo, setTestEmailTo] = useState('');
  const [pendingPrefs, setPendingPrefs] = useState<Record<string, boolean>>({});
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [savingResend, setSavingResend] = useState(false);
  const [testingResend, setTestingResend] = useState(false);
  const dirty = useRef({ smtp: false, slack: false, resend: false });
  // Edits made while a save is in flight keep the form dirty: clearing it on
  // acknowledgment must not let the following settings reload overwrite them.
  const editSeq = useRef({ smtp: 0, slack: 0, resend: 0 });
  // Only controls backed by a successful config load are editable; a
  // partial settings object from another action must not unlock the forms.
  const togglePref = async (key: string) => {
    setPendingPrefs((p) => ({ ...p, [key]: true }));
    try {
      await onSavePref(key, !notifications[key]);
    } finally {
      setPendingPrefs((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  const ready = configLoaded && !!settings;
  const smtpReady = ready && canManageSmtp;
  const updateSmtp = (patch: Partial<typeof smtpForm>) => {
    dirty.current.smtp = true;
    editSeq.current.smtp += 1;
    setSmtpForm((form) => ({ ...form, ...patch }));
  };
  const updateSlack = (patch: Partial<typeof slackForm>) => {
    dirty.current.slack = true;
    editSeq.current.slack += 1;
    setSlackForm((form) => ({ ...form, ...patch }));
  };
  const updateResend = (patch: Partial<typeof resendForm>) => {
    dirty.current.resend = true;
    editSeq.current.resend += 1;
    setResendForm((form) => ({ ...form, ...patch }));
  };

  // Sync delivery forms from the server config. Deps are the sub-objects,
  // not `settings` itself. Dirty forms are never overwritten: saving the
  // Slack webhook must not clobber an unsaved Resend draft.
  useEffect(() => {
    if (dirty.current.smtp) return;
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
    if (r?.from) setTestEmailTo((current) => current || r.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.resend_config]);

  const saveChannel = async (
    path: string,
    body: any,
    successMessage: string,
    failureMessage: string,
    setSaving: (value: boolean) => void,
    onSaved?: () => void,
  ) => {
    const gen = sessionGenRef.current;
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      // A save is only confirmed by the API's success acknowledgment; a body
      // that failed to arrive is not a successful save.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success !== true || data.error) {
        notify(failureMessage, 'error', describeApiError((data && data.error) || `HTTP ${res.status}`));
        return;
      }
      onSaved?.();
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

  const saveSmtp = () => {
    const seq = editSeq.current.smtp;
    return saveChannel('/settings/smtp', smtpForm, 'SMTP settings saved.', 'SMTP settings couldn\'t be saved.', setSavingSmtp, () => {
      if (editSeq.current.smtp === seq) dirty.current.smtp = false;
    });
  };
  const testSmtp = () => testChannel('/settings/smtp/test', undefined, 'SMTP connection successful.', 'SMTP connection failed.', setTestingSmtp);
  const saveSlack = () => {
    const seq = editSeq.current.slack;
    return saveChannel('/settings/slack', slackForm, 'Slack webhook saved.', 'Slack webhook couldn\'t be saved.', setSavingSlack, () => {
      if (editSeq.current.slack === seq) dirty.current.slack = false;
    });
  };
  const testSlack = () => testChannel('/settings/slack/test', undefined, 'Slack test message sent.', 'Slack test failed.', setTestingSlack);
  const saveResend = () => {
    const seq = editSeq.current.resend;
    return saveChannel('/settings/resend', resendForm, 'Resend settings saved.', 'Resend settings couldn\'t be saved.', setSavingResend, () => {
      if (editSeq.current.resend === seq) dirty.current.resend = false;
    });
  };
  const testResend = () => {
    if (!testEmailTo) { notify('Enter a test email address first.', 'info'); return; }
    testChannel('/settings/resend/test', { to: testEmailTo }, 'Test email sent. Check the inbox — and the spam folder.', 'Test email failed.', setTestingResend);
  };

  return (
    <>
      <TabHeader
        title="Notifications"
        description="Pick which events trigger an alert, and configure every outbound channel in one place."
      />

      {!ready || configError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l border-amber-500/40 py-1 pl-3">
          <p className="text-sm text-muted-foreground">
            {configError
              ? ready
                ? "Preferences couldn't be refreshed — showing the last values loaded."
                : "Settings couldn't be loaded. Delivery controls stay locked until a retry succeeds."
              : 'Loading your saved delivery settings…'}
          </p>
          {configError ? (
            <Button size="sm" variant="outline" onClick={onRetryConfig} disabled={!onRetryConfig}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <SettingsSection
        title="Notification preferences"
        description="Toggle which events generate an outbound alert."
        contentClassName="divide-y divide-border/60 py-0"
      >
        {[
          { key: 'scan_completed', label: 'Scan completed', desc: 'Get notified when a domain scan finishes.' },
          { key: 'critical_alerts', label: 'Critical alerts', desc: 'Immediate emails for high-severity issues.' },
          { key: 'weekly_report', label: 'Weekly summary', desc: 'A weekly digest of how every domain is doing.' },
        ].map((pref) => (
          <ToggleRow
            key={pref.key}
            label={pref.label}
            description={pref.desc}
            on={!!notifications[pref.key]}
            onClick={() => togglePref(pref.key)}
            onLabel="On"
            offLabel="Off"
            disabled={!ready}
            pending={!!pendingPrefs[pref.key]}
          />
        ))}
      </SettingsSection>

      <SettingsSection
        icon={Mail}
        title="Email delivery"
        description="SMTP sends directly; Resend sends over HTTPS where outbound SMTP is blocked. Configure one or both."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[12px] font-medium text-foreground">SMTP (direct)</h4>
            {!canManageSmtp ? (
              <p className="text-xs text-muted-foreground">Only owners and admins can change SMTP credentials.</p>
            ) : null}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="SMTP host" disabled={!smtpReady} value={smtpForm.host} onChange={(e) => updateSmtp({ host: e.target.value })} placeholder="smtp.example.com" />
            <FormField label="Port" disabled={!smtpReady} value={smtpForm.port} onChange={(e) => updateSmtp({ port: e.target.value })} placeholder="587" />
            <FormField label="Username" disabled={!smtpReady} value={smtpForm.user} onChange={(e) => updateSmtp({ user: e.target.value })} placeholder="user@example.com" />
            <FormField label="Password" type="password" disabled={!smtpReady} value={smtpForm.pass} onChange={(e) => updateSmtp({ pass: e.target.value })} placeholder="••••••••" />
            <FormField label="From email" className="sm:col-span-2" disabled={!smtpReady} value={smtpForm.from} onChange={(e) => updateSmtp({ from: e.target.value })} placeholder="noreply@yourdomain.com" />
            <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" disabled={!smtpReady} checked={smtpForm.secure} onChange={(e) => updateSmtp({ secure: e.target.checked })} className="accent-primary" />
              <span>Use implicit TLS (port 465) — leave off for STARTTLS, usually port 587</span>
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
            disabled={!smtpReady}
          />
        </div>

        <div className="hairline" />

        <div className="space-y-3">
          <h4 className="text-[12px] font-medium text-foreground">Resend (HTTP API)</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Works everywhere — including networks where outbound SMTP is blocked. Free tier: 3,000 emails/month at resend.com.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="API key" disabled={!ready} value={resendForm.api_key} onChange={(e) => updateResend({ api_key: e.target.value })} placeholder="re_xxxxxxxx" />
            <FormField label="From address" disabled={!ready} value={resendForm.from} onChange={(e) => updateResend({ from: e.target.value })} placeholder="noreply@segbytes.xyz" />
            <FormField label="Send test email to" className="sm:col-span-2" disabled={!ready} value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)} placeholder="you@company.com" />
          </div>
          <SaveTestActions
            onSave={saveResend}
            saving={savingResend}
            saveLabel="Save Resend"
            onTest={testResend}
            testing={testingResend}
            testLabel="Send test email"
            disabled={!ready}
          />
          <div className="border-l border-border py-1 pl-3 text-[11px] leading-relaxed text-muted-foreground">
            Until your own domain is verified in Resend, test emails can be sent from <code className="text-primary">onboarding@resend.dev</code> (to your own email only). After verifying <code className="text-primary">segbytes.xyz</code>, set the From address above — SPF/DKIM/DMARC records can then be added automatically via the Cloudflare integration.
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
          disabled={!ready}
          value={slackForm.webhook_url}
          onChange={(e) => updateSlack({ webhook_url: e.target.value })}
          placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
        />
        <p className="text-xs text-muted-foreground">
          Slack &rarr; your workspace &rarr; Apps &rarr; Incoming Webhooks &rarr; create for a channel. <a href="https://my.slack.com/apps/A0F7XDUAZ-incoming-webhooks" target="_blank" rel="noreferrer" className="text-primary hover:underline">Open Slack Webhooks</a>
        </p>
        <SaveTestActions
          onSave={saveSlack}
          saving={savingSlack}
          saveLabel="Save Slack"
          onTest={testSlack}
          testing={testingSlack}
          testLabel="Send test message"
          disabled={!ready}
        />
      </SettingsSection>
    </>
  );
}
