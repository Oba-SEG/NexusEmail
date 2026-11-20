"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, ChevronRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
}

/** Admin panel: org drill-down + password reset, with all admin state and
 * request-generation guards owned here. Unmounts with the dashboard
 * branch, so nothing survives an identity change. */
export default function AdminPanel({ token, isAdmin, sessionGenRef, tokenRef, apiFetch, onAuthFailure }: AdminPanelProps) {
const [adminOrgs, setAdminOrgs] = useState<any[] | null>(null);
const [adminOrgsError, setAdminOrgsError] = useState<string | null>(null);
const [adminDetail, setAdminDetail] = useState<any>(null);
const [adminLoading, setAdminLoading] = useState(false);
const [pwResetFor, setPwResetFor] = useState<string | null>(null);
const [pwResetValue, setPwResetValue] = useState('');
const [pwResetError, setPwResetError] = useState<string | null>(null);
const [pwResetBusy, setPwResetBusy] = useState(false);
const [pwResetDone, setPwResetDone] = useState<string | null>(null);
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

  const sectionClass = "border-t border-border pt-4";
  const sectionHeadClass = "flex items-center justify-between border-b border-border pb-2";
  const sectionBodyClass = "max-h-72 overflow-y-auto";

  return (
    <>
      <TabHeader
        title="Administration"
        description="Customer organizations — read-only support access, every view is audited."
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
            {adminOrgs && adminOrgs.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {adminOrgs.length} {adminOrgs.length === 1 ? 'organization' : 'organizations'}
              </span>
            )}
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
    </>
  );
}
