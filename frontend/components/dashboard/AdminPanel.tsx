"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, ChevronRight, ArrowLeft, Plus, UserPlus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { scoreBand } from "@/lib/scores";
import { TabHeader } from "@/components/dashboard/settings-ui";
import { formatDateTime } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface AdminPanelProps {
  token: string | null;
  isAdmin: boolean;
  sessionGenRef: { current: number };
  tokenRef: { current: string | null };
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onAuthFailure: (requestToken?: string | null) => void;
  onImpersonate: (data: any) => void;
}

/** Admin panel: org drill-down + password reset, with all admin state and
 * request-generation guards owned here. Unmounts with the dashboard
 * branch, so nothing survives an identity change. */
export default function AdminPanel({ token, isAdmin, sessionGenRef, tokenRef, apiFetch, onAuthFailure, onImpersonate }: AdminPanelProps) {
const [adminOrgs, setAdminOrgs] = useState<any[] | null>(null);
const [adminOrgsError, setAdminOrgsError] = useState<string | null>(null);
const [adminDetail, setAdminDetail] = useState<any>(null);
const [adminLoading, setAdminLoading] = useState(false);
const [pwResetFor, setPwResetFor] = useState<string | null>(null);
const [pwResetValue, setPwResetValue] = useState('');
const [pwResetError, setPwResetError] = useState<string | null>(null);
const [pwResetBusy, setPwResetBusy] = useState(false);
const [pwResetDone, setPwResetDone] = useState<string | null>(null);
const [createOrgOpen, setCreateOrgOpen] = useState(false);
const [createOrgForm, setCreateOrgForm] = useState({ name: '', slug: '', owner_name: '', owner_email: '', owner_password: '' });
const [createOrgError, setCreateOrgError] = useState<string | null>(null);
const [createOrgBusy, setCreateOrgBusy] = useState(false);
const [addUserOpen, setAddUserOpen] = useState(false);
const [addUserForm, setAddUserForm] = useState({ name: '', email: '', role: 'member', password: '' });
const [addUserError, setAddUserError] = useState<string | null>(null);
const [addUserBusy, setAddUserBusy] = useState(false);
const [impersonateTarget, setImpersonateTarget] = useState<any>(null);
const [impersonateError, setImpersonateError] = useState<string | null>(null);
const [impersonateBusy, setImpersonateBusy] = useState(false);
const adminGenRef = useRef(0);
const pwFormGenRef = useRef(0);

  useEffect(() => {
    if (token && isAdmin) loadAdminOrgs();
  }, [token, isAdmin]);

const loadAdminOrgs = async (gen: number = sessionGenRef.current) => {
  try {
    setAdminOrgsError(null);
    // Back to the loading state for every (re)load — a Retry after an
    // error must not flash 'No organizations found.' while the request
    // is still in flight.
    setAdminOrgs(null);
    const requestToken = tokenRef.current;
    const res = await apiFetch(`${API_BASE}/admin/organizations`);
    if (gen !== sessionGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure(requestToken);
      return;
    }
    if (!res.ok) {
      console.error(`Failed to load admin organizations: HTTP ${res.status}`);
      setAdminOrgs([]);
      setAdminOrgsError(`Could not load organizations (HTTP ${res.status}).`);
      return;
    }
    const data = await res.json();
    if (gen !== sessionGenRef.current) return;
    setAdminOrgs(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error('Failed to load admin organizations:', e);
    if (gen !== sessionGenRef.current) return;
    setAdminOrgs([]);
    setAdminOrgsError('Could not load organizations (network error).');
  }
};

const openAdminOrg = async (orgId: string) => {
  adminGenRef.current += 1;
  const gen = adminGenRef.current;
  setAdminLoading(true);
  setAdminDetail(null);
  try {
    // Session generation is captured before the requests and re-checked
    // before any follow-up work: an in-flight 401 must never clear the
    // session of an identity that signed in later (adminGenRef alone only
    // guards against concurrent detail loads, not identity switches).
    const sgen = sessionGenRef.current;
    const requestToken = tokenRef.current;
    const base = `${API_BASE}/admin/organizations/${encodeURIComponent(orgId)}`;
    const [orgR, domR, usrR, scnR, ntR] = await Promise.all([
      apiFetch(base),
      apiFetch(`${base}/domains`),
      apiFetch(`${base}/users`),
      apiFetch(`${base}/scans`),
      apiFetch(`${base}/notifications`),
    ]);
    if (sgen !== sessionGenRef.current) return;
    if (gen !== adminGenRef.current) return;
    const responses = [orgR, domR, usrR, scnR, ntR];
    if (responses.some((r) => r.status === 401)) {
      onAuthFailure(requestToken);
      return;
    }
    if (!orgR.ok) {
      console.error(`Failed to load organization: HTTP ${orgR.status}`);
      return;
    }
    // Every section response is checked individually: a failed section is
    // reported as unavailable instead of masquerading as an empty one.
    // A 200 whose body fails to parse counts as unavailable too —
    // "No users" must never stand in for "couldn't read users".
    const safeJson = async (r: any) => {
      try { return await r.json(); } catch { return null; }
    };
    const [org, domains, users, scans, notifications] = await Promise.all([
      orgR.json(), safeJson(domR), safeJson(usrR), safeJson(scnR), safeJson(ntR)
    ]);
    const failed = {
      domains: !domR.ok || domains === null,
      users: !usrR.ok || users === null,
      scans: !scnR.ok || scans === null,
      notifications: !ntR.ok || notifications === null,
    };
    for (const [section, isFailed] of Object.entries(failed)) {
      if (isFailed) console.error(`Failed to load admin ${section}: response not ok or body unreadable`);
    }
    if (gen !== adminGenRef.current) return;
    setAdminDetail({
      org,
      domains: Array.isArray(domains) ? domains : [],
      users: Array.isArray(users) ? users : [],
      scans: Array.isArray(scans) ? scans : [],
      notifications: notifications || {},
      failed,
    });
  } catch (e) {
    console.error('Failed to load organization detail:', e);
  } finally {
    if (gen === adminGenRef.current) setAdminLoading(false);
  }
};

const closeAdminOrg = () => {
  adminGenRef.current += 1;
  pwFormGenRef.current += 1;
  setAdminDetail(null);
  setPwResetFor(null);
  setPwResetValue('');
  setPwResetError(null);
  // pwResetBusy deliberately NOT cleared: it is owned by the in-flight
  // request (the only one the busy guard allows) and cleared solely in
  // that request's finally — clearing it here would let a reopen start
  // a second request whose busy state the first one could then clobber.
};

const submitPasswordReset = async (orgId: string, userId: string) => {
  // Enter and the Set button share this handler: block every submission
  // path while one is in flight (the Set button is disabled, the input
  // is not).
  if (pwResetBusy) return;
  if (pwResetValue.length < 8) {
    setPwResetError('At least 8 characters.');
    return;
  }
  // Capture both generations before the request: a response from an
  // earlier session (logout/login elsewhere) or an earlier form
  // generation (admin switched to another user's reset form or org)
  // must not apply its updates to the current state.
  const sgen = sessionGenRef.current;
  const fgen = pwFormGenRef.current;
  const requestToken = tokenRef.current;
  setPwResetBusy(true);
  setPwResetError(null);
  try {
    const res = await apiFetch(
      `${API_BASE}/admin/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwResetValue })
      }
    );
    if (sgen !== sessionGenRef.current || fgen !== pwFormGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure(requestToken);
      return;
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch { /* keep HTTP status */ }
      if (sgen !== sessionGenRef.current || fgen !== pwFormGenRef.current) return;
      setPwResetError(message);
      return;
    }
    if (sgen !== sessionGenRef.current || fgen !== pwFormGenRef.current) return;
    setPwResetFor(null);
    setPwResetValue('');
    setPwResetDone(userId);
    setTimeout(() => setPwResetDone((cur) => (cur === userId ? null : cur)), 4000);
  } catch (e) {
    console.error('Password set failed:', e);
    if (sgen === sessionGenRef.current && fgen === pwFormGenRef.current) {
      setPwResetError('Network error.');
    }
  } finally {
    // The busy flag is request-owned: this submission is the only one
    // the guard ever lets in flight (it is never cleared anywhere else
    // — form close, org close, and identity change all keep it), so
    // clearing it here can never stomp a second request's state.
    setPwResetBusy(false);
  }
};

const readError = async (res: Response, fallback: string) => {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
};

const createOrganization = async () => {
  if (createOrgBusy) return;
  const hasOwner = !!(createOrgForm.owner_email || createOrgForm.owner_name || createOrgForm.owner_password);
  if (createOrgForm.name.trim().length < 2) {
    setCreateOrgError('Workspace name must be at least 2 characters.');
    return;
  }
  if (hasOwner && (!createOrgForm.owner_email.trim() || !createOrgForm.owner_password)) {
    setCreateOrgError('Add both an owner email and password, or leave the owner fields empty.');
    return;
  }
  if (hasOwner && createOrgForm.owner_password.length < 8) {
    setCreateOrgError('Owner password must be at least 8 characters.');
    return;
  }
  const sgen = sessionGenRef.current;
  const requestToken = tokenRef.current;
  setCreateOrgBusy(true);
  setCreateOrgError(null);
  try {
    const res = await apiFetch(`${API_BASE}/admin/organizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createOrgForm.name.trim(),
        slug: createOrgForm.slug.trim() || undefined,
        owner_name: hasOwner ? createOrgForm.owner_name.trim() : undefined,
        owner_email: hasOwner ? createOrgForm.owner_email.trim() : undefined,
        owner_password: hasOwner ? createOrgForm.owner_password : undefined,
      }),
    });
    if (sgen !== sessionGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure(requestToken);
      return;
    }
    if (!res.ok) {
      setCreateOrgError(await readError(res, `Could not create organization (HTTP ${res.status}).`));
      return;
    }
    const data = await res.json();
    if (sgen !== sessionGenRef.current) return;
    setCreateOrgOpen(false);
    setCreateOrgForm({ name: '', slug: '', owner_name: '', owner_email: '', owner_password: '' });
    loadAdminOrgs(sgen);
    if (data?.organization?.id) openAdminOrg(data.organization.id);
  } catch (e) {
    console.error('Create organization failed:', e);
    if (sgen === sessionGenRef.current) setCreateOrgError('Network error.');
  } finally {
    setCreateOrgBusy(false);
  }
};

const addUser = async () => {
  if (addUserBusy || !adminDetail) return;
  if (!addUserForm.name.trim() || !addUserForm.email.trim()) {
    setAddUserError('Name and email are required.');
    return;
  }
  if (addUserForm.password.length < 8) {
    setAddUserError('Password must be at least 8 characters.');
    return;
  }
  const orgId = adminDetail.org.id;
  const sgen = sessionGenRef.current;
  const requestToken = tokenRef.current;
  setAddUserBusy(true);
  setAddUserError(null);
  try {
    const res = await apiFetch(`${API_BASE}/admin/organizations/${encodeURIComponent(orgId)}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: addUserForm.name.trim(),
        email: addUserForm.email.trim(),
        role: addUserForm.role,
        password: addUserForm.password,
      }),
    });
    if (sgen !== sessionGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure(requestToken);
      return;
    }
    if (!res.ok) {
      setAddUserError(await readError(res, `Could not add user (HTTP ${res.status}).`));
      return;
    }
    setAddUserOpen(false);
    setAddUserForm({ name: '', email: '', role: 'member', password: '' });
    loadAdminOrgs(sgen);
    openAdminOrg(orgId);
  } catch (e) {
    console.error('Add user failed:', e);
    if (sgen === sessionGenRef.current) setAddUserError('Network error.');
  } finally {
    setAddUserBusy(false);
  }
};

const impersonate = async () => {
  if (impersonateBusy || !adminDetail || !impersonateTarget) return;
  const orgId = adminDetail.org.id;
  const userId = impersonateTarget.id;
  const sgen = sessionGenRef.current;
  const requestToken = tokenRef.current;
  setImpersonateBusy(true);
  setImpersonateError(null);
  try {
    const res = await apiFetch(
      `${API_BASE}/admin/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/impersonate`,
      { method: 'POST' }
    );
    if (sgen !== sessionGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure(requestToken);
      return;
    }
    if (!res.ok) {
      setImpersonateError(await readError(res, `Could not start impersonation (HTTP ${res.status}).`));
      return;
    }
    const data = await res.json();
    if (sgen !== sessionGenRef.current) return;
    setImpersonateTarget(null);
    onImpersonate(data);
  } catch (e) {
    console.error('Impersonation failed:', e);
    if (sgen === sessionGenRef.current) setImpersonateError('Network error.');
  } finally {
    setImpersonateBusy(false);
  }
};

  const sectionClass = "border-t border-border pt-4";
  const sectionHeadClass = "flex items-center justify-between border-b border-border pb-2";
  const sectionBodyClass = "max-h-72 overflow-y-auto";

  return (
    <>
      <TabHeader
        title="Administration"
        description="Customer organizations — provisioning, audited support access and controlled impersonation."
      />

      {!isAdmin ? (
        <div className="mt-6 rounded-xl border border-border bg-card px-6 py-12 text-center text-[12.5px] text-muted-foreground">
          Platform admin access required.
        </div>
      ) : adminDetail ? (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Button size="icon" variant="ghost" onClick={closeAdminOrg} title="Back to organizations">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <h2 className="text-[19px] font-semibold tracking-[-0.015em]">{adminDetail.org.name}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {adminDetail.org.slug} · {adminDetail.org.plan || 'No plan'} · ID {adminDetail.org.id}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-8 flex-shrink-0 gap-1.5 text-[12px]"
              onClick={() => { setAddUserError(null); setAddUserOpen(true); }}
            >
              <UserPlus className="h-3.5 w-3.5" /> Add user
            </Button>
          </div>

          <div className="grid grid-cols-2 overflow-hidden border-y border-border md:grid-cols-4">
            {[
              { label: 'Domains', value: adminDetail.org.counts?.domain_count ?? adminDetail.domains.length, small: false },
              { label: 'Users', value: adminDetail.org.counts?.user_count ?? adminDetail.users.length, small: false },
              { label: 'Scans', value: adminDetail.org.counts?.scan_count ?? adminDetail.scans.length, small: false },
              { label: 'Last activity', value: adminDetail.org.counts?.last_activity ? formatDateTime(adminDetail.org.counts.last_activity) : '—', small: true },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`px-4 py-3 ${i < 2 ? 'border-b border-border md:border-b-0' : ''} ${i % 2 === 1 ? 'border-l border-border' : ''} ${i === 2 ? 'md:border-l md:border-border' : ''}`}
              >
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className={`mt-0.5 font-semibold tabular-nums ${s.small ? 'text-[12px]' : 'text-[20px] tracking-[-0.02em]'}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={sectionClass}>
              <div className={sectionHeadClass}><h3 className="text-[12.5px] font-medium">Domains</h3></div>
              <div className={sectionBodyClass}>
                {adminDetail.failed?.domains ? (
                  <p className="px-2 py-1.5 text-[12px] text-red-400/80">Domains unavailable — the request failed.</p>
                ) : (
                  <>
                    {adminDetail.domains.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No domains.</p>}
                    {adminDetail.domains.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] transition-colors hover:bg-white/[0.02]">
                        <span className="truncate font-mono text-[11.5px] font-medium">{d.name}</span>
                        <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                          {d.verified ? 'verified' : 'unverified'}
                          <Badge variant="outline" className={typeof d.last_score === 'number' ? (scoreBand(d.last_score) === 'passing' ? 'border-emerald-500/25 text-emerald-300' : scoreBand(d.last_score) === 'warnings' ? 'border-amber-500/25 text-amber-300' : 'border-red-500/25 text-red-300') : ''}>{typeof d.last_score === 'number' ? d.last_score : '—'}</Badge>
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            <section className={sectionClass}>
              <div className={sectionHeadClass}><h3 className="text-[12.5px] font-medium">Users</h3></div>
              <div className={sectionBodyClass}>
                {adminDetail.failed?.users ? (
                  <p className="px-2 py-1.5 text-[12px] text-red-400/80">Users unavailable — the request failed.</p>
                ) : (
                  <>
                    {adminDetail.users.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No users.</p>}
                    {adminDetail.users.map((u: any) => (
                      <div key={u.id} className="space-y-1.5 rounded px-2 py-1.5 transition-colors hover:bg-white/[0.02]">
                        <div className="flex items-center justify-between gap-2 text-[12px]">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[11.5px] font-medium">{u.email}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{u.name}</p>
                          </div>
                          <span className="flex flex-shrink-0 items-center gap-2">
                            {u.status === 'active' && u.platform_role !== 'platform_admin' && (
                              <button
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-[#ffc99f] hover:underline"
                                onClick={() => { setImpersonateError(null); setImpersonateTarget(u); }}
                              >
                                <LogIn className="h-3 w-3" /> Impersonate
                              </button>
                            )}
                            <button
                              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              onClick={() => {
                                pwFormGenRef.current += 1;
                                setPwResetFor(pwResetFor === u.id ? null : u.id);
                                setPwResetValue('');
                                setPwResetError(null);
                              }}
                            >
                              Reset
                            </button>
                            <Badge variant="outline">{u.role}{u.status !== 'active' ? ` · ${u.status}` : ''}</Badge>
                          </span>
                        </div>
                        {pwResetFor === u.id && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="password"
                              placeholder="New password (min 8)"
                              value={pwResetValue}
                              onChange={(e) => setPwResetValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && submitPasswordReset(adminDetail.org.id, u.id)}
                              className="h-8 min-w-[160px] flex-1 text-[12px]"
                            />
                            <Button size="sm" className="h-8" disabled={pwResetBusy} onClick={() => submitPasswordReset(adminDetail.org.id, u.id)}>
                              {pwResetBusy ? 'Setting…' : 'Set'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => { pwFormGenRef.current += 1; setPwResetFor(null); setPwResetValue(''); setPwResetError(null); }}>
                              Cancel
                            </Button>
                            {pwResetError && <span className="text-[11px] text-red-400">{pwResetError}</span>}
                          </div>
                        )}
                        {pwResetDone === u.id && (
                          <p className="text-[11px] text-emerald-400">Password updated — existing sessions were signed out.</p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={sectionClass}>
              <div className={sectionHeadClass}><h3 className="text-[12.5px] font-medium">Scan history</h3></div>
              <div className={sectionBodyClass}>
                {adminDetail.failed?.scans ? (
                  <p className="px-2 py-1.5 text-[12px] text-red-400/80">Scan history unavailable — the request failed.</p>
                ) : (
                  <>
                    {adminDetail.scans.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No scans yet.</p>}
                    {adminDetail.scans.map((s: any) => {
                      const scanDomain = adminDetail.domains.find((d: any) => d.id === s.domain_id);
                      return (
                        <div key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] transition-colors hover:bg-white/[0.02]">
                          <span className="truncate font-mono text-[11.5px]">{scanDomain?.name || s.domain_id}</span>
                          <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                            {typeof s.score === 'number' && <Badge variant="outline" className="tabular-nums">{s.score}</Badge>}
                            {formatDateTime(s.scanned_at)}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </section>

            <section className={sectionClass}>
              <div className={sectionHeadClass}><h3 className="text-[12.5px] font-medium">Channels</h3></div>
              <div className="space-y-1 p-2">
                {adminDetail.failed?.notifications ? (
                  <p className="px-2 py-1.5 text-[12px] text-red-400/80">Channel status unavailable — the request failed.</p>
                ) : (
                  <>
                    {[
                      { label: 'SMTP', on: !!adminDetail.notifications.smtp, detail: adminDetail.notifications.smtp ? `${adminDetail.notifications.smtp.host || '—'}${adminDetail.notifications.smtp.pass_configured ? ' · pass set' : ''}` : 'not configured' },
                      { label: 'Resend', on: !!adminDetail.notifications.resend, detail: adminDetail.notifications.resend ? (adminDetail.notifications.resend.from || 'configured') : 'not configured' },
                      { label: 'Slack', on: !!adminDetail.notifications.slack?.configured, detail: adminDetail.notifications.slack?.configured ? 'webhook set' : 'not configured' },
                    ].map((c) => (
                      <div key={c.label} className="flex items-center justify-between rounded px-2 py-1.5 text-[12px] transition-colors hover:bg-white/[0.02]">
                        <span className="font-medium">{c.label}</span>
                        <span className={`text-[11px] ${c.on ? 'text-emerald-400' : 'text-muted-foreground'}`}>{c.on ? `✓ ${c.detail}` : c.detail}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="border-y border-border">
          <div className="flex flex-col gap-3 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-[14px] font-semibold">
                <Building2 className="h-4 w-4 text-muted-foreground" /> Customer organizations
              </h3>

            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              {adminOrgs && adminOrgs.length > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {adminOrgs.length} {adminOrgs.length === 1 ? 'organization' : 'organizations'}
                </span>
              )}
              <Button
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => { setCreateOrgError(null); setCreateOrgOpen(true); }}
              >
                <Plus className="h-3.5 w-3.5" /> New organization
              </Button>
            </div>
          </div>
          <div>
            {adminLoading ? (
              <p className="py-2 text-[12px] text-muted-foreground">Loading organization…</p>
            ) : adminOrgsError ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-red-400/80">{adminOrgsError}</p>
                <Button size="sm" variant="outline" className="h-7" onClick={() => loadAdminOrgs()}>Retry</Button>
              </div>
            ) : adminOrgs === null ? (
              <p className="py-2 text-[12px] text-muted-foreground">Loading organizations…</p>
            ) : adminOrgs.length === 0 ? (
              <p className="py-2 text-[12px] text-muted-foreground">No organizations found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-2.5 font-medium">Organization</th>
                      <th className="px-4 py-2.5 font-medium">Plan</th>
                      <th className="px-4 py-2.5 font-medium">Domains</th>
                      <th className="px-4 py-2.5 font-medium">Users</th>
                      <th className="px-4 py-2.5 font-medium">Scans</th>
                      <th className="px-4 py-2.5 font-medium">Last activity</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminOrgs.map((o) => (
                      <tr key={o.id} className="border-b border-border transition-colors last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-3.5">
                          <p className="truncate text-[13px] font-medium">{o.name}</p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{o.slug}</p>
                        </td>
                        <td className="px-4 py-3.5">{o.plan ? <Badge variant="outline">{o.plan}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3.5 text-[12.5px] tabular-nums">{o.domain_count}</td>
                        <td className="px-4 py-3.5 text-[12.5px] tabular-nums">{o.user_count}</td>
                        <td className="px-4 py-3.5 text-[12.5px] tabular-nums">{o.scan_count}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-[11.5px] text-muted-foreground">{o.last_activity ? formatDateTime(o.last_activity) : '—'}</td>
                        <td className="px-4 py-3.5 text-right">
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-[12px]" onClick={() => openAdminOrg(o.id)}>View<ChevronRight className="w-3.5 h-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={createOrgOpen} onOpenChange={(open) => { if (!open && !createOrgBusy) setCreateOrgOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>
              Create a customer workspace. The first owner is optional; add one now or later.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createOrganization(); }}>
            <div>
              <label htmlFor="admin-org-name" className="text-[11.5px] text-muted-foreground">Workspace name</label>
              <Input
                id="admin-org-name"
                className="mt-1 h-9 text-[12.5px]"
                placeholder="Acme Security"
                value={createOrgForm.name}
                onChange={(e) => setCreateOrgForm({ ...createOrgForm, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="admin-org-slug" className="text-[11.5px] text-muted-foreground">Slug (optional)</label>
              <Input
                id="admin-org-slug"
                className="mt-1 h-9 font-mono text-[12px]"
                placeholder="auto-generated from the name"
                value={createOrgForm.slug}
                onChange={(e) => setCreateOrgForm({ ...createOrgForm, slug: e.target.value })}
              />
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[11.5px] font-medium">First owner <span className="font-normal text-muted-foreground">(optional)</span></p>
              <div>
                <label htmlFor="admin-owner-name" className="text-[11.5px] text-muted-foreground">Name</label>
                <Input
                  id="admin-owner-name"
                  className="mt-1 h-9 text-[12.5px]"
                  placeholder="Alex Morgan"
                  value={createOrgForm.owner_name}
                  onChange={(e) => setCreateOrgForm({ ...createOrgForm, owner_name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="admin-owner-email" className="text-[11.5px] text-muted-foreground">Email</label>
                <Input
                  id="admin-owner-email"
                  type="email"
                  className="mt-1 h-9 text-[12.5px]"
                  placeholder="owner@company.com"
                  value={createOrgForm.owner_email}
                  onChange={(e) => setCreateOrgForm({ ...createOrgForm, owner_email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="admin-owner-password" className="text-[11.5px] text-muted-foreground">Temporary password</label>
                <Input
                  id="admin-owner-password"
                  type="password"
                  className="mt-1 h-9 text-[12.5px]"
                  placeholder="At least 8 characters"
                  value={createOrgForm.owner_password}
                  onChange={(e) => setCreateOrgForm({ ...createOrgForm, owner_password: e.target.value })}
                />
              </div>
            </div>
            {createOrgError && <p className="text-[11.5px] text-red-400" role="alert">{createOrgError}</p>}
            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setCreateOrgOpen(false)} disabled={createOrgBusy}>Cancel</Button>
              <Button type="submit" disabled={createOrgBusy}>{createOrgBusy ? 'Creating…' : 'Create organization'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addUserOpen} onOpenChange={(open) => { if (!open && !addUserBusy) setAddUserOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Add a teammate to {adminDetail?.org?.name || 'this organization'}.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addUser(); }}>
            <div>
              <label htmlFor="admin-user-name" className="text-[11.5px] text-muted-foreground">Name</label>
              <Input
                id="admin-user-name"
                className="mt-1 h-9 text-[12.5px]"
                placeholder="Alex Morgan"
                value={addUserForm.name}
                onChange={(e) => setAddUserForm({ ...addUserForm, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="admin-user-email" className="text-[11.5px] text-muted-foreground">Email</label>
              <Input
                id="admin-user-email"
                type="email"
                className="mt-1 h-9 text-[12.5px]"
                placeholder="teammate@company.com"
                value={addUserForm.email}
                onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="admin-user-role" className="text-[11.5px] text-muted-foreground">Role</label>
              <select
                id="admin-user-role"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                value={addUserForm.role}
                onChange={(e) => setAddUserForm({ ...addUserForm, role: e.target.value })}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div>
              <label htmlFor="admin-user-password" className="text-[11.5px] text-muted-foreground">Temporary password</label>
              <Input
                id="admin-user-password"
                type="password"
                className="mt-1 h-9 text-[12.5px]"
                placeholder="At least 8 characters"
                value={addUserForm.password}
                onChange={(e) => setAddUserForm({ ...addUserForm, password: e.target.value })}
              />
            </div>
            {addUserError && <p className="text-[11.5px] text-red-400" role="alert">{addUserError}</p>}
            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setAddUserOpen(false)} disabled={addUserBusy}>Cancel</Button>
              <Button type="submit" disabled={addUserBusy}>{addUserBusy ? 'Adding…' : 'Add user'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!impersonateTarget} onOpenChange={(open) => { if (!open && !impersonateBusy) setImpersonateTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate user</DialogTitle>
            <DialogDescription>
              Act as {impersonateTarget?.email} in a short-lived, audited support session.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-[#ff9d52]/25 bg-[#ff9d52]/[0.06] px-3 py-2.5 text-[11.5px] leading-5 text-[#ffc99f]">
            You will see the customer workspace as this user. Use Return to admin in the top bar to come back.
          </div>
          {impersonateError && <p className="text-[11.5px] text-red-400" role="alert">{impersonateError}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setImpersonateTarget(null)} disabled={impersonateBusy}>Cancel</Button>
            <Button type="button" onClick={impersonate} disabled={impersonateBusy}>
              {impersonateBusy ? 'Starting…' : 'Start impersonation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
