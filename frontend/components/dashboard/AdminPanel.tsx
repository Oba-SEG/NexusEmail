"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Users, Globe, Shield, KeyRound, ChevronRight, ArrowLeft, RefreshCw, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { describeError } from "@/components/ui/status";
import { scoreBand, PASSING_SCORE } from "@/lib/scores";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface AdminPanelProps {
  token: string | null;
  isAdmin: boolean;
  sessionGenRef: { current: number };
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onAuthFailure: () => void;
}

/** Admin panel: org drill-down + password reset, with all admin state and
 * request-generation guards owned here. Unmounts with the dashboard
 * branch, so nothing survives an identity change. */
export default function AdminPanel({ token, isAdmin, sessionGenRef, apiFetch, onAuthFailure }: AdminPanelProps) {
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
    const res = await apiFetch(`${API_BASE}/admin/organizations`);
    if (gen !== sessionGenRef.current) return;
    if (res.status === 401) {
      onAuthFailure();
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
      onAuthFailure();
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
      onAuthFailure();
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

  return (
    <>
            {!isAdmin ? (
              <Card className="border-border/40 bg-white/[0.02]">
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  Platform admin access required.
                </CardContent>
              </Card>
            ) : adminDetail ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button size="icon" variant="ghost" onClick={closeAdminOrg} title="Back to organizations">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div>
                    <h2 className="font-display font-semibold">{adminDetail.org.name}</h2>
                    <p className="text-xs text-muted-foreground">{adminDetail.org.slug} · {adminDetail.org.plan || 'no plan'} · {adminDetail.org.id}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Domains', value: adminDetail.org.counts?.domain_count ?? adminDetail.domains.length },
                    { label: 'Users', value: adminDetail.org.counts?.user_count ?? adminDetail.users.length },
                    { label: 'Scans', value: adminDetail.org.counts?.scan_count ?? adminDetail.scans.length },
                    { label: 'Last activity', value: adminDetail.org.counts?.last_activity ? new Date(adminDetail.org.counts.last_activity).toLocaleString() : '—' },
                  ].map((s) => (
                    <Card key={s.label} className="border-border/40 bg-white/[0.02]">
                      <CardContent className="pt-4 pb-3">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                        <p className="font-display font-semibold text-lg">{s.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <Card className="border-border/40 bg-white/[0.02]">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Domains</CardTitle></CardHeader>
                    <CardContent className="space-y-2 max-h-72 overflow-y-auto">
                      {adminDetail.failed?.domains ? (
                        <p className="text-sm text-red-400/70">Domains unavailable — the request failed.</p>
                      ) : (
                        <>
                      {adminDetail.domains.length === 0 && <p className="text-sm text-muted-foreground">No domains.</p>}
                      {adminDetail.domains.map((d: any) => (
                        <div key={d.id} className="flex items-center justify-between gap-2 text-sm border-b border-border/30 pb-1.5">
                          <span className="truncate font-medium">{d.name}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                            {d.verified ? 'verified' : 'unverified'}
                            <Badge variant="outline" className={typeof d.last_score === 'number' ? (scoreBand(d.last_score) === 'passing' ? 'text-emerald-400 border-emerald-400/30' : scoreBand(d.last_score) === 'warnings' ? 'text-amber-400 border-amber-400/30' : 'text-red-400 border-red-400/30') : ''}>{typeof d.last_score === 'number' ? d.last_score : '—'}</Badge>
                          </span>
                        </div>
                      ))}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-border/40 bg-white/[0.02]">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Users</CardTitle></CardHeader>
                    <CardContent className="space-y-2 max-h-72 overflow-y-auto">
                      {adminDetail.failed?.users ? (
                        <p className="text-sm text-red-400/70">Users unavailable — the request failed.</p>
                      ) : (
                        <>
                      {adminDetail.users.length === 0 && <p className="text-sm text-muted-foreground">No users.</p>}
                      {adminDetail.users.map((u: any) => (
                        <div key={u.id} className="space-y-1.5 border-b border-border/30 pb-1.5">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{u.email}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.name}</p>
                            </div>
                            <span className="flex items-center gap-2 flex-shrink-0">
                              <button
                                className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <Input
                                type="password"
                                placeholder="New password (min 8)"
                                value={pwResetValue}
                                onChange={(e) => setPwResetValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && submitPasswordReset(adminDetail.org.id, u.id)}
                                className="h-8 text-sm flex-1 min-w-[160px]"
                              />
                              <Button size="sm" className="h-8" disabled={pwResetBusy} onClick={() => submitPasswordReset(adminDetail.org.id, u.id)}>
                                {pwResetBusy ? 'Setting…' : 'Set'}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8" onClick={() => { pwFormGenRef.current += 1; setPwResetFor(null); setPwResetValue(''); setPwResetError(null); }}>
                                Cancel
                              </Button>
                              {pwResetError && <span className="text-xs text-red-400">{pwResetError}</span>}
                            </div>
                          )}
                          {pwResetDone === u.id && (
                            <p className="text-[11px] text-emerald-400">Password updated — existing sessions were signed out.</p>
                          )}
                        </div>
                      ))}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <Card className="border-border/40 bg-white/[0.02]">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Scan history</CardTitle></CardHeader>
                    <CardContent className="space-y-2 max-h-72 overflow-y-auto">
                      {adminDetail.failed?.scans ? (
                        <p className="text-sm text-red-400/70">Scan history unavailable — the request failed.</p>
                      ) : (
                        <>
                      {adminDetail.scans.length === 0 && <p className="text-sm text-muted-foreground">No scans yet.</p>}
                      {adminDetail.scans.map((s: any) => {
                        const scanDomain = adminDetail.domains.find((d: any) => d.id === s.domain_id);
                        return (
                          <div key={s.id} className="flex items-center justify-between gap-2 text-sm border-b border-border/30 pb-1.5">
                            <span className="truncate">{scanDomain?.name || s.domain_id}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-2 flex-shrink-0">
                              {typeof s.score === 'number' && <Badge variant="outline">{s.score}</Badge>}
                              {s.scanned_at ? new Date(s.scanned_at).toLocaleString() : '—'}
                            </span>
                          </div>
                        );
                      })}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-border/40 bg-white/[0.02]">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Channels</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {adminDetail.failed?.notifications ? (
                        <p className="text-sm text-red-400/70">Channel status unavailable — the request failed.</p>
                      ) : (
                        <>
                      {[
                        { label: 'SMTP', on: !!adminDetail.notifications.smtp, detail: adminDetail.notifications.smtp ? `${adminDetail.notifications.smtp.host || '—'}${adminDetail.notifications.smtp.pass_configured ? ' · pass set' : ''}` : 'not configured' },
                        { label: 'Resend', on: !!adminDetail.notifications.resend, detail: adminDetail.notifications.resend ? (adminDetail.notifications.resend.from || 'configured') : 'not configured' },
                        { label: 'Slack', on: !!adminDetail.notifications.slack?.configured, detail: adminDetail.notifications.slack?.configured ? 'webhook set' : 'not configured' },
                      ].map((c) => (
                        <div key={c.label} className="flex items-center justify-between border-b border-border/30 pb-1.5">
                          <span className="font-medium">{c.label}</span>
                          <span className={`text-xs ${c.on ? 'text-emerald-400' : 'text-muted-foreground'}`}>{c.on ? `✓ ${c.detail}` : c.detail}</span>
                        </div>
                      ))}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <Card className="border-border/40 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Customer organizations</CardTitle>
                  <CardDescription>All hosted organizations — read-only support access, every view is audited.</CardDescription>
                </CardHeader>
                <CardContent>
                  {adminLoading ? (
                    <p className="text-sm text-muted-foreground">Loading organization…</p>
                  ) : adminOrgsError ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-red-400/80">{adminOrgsError}</p>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => loadAdminOrgs()}>Retry</Button>
                    </div>
                  ) : adminOrgs === null ? (
                    <p className="text-sm text-muted-foreground">Loading organizations…</p>
                  ) : adminOrgs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No organizations found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border/40">
                            <th className="py-2 pr-4 font-medium">Organization</th>
                            <th className="py-2 pr-4 font-medium">Plan</th>
                            <th className="py-2 pr-4 font-medium">Domains</th>
                            <th className="py-2 pr-4 font-medium">Users</th>
                            <th className="py-2 pr-4 font-medium">Scans</th>
                            <th className="py-2 pr-4 font-medium">Last activity</th>
                            <th className="py-2 font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminOrgs.map((o) => (
                            <tr key={o.id} className="border-b border-border/20 hover:bg-white/[0.02] transition-colors">
                              <td className="py-2.5 pr-4">
                                <p className="font-medium truncate">{o.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{o.slug}</p>
                              </td>
                              <td className="py-2.5 pr-4">{o.plan ? <Badge variant="outline">{o.plan}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                              <td className="py-2.5 pr-4 tabular-nums">{o.domain_count}</td>
                              <td className="py-2.5 pr-4 tabular-nums">{o.user_count}</td>
                              <td className="py-2.5 pr-4 tabular-nums">{o.scan_count}</td>
                              <td className="py-2.5 pr-4 text-xs text-muted-foreground">{o.last_activity ? new Date(o.last_activity).toLocaleString() : '—'}</td>
                              <td className="py-2.5 text-right">
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => openAdminOrg(o.id)}>View<ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
    </>
  );
}
