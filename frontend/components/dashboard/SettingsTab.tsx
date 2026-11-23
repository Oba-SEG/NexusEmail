"use client";

import { useEffect, useState } from "react";
import { Activity, Building2, KeyRound, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DNS_PROVIDERS } from "@/lib/providers";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { FormField, SettingsSection, TabHeader, ToggleRow } from "@/components/dashboard/settings-ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface SettingsTabProps {
  settings: any;
  user?: any;
  sessionGenRef: { current: number };
  tokenRefreshPendingRef: { current: boolean };
  onSettingsChange: (updater: any) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onGoToIntegrations?: () => void;
  onGoToNotifications?: () => void;
  onGoToReports?: () => void;
  onOrganizationRenamed?: (name: string) => void;
  onTokenRefreshed?: (token: string) => void;
}

function DeliveryRow({
  label,
  description,
  status,
  ok,
  actionLabel,
  onAction,
}: {
  label: string;
  description: string;
  status: string;
  ok: boolean;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/70 py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="mt-0.5 max-w-[62ch] text-[12px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
          {status}
        </span>
        <Button variant="outline" size="sm" onClick={onAction} disabled={!onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

export default function SettingsTab({
  settings,
  user,
  sessionGenRef,
  tokenRefreshPendingRef,
  onSettingsChange,
  apiFetch,
  onGoToIntegrations,
  onGoToNotifications,
  onGoToReports,
  onOrganizationRenamed,
  onTokenRefreshed,
}: SettingsTabProps) {
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const orgName = user?.organization?.name || '';
  const [orgDraft, setOrgDraft] = useState(orgName);
  const [savingOrg, setSavingOrg] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const hasPassword = user?.has_password !== false;
  const [savingPassword, setSavingPassword] = useState(false);
  const [reportSchedule, setReportSchedule] = useState<any>(null);
  const [reportScheduleFailed, setReportScheduleFailed] = useState(false);

  useEffect(() => {
    setOrgDraft(orgName);
  }, [orgName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/settings/report-schedule`);
        if (cancelled) return;
        if (!res.ok) {
          setReportScheduleFailed(true);
          return;
        }
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (data && typeof data === 'object' && !data.error) setReportSchedule(data);
        else setReportScheduleFailed(true);
      } catch {
        if (!cancelled) setReportScheduleFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orgDirty = orgDraft.trim() !== orgName;

  const saveOrganization = async () => {
    const name = orgDraft.trim();
    if (!canManage || !orgDirty) return;
    if (name.length < 2 || name.length > 80) {
      notify('Workspace name couldn\'t be saved.', 'error', 'Use between 2 and 80 characters.');
      return;
    }
    const gen = sessionGenRef.current;
    setSavingOrg(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/organization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json().catch(() => null);
      if (gen !== sessionGenRef.current) return;
      if (!res.ok) {
        notify('Workspace name couldn\'t be saved.', 'error', describeApiError(data?.error || `HTTP ${res.status}`));
        return;
      }
      const savedName = data?.organization?.name || name;
      setOrgDraft(savedName);
      onOrganizationRenamed?.(savedName);
      notify('Workspace name saved.', 'success');
    } catch (e) {
      notify('Workspace name couldn\'t be saved.', 'error', describeError(e, 'The request failed.'));
    } finally {
      setSavingOrg(false);
    }
  };

  const toggleSchedule = async (enabled: boolean) => {
    const gen = sessionGenRef.current;
    setPendingSchedule(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (gen !== sessionGenRef.current) return;
      if (!res.ok) {
        notify('Scanning schedule couldn\'t be changed.', 'error', `HTTP ${res.status}`);
        return;
      }
      onSettingsChange((cur: any) => ({ ...cur, scan_schedule: { ...(cur?.scan_schedule || {}), enabled } }));
    } catch (e) {
      notify('Scanning schedule couldn\'t be changed.', 'error', describeError(e, 'The request failed.'));
    } finally {
      setPendingSchedule(false);
    }
  };

  const changePassword = async () => {
    if (passwordForm.next.length < 12) {
      notify('Password couldn\'t be changed.', 'error', 'Use at least 12 characters.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      notify('Password couldn\'t be changed.', 'error', 'The new passwords do not match.');
      return;
    }
    const gen = sessionGenRef.current;
    setSavingPassword(true);
    tokenRefreshPendingRef.current = true;
    try {
      const res = await apiFetch(`${API_BASE}/settings/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: passwordForm.current,
          new_password: passwordForm.next
        })
      });
      const data = await res.json().catch(() => null);
      if (gen !== sessionGenRef.current) return;
      if (!res.ok) {
        notify('Password couldn\'t be changed.', 'error', describeApiError(data?.error || `HTTP ${res.status}`));
        return;
      }
      if (data?.token) onTokenRefreshed?.(data.token);
      setPasswordForm({ current: '', next: '', confirm: '' });
      notify('Password changed.', 'success', 'Other devices have been signed out.');
    } catch (e) {
      notify('Password couldn\'t be changed.', 'error', describeError(e, 'The request failed.'));
    } finally {
      tokenRefreshPendingRef.current = false;
      setSavingPassword(false);
    }
  };

  const connected = DNS_PROVIDERS.filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
  const smtpHost = settings?.smtp_config?.host;
  const hasResend = !!settings?.resend_config?.api_key;
  const emailStatus = !settings ? 'Loading…' : hasResend ? 'Resend' : smtpHost ? 'SMTP' : 'Not configured';
  const emailDescription = hasResend
    ? 'Outbound mail is sent through Resend.'
    : smtpHost
      ? `Outbound mail is sent through ${smtpHost}.`
      : 'No outbound email channel is configured.';
  const slackConnected = !!settings?.slack_webhook;
  const reportRecipients = (() => {
    const raw = reportSchedule?.recipients;
    if (Array.isArray(raw)) {
      return raw.filter((address) => typeof address === 'string' && address.trim()).length;
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((address) => address.trim()).filter(Boolean).length;
    }
    return 0;
  })();
  const reportsOn = reportSchedule?.enabled === true;
  const frequency = typeof reportSchedule?.frequency === 'string' && reportSchedule.frequency
    ? reportSchedule.frequency.charAt(0).toUpperCase() + reportSchedule.frequency.slice(1)
    : 'Recurring';
  const lastSent = reportSchedule?.last_run ? new Date(reportSchedule.last_run) : null;
  const lastSentLabel = lastSent && !Number.isNaN(lastSent.getTime()) ? ` · last sent ${lastSent.toLocaleDateString()}` : '';
  const reportsStatus = reportScheduleFailed
    ? 'Unavailable'
    : !reportSchedule
      ? 'Loading…'
      : reportsOn ? 'On' : 'Off';
  const reportsDescription = reportsOn
    ? `${frequency} · ${reportRecipients} recipient${reportRecipients === 1 ? '' : 's'}${reportSchedule?.slack ? ' + Slack' : ''}${lastSentLabel}`
    : reportScheduleFailed
      ? 'The delivery schedule could not be loaded.'
      : 'No recurring digest is configured.';

  return (
    <>
      <TabHeader
        title="Settings"
        description="Workspace, background scanning, delivery channels, and account security."
      />

      <SettingsSection
        icon={Building2}
        title="Workspace"
        description="The organization everyone on this account shares."
      >
        {canManage ? (
          <div className="flex flex-wrap items-end gap-3 border-b border-border/70 py-4">
            <FormField
              label="Workspace name"
              value={orgDraft}
              onChange={(e) => setOrgDraft(e.target.value)}
              maxLength={80}
              disabled={savingOrg}
              className="w-full sm:max-w-sm"
            />
            <Button
              size="sm"
              onClick={saveOrganization}
              disabled={!orgDirty || savingOrg}
              aria-busy={savingOrg}
            >
              {savingOrg ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savingOrg ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <div className="border-b border-border/70 py-4">
            <p className="text-[11.5px] font-medium text-muted-foreground">Workspace name</p>
            <p className="mt-1 text-[13px]">{orgName || 'Personal workspace'}</p>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2 py-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-muted-foreground">Workspace ID</p>
            <p className="mt-1 font-mono text-[13px]">{user?.organization?.slug || '—'}</p>
          </div>
          <p className="max-w-[38ch] text-[12px] leading-5 text-muted-foreground">
            Used in URLs and support requests. It can't be changed here.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={Activity}
        title="Scanning"
        description="Background checks run daily at 02:00 UTC, with critical domains checked every 6 hours."
      >
        <ToggleRow
          label="Background scans"
          description={canManage
            ? 'Re-scan every active domain on schedule. Scans on add always run.'
            : 'Scans run on schedule for this workspace. Only owners and admins can change this.'}
          on={!!settings?.scan_schedule?.enabled}
          onClick={() => toggleSchedule(!settings?.scan_schedule?.enabled)}
          pending={pendingSchedule}
          disabled={!canManage || !settings}
        />
      </SettingsSection>

      <SettingsSection
        icon={Send}
        title="Delivery"
        description="Where alerts and reports go. Channels are configured in Notifications; DNS access lives in DNS providers."
      >
        <DeliveryRow
          label="Email"
          description={emailDescription}
          status={emailStatus}
          ok={!!smtpHost || hasResend}
          actionLabel="Notifications"
          onAction={onGoToNotifications}
        />
        <DeliveryRow
          label="Slack"
          description={slackConnected ? 'Critical alerts are posted to the connected webhook.' : 'No Slack webhook is connected.'}
          status={!settings ? 'Loading…' : slackConnected ? 'Connected' : 'Not configured'}
          ok={slackConnected}
          actionLabel="Notifications"
          onAction={onGoToNotifications}
        />
        <DeliveryRow
          label="DNS providers"
          description="Credentials that let Nexus update DNS records for you."
          status={`${connected} of ${DNS_PROVIDERS.length}`}
          ok={connected > 0}
          actionLabel="Integrations"
          onAction={onGoToIntegrations}
        />
        <DeliveryRow
          label="Scheduled reports"
          description={reportsDescription}
          status={reportsStatus}
          ok={reportsOn}
          actionLabel="Reports"
          onAction={onGoToReports}
        />
      </SettingsSection>

      <SettingsSection
        icon={KeyRound}
        title="Account & security"
        description="Your sign-in details and password."
      >
        <div className="grid gap-4 border-b border-border/70 py-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-muted-foreground">Signed in as</p>
            <p className="mt-1 truncate text-[13px]">{user?.email || '—'}</p>
          </div>
          <div>
            <p className="text-[11.5px] font-medium text-muted-foreground">Role</p>
            <p className="mt-1 text-[13px] capitalize">{user?.role || '—'}</p>
          </div>
        </div>
        <div className="space-y-3 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {hasPassword && (
              <FormField
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                disabled={savingPassword}
              />
            )}
            <FormField
              label="New password"
              type="password"
              autoComplete="new-password"
              value={passwordForm.next}
              onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
              disabled={savingPassword}
            />
            <FormField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              disabled={savingPassword}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              size="sm"
              onClick={changePassword}
              disabled={savingPassword || (hasPassword && !passwordForm.current) || !passwordForm.next || !passwordForm.confirm}
              aria-busy={savingPassword}
            >
              {savingPassword ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {savingPassword ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
            </Button>
            <p className="text-[11.5px] text-muted-foreground">At least 12 characters. Other devices will be signed out.</p>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
