"use client";

import { useState, useEffect, useRef } from "react";

// Sentry (optional): activates only when NEXT_PUBLIC_SENTRY_DSN is set at build
// time; the chunk is never fetched otherwise.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import("@sentry/browser").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
    });
  });
}

import {
  Shield, Settings, Globe, Moon, Sun, BarChart3, Bell, Plug, Upload,
  X, LogOut, Building2
} from "lucide-react";
import { clearedDomainPanel, runDomainListLoad, recordState, recordToneClass } from "@/lib/domainPanel";
import { DNS_PROVIDERS, PROVIDER_BRAND, PROVIDER_METADATA, providerBrand, type ProviderField, type ProviderMeta } from "@/lib/providers";
import ProviderModal from "@/components/dashboard/ProviderModal";
import IntegrationsTab from "@/components/dashboard/IntegrationsTab";
import SettingsTab from "@/components/dashboard/SettingsTab";
import NotificationsTab from "@/components/dashboard/NotificationsTab";
import ReportsTab from "@/components/dashboard/ReportsTab";
import AdminPanel from "@/components/dashboard/AdminPanel";
import DomainsTab from "@/components/dashboard/DomainsTab";
import LoginScreen from "@/components/dashboard/LoginScreen";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import BrandsTab from "@/components/dashboard/BrandsTab";
import DomainDetailPanel from "@/components/dashboard/DomainDetailPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusViewport, notify, describeError, describeApiError, clearStatusQueue } from "@/components/ui/status";
import { PASSING_SCORE, WARNING_SCORE, scoreBand, filterByBand } from "@/lib/scores";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Scan rows exist in two storage shapes: object fields (spf/dkim/dmarc,
// scheduler + /scans/run) and flat *_status fields plus *_record JSON
// strings (audit routes; their *_status is always 'UNKNOWN' because
// auditEngine objects carry no status). Mirror of the backend's
// normalizeDnsResults: resolve a display row per record.
export default function Dashboard() {

  const [dmarcUploading, setDmarcUploading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailRefreshError, setDetailRefreshError] = useState<string | null>(null);
  const [dmarcUploadError, setDmarcUploadError] = useState<string | null>(null);
  const dmarcFileRef = useRef<HTMLInputElement>(null);
  const [fixRecommendations, setFixRecommendations] = useState<any>(null);
  // analysis results kept per requested domain — a row-level "Get fix
  // records" for a domain that isn't shown still lands, and is applied
  // when that domain is opened in the panel
  const fixResultsRef = useRef<Map<number, any>>(new Map());
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  // Bumped on every identity change (login, logout, auth failure). Async
  // settings responses carry the generation they were started under and
  // are dropped if a newer identity exists.
  const sessionGenRef = useRef(0);
  const notificationsRevRef = useRef(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState('');
  const [focusIntegrationsOnMount, setFocusIntegrationsOnMount] = useState(false);
  // Monotonic per-session sequence: a slower earlier /brands response must
  // not overwrite the state from a newer one (e.g. two schedule saves).
  const brandsLoadSeqRef = useRef(0);
  // Domain selection generation — same pattern as the brand details:
  // every open bumps it so an overlapping load or a slow upload refresh
  // for an earlier domain can't overwrite the newer selection. Declared
  // with the other refs, before any early return (rules of hooks).
  const domainDetailsGenRef = useRef(0);
  // The domain id the details panel currently shows — an upload must
  // refresh the panel it was started against, not whichever domain a
  // concurrent selection race installed.
  const domainDetailsIdRef = useRef<number | null>(null);
  // domain a detail request is currently fetching, owned by the
  // request sequence — an older Inspect settling must not clear a
  // newer request's pending entry (invalidate it if its target is
  // deleted while the request is in flight)
  const domainDetailsPendingRef = useRef<{ id: number; seq: number } | null>(null);
  // whether the SHOWN selection is a complete detail record (a list row
  // lacks dmarc_reports) — used to restart a detail fetch that a delete
  // invalidated while the row was still displayed
  const shownIsFullRef = useRef(false);
  const domainDetailsReqSeq = useRef(0);
  // list-generation: bumped on a successful delete so pre-delete list
  // responses cannot resurrect deleted domains into the list
  const domainListGenRef = useRef(0);
  // Brand currently shown in the details modal — responses for any other
  // brand are dropped (session gen can't catch same-session switches).
  // Selection generation — incremented on every open so overlapping
  // loads for the SAME brand (open A -> B -> A) can't have the older
  // response win the race and overwrite newer records.
  // Platform admin (issue #24): org list + drill-down, all read-only.
  const isAdmin = user?.platform_role === 'platform_admin';
  // Bumped on every org open/close so a slower earlier drill-down
  // response can never overwrite a newer selection (same lesson as
  // brandDetailsGenRef).
  // Admin password set (issue #43): inline per-user reset form.
  // Form-operation generation: bumped whenever the open reset form or
  // organization changes; a password response from an earlier form
  // generation must not touch the current one's state.
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<any>(null);
  // live mirrors of the panel state: handlers with stale closures
  // (e.g. a delete started before the panel changed) must read the
  // CURRENT values when invalidating or restarting detail fetches
  const selectedDomainRef = useRef<any>(null);
  const showDetailsRef = useRef(false);
  // set when a delete force-closed the panel because the SHOWN domain
  // was deleted: the reconcile may re-open the panel on the reconciled
  // selection (a system close, not a user close)
  const panelReopenRef = useRef(false);
  const setSelectedDomainSync = (d: any) => { selectedDomainRef.current = d; setSelectedDomain(d); };
  const setShowDetailsSync = (v: boolean) => { showDetailsRef.current = v; setShowDetails(v); };
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [notifications, setNotifications] = useState<any>({});
  const [settings, setSettings] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("domains");
  const [brands, setBrands] = useState([]);
  
  // Brand Protection Advanced
  // DMARC aggregate report ingestion (issue #64)
  // a detail-record fetch is in flight (Inspect click, or the loadDomains
  // reconcile for a domain installed from a list row): the report panel
  // shows a loading state until the full record (with dmarc_reports)
  // arrives, and an error state if the fetch fails

  const apiFetch = (url: string, options: any = {}) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  // T163b — explicit, narrow logout on detected stale session. Called only by
  // Identity change: admin drill-down state must not survive into another
  // session, and a non-admin must never land on the admin tab.

  // Domain details and its private report data must not survive an
  // identity change either: a new sign-in must never inherit the
  // previous identity's open panel.
  const resetDomainState = () => {
    domainDetailsGenRef.current += 1;
    const panel = clearedDomainPanel();
    setDomains(panel.domains);
    domainDetailsIdRef.current = panel.shownId;
    shownIsFullRef.current = false;
    setSelectedDomainSync(panel.selected);
    setShowDetailsSync(panel.showDetails);
    panelReopenRef.current = false;
    setDmarcUploading(false);
    setDmarcUploadError(null);
  };

  // load* handlers when they see a 401 against an authenticated endpoint —
  // not from inside apiFetch itself, because apiFetch is also used by the
  // login flow (where a 401 from /auth/login is the normal "wrong password"
  // path and must NOT trigger session reset).
  const handleAuthFailure = () => {
    localStorage.removeItem('nexusemail_token');
    localStorage.removeItem('nexusemail_user');
    sessionGenRef.current += 1;
    // Secrets must not survive an identity change in the SPA state.
    clearStatusQueue();
    setSettings(null);
    resetDomainState();
    // Tab ownership is Dashboard-level and survives AdminPanel unmount:
    // a non-admin signing in after an admin must not land on the admin tab.
    if (activeTab === 'admin') setActiveTab('domains');
    setToken(null);
    setUser(null);
    setConfigLoaded(false);
    setConfigError('');
  };

  // Load local session.
  useEffect(() => {
    const storedToken = localStorage.getItem('nexusemail_token');
    const storedUser = localStorage.getItem('nexusemail_user');
    if (storedToken) setToken(storedToken);
    if (storedUser) setUser(JSON.parse(storedUser));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadDomains();
    loadSettings();
    loadBrands();
  }, [token]);

  const login = async () => {
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      if (!res.ok) throw new Error('Invalid email or password');
      const data = await res.json();
      // New identity: invalidate any in-flight settings responses.
      sessionGenRef.current += 1;
      clearStatusQueue();
      setSettings(null);
      setConfigLoaded(false);
      setConfigError('');
      resetDomainState();
      if (activeTab === 'admin') setActiveTab('domains');
      localStorage.setItem('nexusemail_token', data.token);
      localStorage.setItem('nexusemail_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (e: any) {
      setLoginError(e.message || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    // Revoke server-side before clearing local state. The request uses the
    // current session's token (React state, not localStorage — another tab
    // may have overwritten it with a different identity) and must be
    // confirmed; on failure the session stays and the user is told.
    // sessionGen guard: the await spans a possible identity change (a 401
    // elsewhere can trigger handleAuthFailure and a fresh sign-in); a stale
    // continuation must not clear the newer session.
    const gen = sessionGenRef.current;
    try {
      const res = await fetch(`${API_BASE}/auth/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` }
      });
      if (gen !== sessionGenRef.current) return;
      if (!res.ok) {
        setLogoutNotice('Sign-out did not complete: the server could not revoke the session. Try again.');
        return;
      }
    } catch {
      if (gen !== sessionGenRef.current) return;
      setLogoutNotice('Sign-out did not complete: network error. Try again.');
      return;
    }
    if (gen !== sessionGenRef.current) return;
    setLogoutNotice(null);
    localStorage.removeItem('nexusemail_token');
    localStorage.removeItem('nexusemail_user');
    sessionGenRef.current += 1;
    // Secrets must not survive an identity change in the SPA state.
    clearStatusQueue();
    setSettings(null);
    resetDomainState();
    // Tab ownership is Dashboard-level and survives AdminPanel unmount:
    // a non-admin signing in after an admin must not land on the admin tab.
    if (activeTab === 'admin') setActiveTab('domains');
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return (
      <LoginScreen
        loginForm={loginForm}
        onFormChange={setLoginForm}
        onSubmit={login}
        loggingIn={loggingIn}
        loginError={loginError}
      />
    );
  }

  const loadBrands = async (gen: number = sessionGenRef.current) => {
    const seq = ++brandsLoadSeqRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands`);
      if (gen !== sessionGenRef.current) return;
      if (seq !== brandsLoadSeqRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load brands: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      if (seq !== brandsLoadSeqRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Failed to load brands: API returned non-array', data);
        return;
      }
      setBrands(data);
    } catch (e) {
      console.error('Failed to load brands:', e);
    }
  };









  const loadDomains = async (gen: number = sessionGenRef.current) => {
    const listGen = domainListGenRef.current;
    try {
      const result = await runDomainListLoad(() => apiFetch(`${API_BASE}/domains`), {
        domains,
        selected: selectedDomain,
        showDetails,
        shownId: domainDetailsIdRef.current,
      });
      // A list response that predates a successful delete is stale:
      // drop it instead of restoring deleted domains into the list.
      if (listGen !== domainListGenRef.current) return;
      // Generation is re-checked BEFORE any identity reset: a stale load
      // from session A must never sign the newer session out.
      if (gen !== sessionGenRef.current) return;
      if (result.kind === 'auth') {
        handleAuthFailure();
        return;
      }
      if (result.kind !== 'ok') {
        console.error('Failed to load domains (non-ok response or invalid payload)');
        return;
      }
      const next = result.state;
      setDomains(next.domains);
      // Reconcile against the CURRENT shown domain (the ref, kept in
      // sync with the selection everywhere): a selection whose domain
      // is still in the returned list survives — including a delayed
      // load racing an Inspect; a selection whose domain is gone
      // (deleted) is replaced by the auto-selected first domain, or
      // cleared (closing the panel) when the list is empty.
      const presentIds = next.domains.map((d: any) => d.id);
      for (const id of Array.from(fixResultsRef.current.keys())) {
        if (!presentIds.includes(id)) fixResultsRef.current.delete(id);
      }
      const stillThere = domainDetailsIdRef.current !== null &&
        presentIds.includes(domainDetailsIdRef.current);
      const shownGone = domainDetailsIdRef.current !== null && !stillThere;
      // a successful apply consumes any pending reopen intent, even
      // when the current selection is retained — otherwise a later
      // reconcile could open the panel without user action
      const pendingReopen = panelReopenRef.current;
      panelReopenRef.current = false;
      const pendingId = domainDetailsPendingRef.current ? domainDetailsPendingRef.current.id : null;
      const pendingGone = pendingId !== null && !presentIds.includes(pendingId);
      if (shownGone || pendingGone) {
        // A detail request targets a deleted domain (the pending
        // Inspect target, and/or the shown domain was deleted while
        // its details were open): invalidate the pending request
        // BEFORE re-selecting, so a late viewDomain success for the
        // removed domain cannot select the deleted domain again.
        domainDetailsGenRef.current += 1;
      }
      if (!stillThere) {
        // Nothing shown (nothing selected yet, or deleteDomains
        // cleared the panel) or the shown domain was deleted: apply
        // the reconciled selection — the first remaining domain, or
        // none when the list is empty. Details open/close state
        // follows applyDomainList: an existing showDetails carries
        // over to the reconciled selection; an empty list closes the
        // panel.
        domainDetailsIdRef.current = next.selected ? next.selected.id : null;
        shownIsFullRef.current = false; // a list row lacks dmarc_reports
        setSelectedDomainSync(next.selected);
        // applyDomainList semantics: an open details panel carries over
        // to the reconciled selection; an empty list closes the panel.
        // The LIVE visibility (refs, not the render snapshot) decides —
        // a user Close during the flight must not re-open the panel,
        // while a delete's system close may carry over.
        const liveOpen = pendingReopen || showDetailsRef.current;
        setShowDetailsSync(next.selected ? liveOpen : false);
        if (next.selected && liveOpen) {
          // The reconciled selection came from the list (a row without
          // dmarc_reports): fetch its detail record so the report panel
          // shows real data instead of a false "no reports" state.
          viewDomain(next.selected);
        }
      }
    } catch (e) {
      console.error('Failed to load domains:', e);
    } finally {
      setLoading(false);
    }
  };


  const loadSettings = async () => {
    // Tag this request with the current session generation; if logout,
    // auth failure, or a new login happens while it is in flight, the
    // response is stale and must not touch the new identity's state.
    const gen = sessionGenRef.current;
    // Preference writes are independent of settings reloads: a GET that
    // started before a toggle was saved must not resurrect the old values.
    const prefsRev = notificationsRevRef.current;
    setConfigError('');
    try {
      const res = await apiFetch(`${API_BASE}/settings/config`);
      const data = await res.json().catch(() => null);
      if (gen !== sessionGenRef.current) return;
      if (!res.ok || !data || typeof data !== 'object' || data.error) {
        setConfigError('Settings couldn\'t be loaded.');
        return;
      }
      setSettings(data);
      setConfigLoaded(true);
      if (prefsRev === notificationsRevRef.current) setNotifications(data.notifications || {});
    } catch (e) {
      if (gen === sessionGenRef.current) setConfigError('Settings couldn\'t be loaded.');
      console.error('Failed to load settings:', e);
    }
  };

  const saveNotifications = async (key: string, value: boolean) => {
    const gen = sessionGenRef.current;
    try {
      const current = { ...notifications, [key]: value };
      const res = await apiFetch(`${API_BASE}/settings/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current)
      });
      const data = await res.json().catch(() => null);
      // A save from a previous identity must never touch this session's
      // preferences or invalidate its in-flight config load.
      if (gen !== sessionGenRef.current) return;
      if (!res.ok || !data || data.success !== true) {
        // The write outcome is unknown (the multi-key endpoint can fail after
        // saving one key): re-read stored values instead of guessing.
        notify('Preference couldn\'t be saved.', 'error', describeApiError((data && data.error) || `HTTP ${res.status}`));
        loadSettings();
        return;
      }
      // Only a saved preference invalidates an in-flight settings response:
      // a failed write must not discard the loaded values.
      notificationsRevRef.current += 1;
      setNotifications(current);
    } catch (e) {
      console.error('Failed to save notifications:', e);
    }
  };


  const scanDomain = async (domainId: number) => {
    const gen = sessionGenRef.current;
    try {
      await apiFetch(`${API_BASE}/domains/${domainId}/scan`, { method: 'POST' });
      await loadDomains(gen);
    } catch (e) {
      console.error('Scan failed:', e);
    }
  };

  const bulkScan = async () => {
    if (selectedIds.length === 0) return;
    const gen = sessionGenRef.current;
    setScanning(true);
    
    try {
      await apiFetch(`${API_BASE}/domains/bulk-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_ids: selectedIds })
      });
      await loadDomains(gen);
      setSelectedIds([]);
    } catch (e) {
      console.error('Bulk scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  const deleteDomains = async () => {
    if (selectedIds.length === 0) return;
    const gen = sessionGenRef.current;
    // names snapshot for the undo affordance — ids die with the rows
    const deletedNames = domains
      .filter(d => selectedIds.includes(d.id))
      .map(d => d.name);
    
    try {
      const res = await apiFetch(`${API_BASE}/settings/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_ids: selectedIds })
      });
      // The invalidations below are gated on the session generation:
      // if A's delete resolves after logout/login as B, B's in-flight
      // list responses must NOT be dropped by A's generation bumps.
      if (res.ok && gen === sessionGenRef.current) {
        // A successful delete may have removed the target of an
        // in-flight Inspect (or the shown domain): invalidate pending
        // detail requests now — before the reload (which may itself
        // fail) reconciles the panel. Also bump the list generation
        // so pre-delete list responses are dropped.
        domainDetailsGenRef.current += 1;
        domainListGenRef.current += 1;
        domainDetailsPendingRef.current = null;
        // the invalidated detail request can no longer clear this
        // itself (its seq ownership is gone) — clear it here so the
        // panel does not stay on the loading state
        setDetailRefreshing(false);
        // If the shown selection is a list row whose detail fetch was
        // just invalidated, restart it: the next reload retains the
        // domain and starts no replacement, so otherwise the report
        // panel would show a false "no reports" state for a row
        // without dmarc_reports.
        if (domainDetailsIdRef.current !== null && !shownIsFullRef.current && showDetailsRef.current && selectedDomainRef.current) {
          viewDomain(selectedDomainRef.current);
        }
        // If the SHOWN domain was deleted, clear the panel right away:
        // a failed reload must not leave a deleted domain's details
        // (and upload action) on screen. A successful reload still
        // applies the first remaining selection — with the ref null,
        // the reconcile auto-selects it.
        const deletedShown = domainDetailsIdRef.current !== null &&
          selectedIds.includes(domainDetailsIdRef.current);
        if (deletedShown) {
          // preserve the PRIOR visibility: a reopen intent only when
          // the panel was actually open when the delete happened
          panelReopenRef.current = showDetailsRef.current;
          domainDetailsIdRef.current = null;
          setSelectedDomainSync(null);
          setShowDetailsSync(false);
        }
      }
      await loadDomains(gen);
      setSelectedIds([]);
      if (res.ok && gen === sessionGenRef.current && deletedNames.length > 0) {
        notify(
          `Deleted ${deletedNames.length} ${deletedNames.length === 1 ? 'domain' : 'domains'}.`,
          'success',
          undefined,
          {
            label: 'Undo',
            onClick: () => {
              const undoGen = sessionGenRef.current;
              apiFetch(`${API_BASE}/domains/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domains: deletedNames })
              })
                .then(r => r.json())
                .then(async data => {
                  if (undoGen !== sessionGenRef.current) return;
                  const restored = data.added || [];
                  const failed = data.failed || [];
                  if (restored.length > 0 && failed.length === 0) {
                    notify(`Restored ${restored.length} ${restored.length === 1 ? 'domain' : 'domains'} — rescanning.`, 'info');
                  } else if (restored.length > 0) {
                    notify(`Restored ${restored.length} of ${deletedNames.length}. Not restored: ${failed.map((f: any) => f.name).join(', ')}.`, 'error', failed.map((f: any) => `${f.name}: ${f.error}`).join('; '));
                  } else {
                    notify('Undo failed — none of the domains could be re-added.', 'error', failed.map((f: any) => `${f.name}: ${f.error}`).join('; ') || undefined);
                    return;
                  }
                  // fresh rows are invisible to a stale list response
                  domainListGenRef.current += 1;
                  await loadDomains(undoGen);
                  // scan only the restored names and report scan failures
                  try {
                    const scanRes = await apiFetch(`${API_BASE}/domains/bulk-scan`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ names: restored })
                    });
                    if (undoGen !== sessionGenRef.current) return;
                    if (scanRes.ok) {
                      const scanBody = await scanRes.json();
                      // identity may have changed while the body was pending
                      if (undoGen !== sessionGenRef.current) return;
                      const scanFailed = (scanBody.results || []).filter((r: any) => r.error);
                      if (scanFailed.length > 0) {
                        notify(`Scan failed for ${scanFailed.map((s: any) => s.domain).join(', ')}.`, 'error', 'Use Re-scan on the domain row to retry.');
                      }
                    } else {
                      notify('The follow-up scan failed — use Re-scan on the domain row.', 'error', describeApiError(`HTTP ${scanRes.status}`));
                    }
                  } catch (e) {
                    if (undoGen === sessionGenRef.current) notify('The follow-up scan failed — use Re-scan on the domain row.', 'error', describeError(e, 'The scan request could not be completed.'));
                  }
                })
                .catch(() => {
                  if (undoGen === sessionGenRef.current) notify('Undo failed — the request could not be completed.', 'error');
                });
            }
          }
        );
      }
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === domains.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(domains.map(d => d.id));
    }
  };

  // Selection generation for domain details — same pattern as the brand
  // details: every open bumps it so an overlapping load or a slow upload
  // refresh for an earlier domain can't overwrite the newer selection.
  const viewDomain = async (domain: any) => {
    const gen = sessionGenRef.current;
    const selGen = ++domainDetailsGenRef.current;
    const seq = ++domainDetailsReqSeq.current;
    domainDetailsPendingRef.current = { id: domain.id, seq };
    setDetailRefreshError(null);
    setDetailRefreshing(true);
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domain.id}`);
      const data = await res.json();
      if (gen !== sessionGenRef.current || selGen !== domainDetailsGenRef.current) return;
      if (!res.ok || data.error) {
        setDetailRefreshError('Failed to load domain details');
        return;
      }
      // The shown-domain ref follows the successful selection only — a
      // failed Inspect leaves the panel (and the ref) on the previous
      // domain, so uploads for it keep refreshing (transition semantics
      // unit-tested in lib/domainPanel).
      setFixRecommendations(fixResultsRef.current.get(domain.id) ?? null);
      domainDetailsIdRef.current = domain.id;
      shownIsFullRef.current = true;
      setSelectedDomainSync(data);
      setShowDetailsSync(true);
      setDetailRefreshing(false);
    } catch (e) {
      console.error('Failed to load domain details:', e);
      if (gen === sessionGenRef.current && selGen === domainDetailsGenRef.current) {
        setDetailRefreshError('Failed to load domain details');
      }
    } finally {
      // only the settling request may clear its own pending entry —
      // an older Inspect to the same domain must not clear the
      // newer request's entry
      if (domainDetailsPendingRef.current?.seq === seq) {
        domainDetailsPendingRef.current = null;
        setDetailRefreshing(false);
      }
    }
  };

  // DMARC aggregate report ingestion (issue #64): upload RFC 7489 XML,
  // then refresh the domain detail so the new insights show up. Both
  // the session generation and the domain-selection generation are
  // captured and re-checked before applying anything, so a slow upload
  // can never leak one identity's data into another session or replace
  // a newer selection.
  const uploadDmarcReport = async (domainId: number, file: File) => {
    const gen = sessionGenRef.current;
    const selGen = domainDetailsGenRef.current;
    setDmarcUploadError(null);
    setDmarcUploading(true);
    try {
      const xml = await file.text();
      const res = await apiFetch(`${API_BASE}/domains/${domainId}/dmarc-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: xml
      });
      const data = await res.json();
      if (gen !== sessionGenRef.current || selGen !== domainDetailsGenRef.current) return;
      if (!res.ok || data.error) {
        setDmarcUploadError(data.error || 'Upload failed');
        return;
      }
      // The upload is associated with the domain it was started against:
      // if the user has switched to another domain meanwhile, its panel
      // must not be replaced by this refresh.
      if (domainDetailsIdRef.current !== domainId) {
        setDmarcUploadError('Report uploaded, but the details panel has switched domains');
        return;
      }
      const fresh = await apiFetch(`${API_BASE}/domains/${domainId}`);
      const freshData = await fresh.json();
      if (gen !== sessionGenRef.current || selGen !== domainDetailsGenRef.current) return;
      if (domainDetailsIdRef.current !== domainId) return;
      if (!fresh.ok || freshData.error) {
        // the domain may have been deleted mid-upload — keep the current
        // details instead of installing the error object
        setDmarcUploadError(freshData.error || 'Domain details refresh failed');
        return;
      }
      setSelectedDomainSync(freshData);
    } catch (e) {
      if (gen === sessionGenRef.current && selGen === domainDetailsGenRef.current) {
        setDmarcUploadError('Upload failed: ' + (e as Error).message);
      }
    } finally {
      // Only the upload that owns the current session may clear the
      // busy state — an identity switch can start a newer upload while
      // this one is still pending.
      if (gen === sessionGenRef.current) setDmarcUploading(false);
    }
  };

  const fixDomain = async (domainId: number) => {
    const gen = sessionGenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domainId}/analyze-fix`, { method: 'POST' });
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      
      if (data.error) {
        notify('Couldn\'t analyze this domain.', 'error', describeApiError(data.error));
        return;
      }

      fixResultsRef.current.set(domainId, data);
      // apply immediately only when this is still the shown domain and
      // the panel is open — otherwise the records surface when the
      // operator opens that domain (no surprise panel reopen)
      if (domainDetailsIdRef.current === domainId && showDetailsRef.current) {
        setFixRecommendations(data);
      }
    } catch (e) {
      notify('Couldn\'t analyze this domain.', 'error', describeError(e, 'The analysis request failed.'));
    }
  };






  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <StatusViewport />
        <div className="text-center">
          <div className="nbp-mark w-16 h-16 mx-auto mb-5 text-[20px] animate-pulse">NBP</div>
          <p className="font-display text-base font-semibold tracking-tight">Nexus Brand Protection</p>
          <p className="text-xs text-muted-foreground mt-1">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StatusViewport />
      <div className="min-h-screen text-foreground" style={{background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)"}}>
          <DashboardChrome
            user={user}
            logoutNotice={logoutNotice}
            onLogout={logout}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isAdmin={isAdmin}
          >

            <TabsContent value="domains" className="space-y-4">
              <DomainsTab
                domains={domains}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                toggleSelectAll={toggleSelectAll}
                setSelectedIds={setSelectedIds}
                scanning={scanning}
                bulkScan={bulkScan}
                deleteDomains={deleteDomains}
                scanDomain={scanDomain}
                viewDomain={viewDomain}
                apiFetch={apiFetch}
                sessionGenRef={sessionGenRef}
                loadDomains={loadDomains}
                selectedDomain={selectedDomain}
                fixRecommendations={fixRecommendations}
                detailRefreshing={detailRefreshing}
                detailRefreshError={detailRefreshError}
                dmarcUploading={dmarcUploading}
                dmarcUploadError={dmarcUploadError}
                dmarcFileRef={dmarcFileRef}
                uploadDmarcReport={uploadDmarcReport}
                fixDomain={fixDomain}
                onClosePanel={() => { panelReopenRef.current = false; setShowDetailsSync(false); }}
                showDetails={showDetails}
              />
            </TabsContent>

            <TabsContent value="integrations" className="space-y-6">
              <IntegrationsTab
                settings={settings}
                loadSettings={loadSettings}
                sessionGenRef={sessionGenRef}
                apiFetch={apiFetch}
                focusHeadingOnMount={focusIntegrationsOnMount}
                onFocusConsumed={() => setFocusIntegrationsOnMount(false)}
              />
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6">
              <NotificationsTab
                notifications={notifications}
                settings={settings}
                onSavePref={saveNotifications}
                apiFetch={apiFetch}
                loadSettings={loadSettings}
                sessionGenRef={sessionGenRef}
                configLoaded={configLoaded}
                configError={configError}
                onRetryConfig={loadSettings}
                canManageSmtp={user?.role === 'owner' || user?.role === 'admin'}
              />
            </TabsContent>

            <TabsContent value="reports" className="space-y-6">
              <ReportsTab domains={domains} apiFetch={apiFetch} />
            </TabsContent>

            <TabsContent value="settings" className="space-y-6">
              <SettingsTab
                settings={settings}
                onSettingsChange={setSettings}
                apiFetch={apiFetch}
                onGoToIntegrations={() => {
                  // One-time request consumed by Integrations on mount, so
                  // ordinary tab switches never move focus.
                  setFocusIntegrationsOnMount(true);
                  setActiveTab('integrations');
                }}
              />
            </TabsContent>

            <TabsContent value="brands" className="space-y-6">
              <BrandsTab
                brands={brands}
                domains={domains}
                loadBrands={loadBrands}
                apiFetch={apiFetch}
                sessionGenRef={sessionGenRef}
                onGoToDomains={() => setActiveTab('domains')}
                onAuthFailure={handleAuthFailure}
              />
            </TabsContent>

            <TabsContent value="admin" className="space-y-4">
              <AdminPanel
                token={token}
                isAdmin={isAdmin}
                sessionGenRef={sessionGenRef}
                apiFetch={apiFetch}
                onAuthFailure={handleAuthFailure}
              />
            </TabsContent>

          </DashboardChrome>

        <footer className="border-t border-border/40 py-6 mt-10">
          <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
            <p>Nexus Brand Protection</p>
          </div>
        </footer>

      </div>
    </div>
  );
}
