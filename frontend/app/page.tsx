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
  Shield, Search, Settings, Activity, AlertTriangle,
  CheckCircle, XCircle, Globe, Plus, RefreshCw, Zap,
  Eye, Moon, Sun, ChevronRight, Server, Mail, Key,
  FileText, BarChart3, Bell, Plug, Clock, Wrench,
  TrendingUp, TrendingDown, Minus, Download, Trash2,
  CheckSquare, Square, MoreHorizontal, Save, MailPlus,
  MessageSquare, Send, Upload,
  X, LogOut, Building2, ArrowLeft
} from "lucide-react";
import { clearedDomainPanel, runDomainListLoad, recordState, recordToneClass } from "@/lib/domainPanel";
import { DNS_PROVIDERS, PROVIDER_BRAND, PROVIDER_METADATA, providerBrand, type ProviderField, type ProviderMeta } from "@/lib/providers";
import ProviderModal from "@/components/dashboard/ProviderModal";
import IntegrationsTab from "@/components/dashboard/IntegrationsTab";
import SettingsTab from "@/components/dashboard/SettingsTab";
import NotificationsTab from "@/components/dashboard/NotificationsTab";
import ReportsTab from "@/components/dashboard/ReportsTab";
import AdminPanel from "@/components/dashboard/AdminPanel";
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
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  // Bumped on every identity change (login, logout, auth failure). Async
  // settings responses carry the generation they were started under and
  // are dropped if a newer identity exists.
  const sessionGenRef = useRef(0);
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
  const brandDetailsRef = useRef<number | null>(null);
  // Selection generation — incremented on every open so overlapping
  // loads for the SAME brand (open A -> B -> A) can't have the older
  // response win the race and overwrite newer records.
  const brandDetailsGenRef = useRef(0);
  // Platform admin (issue #24): org list + drill-down, all read-only.
  const isAdmin = user?.platform_role === 'platform_admin';
  // Bumped on every org open/close so a slower earlier drill-down
  // response can never overwrite a newer selection (same lesson as
  // brandDetailsGenRef).
  // Admin password set (issue #43): inline per-user reset form.
  // Form-operation generation: bumped whenever the open reset form or
  // organization changes; a password response from an earlier form
  // generation must not touch the current one's state.
  const [loginForm, setLoginForm] = useState({ email: 'admin@segbytes.xyz', password: '' });
  const [loginError, setLoginError] = useState('');
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [domainInput, setDomainInput] = useState("");
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDomainError, setAddDomainError] = useState<string | null>(null);
  const [addDomainSuccess, setAddDomainSuccess] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [integrations, setIntegrations] = useState([]);
  const [notifications, setNotifications] = useState<any>({});
  const [settings, setSettings] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("domains");
  const [brands, setBrands] = useState([]);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyDomain, setVerifyDomain] = useState<any>(null);
  const [verifyToken, setVerifyToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [newBrandDomain, setNewBrandDomain] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [brandScanResult, setBrandScanResult] = useState<any>(null);
  const [brandScanning, setBrandScanning] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  
  // Brand Protection Advanced
  const [monitoredBrands, setMonitoredBrands] = useState<any[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<any>(null);
  const [showTakedownModal, setShowTakedownModal] = useState(false);
  const [showThreatModal, setShowThreatModal] = useState(false);
  const [takedownForm, setTakedownForm] = useState({ domain: '', threat_type: 'impersonation', evidence: '', contact_email: '' });
  const [threatForm, setThreatForm] = useState({ domain: '', threat_type: 'manual', severity: 'medium', notes: '' });
  const [brandThreats, setBrandThreats] = useState<any[]>([]);
  const [brandTakedowns, setBrandTakedowns] = useState<any[]>([]);
  const [brandAlerts, setBrandAlerts] = useState<any[]>([]);
  const [bulkScanning, setBulkScanning] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
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
    setToken(null);
    setUser(null);
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
    loadIntegrations();
    loadSettings();
    loadBrands();
    loadAlerts();
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
      resetDomainState();
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
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <StatusViewport />
        <Card className="w-full max-w-md bg-slate-900 border-slate-800 text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Nexus Brand Protection</CardTitle>
            <CardDescription>Sign in through your Segbytes client account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
            <Input placeholder="Password" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && login()} />
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            <Button className="w-full" onClick={login} disabled={loggingIn}>{loggingIn ? 'Signing in...' : 'Sign in'}</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const loadBrands = async (gen: number = sessionGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/brands`);
      if (gen !== sessionGenRef.current) return;
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
      if (!Array.isArray(data)) {
        console.error('Failed to load brands: API returned non-array', data);
        return;
      }
      setBrands(data);
      setMonitoredBrands(data);
    } catch (e) {
      console.error('Failed to load brands:', e);
    }
  };

  const loadAlerts = async (gen: number = sessionGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load alerts: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Failed to load alerts: API returned non-array', data);
        return;
      }
      setBrandAlerts(data);
    } catch (e) {
      console.error('Failed to load alerts:', e);
    }
  };

  const bulkScanAll = async () => {
    const gen = sessionGenRef.current;
    setBulkScanning(true);
    try {
      await apiFetch(`${API_BASE}/brands/scan/all`, { method: 'POST' });
      loadBrands(gen);
      loadAlerts(gen);
    } catch (e) {
      console.error('Bulk scan failed:', e);
    } finally {
      setBulkScanning(false);
    }
  };

  const loadBrandThreats = async (brandId: number, gen: number = sessionGenRef.current, sel: number = brandDetailsGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/threats`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load threats: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      // Same-session brand switch: drop responses that no longer belong
      // to the brand currently shown in the details modal...
      if (brandDetailsRef.current !== brandId) return;
      // ...or from an earlier visit to this same brand (A -> B -> A).
      if (sel !== brandDetailsGenRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Failed to load threats: API returned non-array', data);
        return;
      }
      setBrandThreats(data);
    } catch (e) {
      console.error('Failed to load threats:', e);
    }
  };

  const loadBrandTakedowns = async (brandId: number, gen: number = sessionGenRef.current, sel: number = brandDetailsGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/takedowns`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load takedowns: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      // Same-session brand switch: drop responses that no longer belong
      // to the brand currently shown in the details modal...
      if (brandDetailsRef.current !== brandId) return;
      // ...or from an earlier visit to this same brand (A -> B -> A).
      if (sel !== brandDetailsGenRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Failed to load takedowns: API returned non-array', data);
        return;
      }
      setBrandTakedowns(data);
    } catch (e) {
      console.error('Failed to load takedowns:', e);
    }
  };

  const markAsSafe = async (brandId: number, domain: string) => {
    const gen = sessionGenRef.current;
    try {
      await apiFetch(`${API_BASE}/brands/${brandId}/safe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      loadBrands(gen);
      loadBrandThreats(brandId, gen);
    } catch (e) {
      console.error('Failed to mark as safe:', e);
    }
  };

  const submitTakedown = async (brandId: number) => {
    const gen = sessionGenRef.current;
    try {
      await apiFetch(`${API_BASE}/brands/${brandId}/takedown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(takedownForm)
      });
      setShowTakedownModal(false);
      setTakedownForm({ domain: '', threat_type: 'impersonation', evidence: '', contact_email: '' });
      loadBrandTakedowns(brandId, gen);
    } catch (e) {
      console.error('Failed to submit takedown:', e);
    }
  };

  const addThreat = async (brandId: number) => {
    const gen = sessionGenRef.current;
    try {
      await apiFetch(`${API_BASE}/brands/${brandId}/threat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(threatForm)
      });
      setShowThreatModal(false);
      setThreatForm({ domain: '', threat_type: 'manual', severity: 'medium', notes: '' });
      loadBrandThreats(brandId, gen);
    } catch (e) {
      console.error('Failed to add threat:', e);
    }
  };

  const openBrandDetails = async (brand: any) => {
    setSelectedBrand(brand);
    // Mark this selection synchronously so in-flight loads for the
    // previous brand are invalidated (session gen can't see same-session
    // switches). Also clear the previous brand's records so a failed
    // load for the new brand can't display the old brand's
    // threats/takedowns (and pair the new brand's id with the old
    // domain in mark-as-safe).
    brandDetailsRef.current = brand.id;
    brandDetailsGenRef.current += 1;
    setBrandThreats([]);
    setBrandTakedowns([]);
    loadBrandThreats(brand.id);
    loadBrandTakedowns(brand.id);
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

  const loadIntegrations = async (gen: number = sessionGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/settings/integrations`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load integrations: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Failed to load integrations: API returned non-array', data);
        return;
      }
      setIntegrations(data);
    } catch (e) {
      console.error('Failed to load integrations:', e);
    }
  };

  const loadSettings = async () => {
    // Tag this request with the current session generation; if logout,
    // auth failure, or a new login happens while it is in flight, the
    // response is stale and must not touch the new identity's state.
    const gen = sessionGenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/settings/config`);
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      setSettings(data);
      setNotifications(data.notifications || {});
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const saveNotifications = async (key: string, value: boolean) => {
    try {
      const current = { ...notifications, [key]: value };
      await apiFetch(`${API_BASE}/settings/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current)
      });
      setNotifications(current);
    } catch (e) {
      console.error('Failed to save notifications:', e);
    }
  };

  const addDomain = async () => {
    const gen = sessionGenRef.current;
    const raw = domainInput.trim();
    if (!raw) return;
    // Detect multi-domain input: split on newline, comma, semicolon, whitespace
    const tokens = raw.split(/[\s,;]+/).map(t => t.toLowerCase().trim()).filter(Boolean);
    if (tokens.length === 0) return;

    setScanning(true);
    setAddDomainError(null);
    setAddDomainSuccess(null);

    try {
      if (tokens.length === 1) {
        const res = await apiFetch(`${API_BASE}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tokens[0] })
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Add failed (HTTP ${res.status})`);
        }
        setAddDomainSuccess(`Added ${tokens[0]} \u2014 scanning\u2026`);
      } else {
        const res = await apiFetch(`${API_BASE}/domains/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domains: tokens })
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Bulk add failed (HTTP ${res.status})`);
        }
        const body = await res.json();
        const summary = `Added ${body.added?.length ?? 0} of ${body.total} (${body.failed?.length ?? 0} failed) \u2014 scanning\u2026`;
        setAddDomainSuccess(summary);
      }

      await apiFetch(`${API_BASE}/domains/bulk-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_ids: [] })
      });

      await loadDomains(gen);
      setDomainInput("");
      setTimeout(() => setAddDomainSuccess(null), 6000);
    } catch (e: any) {
      setAddDomainError(e?.message || 'Failed to add domain');
      console.error('Failed to add domain:', e);
    } finally {
      setScanning(false);
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
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domainId}/analyze-fix`, { method: 'POST' });
      const data = await res.json();
      
      if (data.error) {
        notify('Couldn\'t analyze this domain.', 'error', describeApiError(data.error));
        return;
      }

      setFixRecommendations(data);
      setShowDetailsSync(true);
    } catch (e) {
      notify('Couldn\'t analyze this domain.', 'error', describeError(e, 'The analysis request failed.'));
    }
  };

  const openVerifyModal = async (domain: any) => {
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domain.id}/verify/generate`);
      const data = await res.json();
      setVerifyDomain(domain);
      setVerifyToken(data.token);
      setShowVerifyModal(true);
    } catch (e) {
      console.error('Failed to generate verification:', e);
    }
  };

  const verifyDomainOwnership = async () => {
    if (!verifyDomain) return;
    const gen = sessionGenRef.current;
    setVerifying(true);
    try {
      const res = await apiFetch(`${API_BASE}/domains/${verifyDomain.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken })
      });
      const data = await res.json();
      
      if (data.verified) {
        notify('Domain verified. Brand Protection and reporting are now unlocked.', 'success');
        setShowVerifyModal(false);
        loadDomains(gen);
      } else {
        notify('Verification failed.', 'error', `${describeApiError(data.reason || 'TXT record not found')} Publish the TXT record, then try again.`);
      }
    } catch (e) {
      notify('Verification failed.', 'error', describeError(e, 'The verification request failed.'));
    } finally {
      setVerifying(false);
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
    <div className={darkMode ? "dark" : ""}>
      <StatusViewport />
      <div className="min-h-screen text-foreground" style={{background: "radial-gradient(circle at top left, rgba(255, 157, 82, 0.08), transparent 35%), linear-gradient(180deg, #090b12 0%, #0b1018 100%)"}}>
        {/* Navbar */}
        <nav className="border-b border-white/5 bg-background/70 backdrop-blur-2xl sticky top-0 z-50">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="nbp-mark w-10 h-10 text-[14px]">NBP</div>
                <h1 className="text-[15px] font-display font-bold tracking-tight">NexusEmail</h1>
              </div>

              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-white/5">
                  <Bell className="w-[18px] h-[18px]" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)} className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-white/5">
                  {darkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                </Button>
                <div className="ml-3 flex items-center gap-3 pl-4 border-l border-white/5">
                  {logoutNotice && (
                    <span className="text-[11px] text-amber-400 max-w-[220px] leading-tight" role="alert">{logoutNotice}</span>
                  )}
                  {user?.email && (
                    <div className="hidden sm:block text-right leading-tight">
                      <p className="text-xs font-medium text-foreground truncate max-w-[180px]">{user.name || user.email}</p>
                      <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{user.email}</p>
                    </div>
                  )}
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-sm font-bold text-[#1a0d04] ring-2 ring-orange-500/20 ring-offset-2 ring-offset-background flex-shrink-0">
                    {(user?.name || user?.email || 'OB').slice(0, 2).toUpperCase()}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    onClick={logout}
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogOut className="w-[18px] h-[18px]" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </nav>

        <div className="container mx-auto px-6 py-10">
          {/* Main Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-white/[0.03] border border-white/5 p-1 h-auto flex-wrap rounded-xl">
              <TabsTrigger value="domains" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="domains">
                <Globe className="w-4 h-4 mr-2" /> Domains
              </TabsTrigger>
              <TabsTrigger value="integrations" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="integrations">
                <Plug className="w-4 h-4 mr-2" /> Integrations
              </TabsTrigger>
              <TabsTrigger value="notifications" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="notifications">
                <Bell className="w-4 h-4 mr-2" /> Notifications
              </TabsTrigger>
              <TabsTrigger value="reports" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="reports">
                <BarChart3 className="w-4 h-4 mr-2" /> Reports
              </TabsTrigger>
              <TabsTrigger value="settings" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="settings">
                <Settings className="w-4 h-4 mr-2" /> Settings
              </TabsTrigger>
              <TabsTrigger value="brands" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="brands">
                <Shield className="w-4 h-4 mr-2" /> Brand Protection
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-orange-500/30 border border-transparent text-muted-foreground" data-value="admin">
                  <Building2 className="w-4 h-4 mr-2" /> Admin
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="domains" className="space-y-4">

          {/* Hero Search */}
          <div className="mb-6">
            <div className="text-center mb-6 max-w-2xl mx-auto">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-2">
                Add a domain. Watch its posture.
              </h2>
              <p className="text-sm text-muted-foreground">
                We'll scan SPF / DKIM / DMARC, score the result, and surface anything that needs fixing.
              </p>
            </div>
            <div className="relative max-w-2xl mx-auto">
              <Card className="relative premium-surface premium-card border-0">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        placeholder="Add one domain, or paste many (commas / spaces / newlines)"
                        className="h-12 pl-12 bg-background/50 border-white/10 focus-visible:border-orange-500/40"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addDomain()}
                      />
                    </div>
                    <Button
                      className="h-12 px-6 btn-premium-primary border-0"
                      onClick={addDomain}
                      disabled={scanning}
                    >
                      {scanning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      Add & Scan
                    </Button>
                  </div>
                  {addDomainError && (
                    <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/40 text-sm text-red-300">
                      {addDomainError}
                    </div>
                  )}
                  {addDomainSuccess && !addDomainError && (
                    <div className="mt-3 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
                      {addDomainSuccess}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tip: paste multiple domains separated by commas, spaces, or newlines to bulk-add in one click.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {showDetails && selectedDomain && (
            <DomainDetailPanel
              selectedDomain={selectedDomain}
              fixRecommendations={fixRecommendations}
              detailRefreshing={detailRefreshing}
              detailRefreshError={detailRefreshError}
              dmarcUploading={dmarcUploading}
              dmarcUploadError={dmarcUploadError}
              dmarcFileRef={dmarcFileRef}
              uploadDmarcReport={uploadDmarcReport}
              fixDomain={fixDomain}
              onClose={() => { panelReopenRef.current = false; setShowDetailsSync(false); }}
            />
          )}

              {/* Bulk Actions */}
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/[0.08] via-orange-500/[0.04] to-transparent">
                  <div className="w-9 h-9 rounded-lg bg-orange-500/15 text-orange-300 flex items-center justify-center font-bold text-sm">
                    {selectedIds.length}
                  </div>
                  <span className="text-sm font-medium">{selectedIds.length === 1 ? 'domain' : 'domains'} selected</span>
                  <div className="hairline flex-1" />
                  <Button size="sm" className="btn-premium-primary border-0 h-8" onClick={bulkScan} disabled={scanning}>
                    <Zap className="w-3.5 h-3.5 mr-1.5" /> Scan {selectedIds.length === 1 ? 'this' : 'these'}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-300 hover:bg-red-500/10 hover:border-red-500/50" onClick={deleteDomains}>
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setSelectedIds([])}>
                    Clear
                  </Button>
                </div>
              )}

              {/* T164 — KPI strip: portfolio at-a-glance for the domains you operate */}
              {domains.length > 0 && (() => {
                const total = domains.length;
                const verified = domains.filter((d: any) => d.verified).length;
                const scoredDomains = domains.filter((d: any) => typeof d.last_score === 'number');
                const avgScore = scoredDomains.length > 0
                  ? Math.round(scoredDomains.reduce((s: number, d: any) => s + (d.last_score || 0), 0) / scoredDomains.length)
                  : null;
                const atRisk = scoredDomains.filter((d: any) => scoreBand(d.last_score) !== 'passing').length;
                const avgScoreColor = avgScore == null ? 'text-muted-foreground' : avgScore >= PASSING_SCORE ? 'text-emerald-400' : avgScore >= WARNING_SCORE ? 'text-amber-400' : 'text-red-400';
                const stats = [
                  { label: 'Total domains', value: total, hint: `${total === 1 ? 'domain' : 'domains'} on file`, icon: Globe, accent: 'text-foreground' },
                  { label: 'Verified', value: verified, hint: `${total - verified} pending verification`, icon: CheckCircle, accent: verified === total ? 'text-emerald-400' : 'text-foreground' },
                  { label: 'Avg health', value: avgScore == null ? '—' : `${avgScore}`, hint: avgScore == null ? 'No scans yet' : avgScore >= PASSING_SCORE ? 'Strong posture' : avgScore >= WARNING_SCORE ? 'Fixes recommended' : 'Action required', icon: Activity, accent: avgScoreColor },
                  { label: 'At risk', value: atRisk, hint: atRisk === 0 ? `No domains below ${PASSING_SCORE}` : `${atRisk} below threshold`, icon: AlertTriangle, accent: atRisk > 0 ? 'text-amber-400' : 'text-emerald-400' },
                ];
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {stats.map((s) => (
                      <div key={s.label} className="premium-surface premium-card border-0 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</p>
                          <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <p className={`font-display text-3xl font-bold tracking-tight tabular-nums ${s.accent}`}>{s.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{s.hint}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Filter pills */}
              {domains.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground mr-1">Filter:</p>
                  {[
                    { key: null, label: 'All', count: domains.length },
                    { key: 'passing', label: 'Passing', count: filterByBand(domains, 'passing').length },
                    { key: 'warnings', label: 'Warnings', count: filterByBand(domains, 'warnings').length },
                    { key: 'failed', label: 'Failed', count: filterByBand(domains, 'failed').length },
                  ].map((f) => {
                    const active = domainFilter === f.key;
                    return (
                      <button
                        key={f.label}
                        onClick={() => setDomainFilter(f.key as any)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${active ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30' : 'bg-white/[0.03] text-muted-foreground border border-white/5 hover:bg-white/[0.06] hover:text-foreground'}`}
                      >
                        {f.label}
                        <span className={`ml-1.5 ${active ? 'text-orange-400' : 'text-muted-foreground/70'}`}>{f.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Domain list — card rows, not a table */}
              {domains.length === 0 ? (
                <Card className="premium-surface premium-card border-0">
                  <CardContent className="p-12 text-center">
                    <div className="inline-flex w-16 h-16 rounded-2xl bg-orange-500/10 text-orange-400 items-center justify-center mb-4">
                      <Globe className="w-7 h-7" />
                    </div>
                    <h3 className="font-display text-lg font-bold tracking-tight mb-1">No domains yet</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                      Add a domain in the search above to start scanning SPF / DKIM / DMARC posture.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {/* Select-all bar */}
                  <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
                    <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-foreground transition-colors">
                      {selectedIds.length === domains.length && domains.length > 0
                        ? <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
                        : <Square className="w-3.5 h-3.5" />}
                      <span>Select all</span>
                    </button>
                    <div className="hairline flex-1" />
                    <span>{filterByBand(domains, domainFilter).length} shown</span>
                  </div>

                  {filterByBand(domains, domainFilter).map((domain: any) => {
                    const score = domain.last_score;
                    const hasScore = typeof score === 'number';
                    const scoreColor = !hasScore ? '#94a3b8' : scoreBand(score) === 'passing' ? '#86efac' : scoreBand(score) === 'warnings' ? '#fbbf24' : '#fca5a5';
                    const scoreRing = !hasScore ? 0 : Math.max(0, Math.min(100, score));
                    const isSelected = selectedIds.includes(domain.id);
                    const lastScanAgo = (() => {
                      if (!domain.last_scan) return 'Never scanned';
                      const ms = Date.now() - new Date(domain.last_scan).getTime();
                      const sec = Math.floor(ms / 1000);
                      if (sec < 60) return 'Just now';
                      if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
                      if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
                      return `${Math.floor(sec / 86400)}d ago`;
                    })();
                    const spf = recordState(domain.latest_scan, 'spf');
                    const dkim = recordState(domain.latest_scan, 'dkim');
                    const dmarc = recordState(domain.latest_scan, 'dmarc');
                    const pillClass = (row: { tone: string }) =>
                      row.tone === 'pass' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' :
                      row.tone === 'fail' ? 'bg-red-500/10 text-red-300 border-red-500/30' :
                      row.tone === 'warn' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
                      'bg-white/5 text-muted-foreground border-white/5';

                    return (
                      <div
                        key={domain.id}
                        className={`premium-surface premium-card rounded-xl p-4 ${isSelected ? 'ring-2 ring-orange-500/40 border-orange-500/30' : 'border-0'}`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Selection */}
                          <button
                            onClick={() => toggleSelect(domain.id)}
                            className="flex-shrink-0 w-7 h-7 rounded-md border border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5 flex items-center justify-center transition-colors"
                            aria-label={isSelected ? 'Deselect' : 'Select'}
                          >
                            {isSelected
                              ? <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
                              : <Square className="w-3.5 h-3.5 text-muted-foreground" />}
                          </button>

                          {/* Score ring */}
                          <div className="relative w-14 h-14 flex-shrink-0">
                            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                              <circle cx="18" cy="18" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                              {hasScore && (
                                <circle
                                  cx="18" cy="18" r="15.9155" fill="none"
                                  stroke={scoreColor} strokeWidth="3" strokeLinecap="round"
                                  strokeDasharray={`${scoreRing} ${100 - scoreRing}`}
                                />
                              )}
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="font-display text-base font-bold tabular-nums" style={{ color: scoreColor }}>
                                {hasScore ? score : '—'}
                              </span>
                            </div>
                          </div>

                          {/* Domain info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-display font-semibold tracking-tight truncate">{domain.name}</p>
                              {domain.verified ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                                  <CheckCircle className="w-2.5 h-2.5" /> Verified
                                </span>
                              ) : (
                                <button
                                  onClick={() => openVerifyModal(domain)}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 flex-shrink-0 transition-colors"
                                >
                                  <AlertTriangle className="w-2.5 h-2.5" /> Verify
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              {[{ k: 'SPF', v: spf }, { k: 'DKIM', v: dkim }, { k: 'DMARC', v: dmarc }].map((p) => (
                                <span key={p.k} title={p.v.tone === 'none' ? 'No scan data' : p.v.label} className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${pillClass(p.v)}`}>
                                  {p.k}
                                  {p.v.tone !== 'none' && <span className="opacity-70">·</span>}
                                  {p.v.tone !== 'none' && <span>{p.v.tone === 'pass' ? '✓' : p.v.tone === 'fail' ? '✕' : '?'}</span>}
                                </span>
                              ))}
                              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {lastScanAgo}
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-orange-500/10 hover:text-orange-300" onClick={() => scanDomain(domain.id)} title="Re-scan">
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-white/5" onClick={() => viewDomain(domain)} title="Inspect">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-white/5" onClick={() => fixDomain(domain.id)} title="Get fix records">
                              <Wrench className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="integrations" className="space-y-6">
              <IntegrationsTab
                settings={settings}
                loadSettings={loadSettings}
                sessionGenRef={sessionGenRef}
                apiFetch={apiFetch}
              />
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6">
              <NotificationsTab
                notifications={notifications}
                settings={settings}
                onSavePref={saveNotifications}
                apiFetch={apiFetch}
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
              />
            </TabsContent>

            <TabsContent value="brands" className="space-y-6">
              <div>
                <p className="eyebrow mb-2">Brand Protection</p>
                <h2 className="font-display text-2xl font-bold tracking-tight mb-1">Watch for impersonation</h2>
                <p className="text-sm text-muted-foreground">Detect typosquats, look-alikes, and brand abuse on domains you own.</p>
              </div>

              <Card className="premium-surface premium-card border-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle className="font-display tracking-tight flex items-center gap-2">
                      <Shield className="w-4 h-4 text-orange-400" /> Monitored brands
                    </CardTitle>
                    <CardDescription>Each brand is tied to a verified domain you own.</CardDescription>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {brandAlerts.length > 0 && (
                      <Button variant="outline" size="sm" className="border-red-500/30 bg-red-500/5 text-red-300 hover:bg-red-500/10 hover:border-red-500/50" onClick={() => setShowAlertsModal(true)}>
                        <Bell className="w-4 h-4 mr-1.5" /> Alerts
                        <span className="ml-2 px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[10px] font-bold leading-none">{brandAlerts.length}</span>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={bulkScanAll} disabled={bulkScanning}>
                      {bulkScanning ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                      Scan all
                    </Button>
                    <Button className="btn-premium-primary border-0" size="sm" onClick={() => setShowAddBrand(true)}>
                      <Plus className="w-4 h-4 mr-1.5" /> Add brand
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {showAddBrand && (
                    <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
                      <p className="font-medium mb-3">Add Brand to Monitor</p>
                      {domains.filter((d: any) => d.verified).length === 0 ? (
                        <div className="space-y-3">
                          <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
                            You don't have any verified domains yet. Brand Protection only monitors domains you own and have verified, so you can't add a brand until at least one of your domains is verified.
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                setShowAddBrand(false);
                                setActiveTab('domains');
                              }}
                            >
                              Go to Domains
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setShowAddBrand(false)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          <div>
                            <label className="text-sm text-muted-foreground">Domain</label>
                            <select
                              value={newBrandDomain}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNewBrandDomain(v);
                                // Auto-fill brand name from the chosen domain's
                                // first label (e.g. "myco.com" -> "myco") if the
                                // user hasn't typed one already.
                                if (v && !newBrandName.trim()) {
                                  setNewBrandName(v.split('.')[0]);
                                }
                              }}
                              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <option value="">Select a verified domain…</option>
                              {domains
                                .filter((d: any) => d.verified)
                                .map((d: any) => (
                                  <option key={d.id} value={d.name}>{d.name}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Only domains you've added and verified appear here. Manage them under <strong>Domains</strong>.
                            </p>
                          </div>
                          <div>
                            <label className="text-sm text-muted-foreground">Brand Name (optional)</label>
                            <Input
                              placeholder="My Company"
                              value={newBrandName}
                              onChange={(e) => setNewBrandName(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={!newBrandDomain}
                              onClick={() => {
                                if (!newBrandDomain.trim()) return;
                                const gen = sessionGenRef.current;
                                apiFetch(`${API_BASE}/brands`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    domain: newBrandDomain.toLowerCase().trim(),
                                    brand_name: newBrandName || newBrandDomain.split('.')[0]
                                  })
                                }).then((res: any) => {
                                  if (!res.ok) {
                                    res.json().catch(() => ({})).then((err: any) => {
                                      notify('Couldn\'t add the brand.', 'error', describeApiError(err.error || `HTTP ${res.status}`));
                                    });
                                    return;
                                  }
                                  loadBrands(gen);
                                  setNewBrandDomain('');
                                  setNewBrandName('');
                                  setShowAddBrand(false);
                                });
                              }}
                            >
                              <Save className="w-4 h-4 mr-1" /> Save
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                              setShowAddBrand(false);
                              setNewBrandDomain('');
                              setNewBrandName('');
                            }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {brands.length === 0 && !showAddBrand ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No brands being monitored</p>
                      <p className="text-sm">Add a brand to start monitoring for typosquatting and impersonation</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {brands.map((brand: any) => (
                        <div key={brand.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <Shield className="w-5 h-5 text-orange-500" />
                            <div>
                              <p className="font-medium">{brand.domain}</p>
                              <p className="text-sm text-muted-foreground">{brand.brand_name}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={async () => {
                              setBrandScanning(true);
                              setBrandScanResult(null);
                              try {
                                const res = await apiFetch(`${API_BASE}/brands/check/${brand.id}`, { method: 'POST' });
                                const data = await res.json();
                                setBrandScanResult({ ...data, brand: brand.domain });
                              } catch (e) { 
                                setBrandScanResult({ error: 'Scan failed' });
                              } finally {
                                setBrandScanning(false);
                              }
                            }}>
                              <Search className="w-4 h-4 mr-1" /> Scan
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openBrandDetails(brand)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                              const gen = sessionGenRef.current;
                              apiFetch(`${API_BASE}/brands/${brand.id}`, { method: 'DELETE' }).then(() => loadBrands(gen));
                            }}>
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Scan Results Display */}
                  {brandScanning && (
                    <div className="mt-4 p-4 bg-orange-500/10 rounded-lg border border-orange-500/30 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium">Scanning brand protection...</span>
                      </div>
                      
                      {/* Progress Hints */}
                      <div className="space-y-2 text-xs">
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[0]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[0]?.complete ? '✓' : '○'} Detecting DNS provider
                        </div>
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[1]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[1]?.complete ? '✓' : '○'} Checking typosquatting variations
                        </div>
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[2]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[2]?.complete ? '✓' : '○'} Checking lookalike domains
                        </div>
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[3]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[3]?.complete ? '✓' : '○'} Checking subdomain abuse
                        </div>
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[4]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[4]?.complete ? '✓' : '○'} Checking social media variants
                        </div>
                        <div className={`flex items-center gap-2 ${brandScanResult?.progress?.[5]?.complete ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {brandScanResult?.progress?.[5]?.complete ? '✓' : '○'} Checking homograph attacks
                        </div>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 transition-all duration-300" style={{ 
                          width: `${(brandScanResult?.progress?.filter((p: any) => p.complete).length || 0) * 16.67}%` 
                        }} />
                      </div>
                    </div>
                  )}

                  {brandScanResult && !brandScanning && (
                    <div className="mt-4 p-4 bg-muted/30 rounded-lg border">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-medium">Brand Protection Results</p>
                        <Button variant="ghost" size="sm" onClick={() => setBrandScanResult(null)}>Clear</Button>
                      </div>
                      {brandScanResult.error ? (
                        <p className="text-sm text-rose-500">{brandScanResult.error}</p>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="p-2 bg-emerald-500/10 rounded">
                              <p className="text-muted-foreground">Score</p>
                              <p className="font-bold text-lg">{brandScanResult.score}/100</p>
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <p className="text-muted-foreground">DNS Provider</p>
                              <p className="font-medium">{brandScanResult.dns_provider?.name || 'Unknown'}</p>
                            </div>
                            
                            {/* Clickable: Typosquatting */}
                            <div className="p-2 bg-muted rounded cursor-pointer hover:bg-muted/80" onClick={() => setExpandedSections(expandedSections.includes('typo') ? expandedSections.filter(e => e !== 'typo') : [...expandedSections, 'typo'])}>
                              <p className="text-muted-foreground flex items-center gap-1">
                                Typosquatting
                                <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('typo') ? 'rotate-90' : ''}`} />
                              </p>
                              <p className="font-medium">{brandScanResult.typosquatting?.length || 0} found</p>
                              {expandedSections.includes('typo') && brandScanResult.typosquatting?.length > 0 && (
                                <div className="mt-2 text-xs space-y-1">
                                  {brandScanResult.typosquatting.slice(0, 10).map((t: any, i: number) => (
                                    <div key={i} className="p-1 bg-background rounded truncate">{t.domain}</div>
                                  ))}
                                  {brandScanResult.typosquatting.length > 10 && <p className="text-muted-foreground">+{brandScanResult.typosquatting.length - 10} more</p>}
                                </div>
                              )}
                            </div>
                            
                            {/* Clickable: Lookalikes */}
                            <div className="p-2 bg-muted rounded cursor-pointer hover:bg-muted/80" onClick={() => setExpandedSections(expandedSections.includes('lookalike') ? expandedSections.filter(e => e !== 'lookalike') : [...expandedSections, 'lookalike'])}>
                              <p className="text-muted-foreground flex items-center gap-1">
                                Lookalikes
                                <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('lookalike') ? 'rotate-90' : ''}`} />
                              </p>
                              <p className="font-medium">{brandScanResult.lookalikes?.length || 0} found</p>
                              {expandedSections.includes('lookalike') && brandScanResult.lookalikes?.length > 0 && (
                                <div className="mt-2 text-xs space-y-1">
                                  {brandScanResult.lookalikes.slice(0, 10).map((l: any, i: number) => (
                                    <div key={i} className="p-1 bg-background rounded truncate">{l.domain}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                            
                            {/* Clickable: Impersonation */}
                            <div className="p-2 bg-muted rounded cursor-pointer hover:bg-muted/80" onClick={() => setExpandedSections(expandedSections.includes('impersonation') ? expandedSections.filter(e => e !== 'impersonation') : [...expandedSections, 'impersonation'])}>
                              <p className="text-muted-foreground flex items-center gap-1">
                                Impersonation
                                <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('impersonation') ? 'rotate-90' : ''}`} />
                              </p>
                              <p className="font-medium">{brandScanResult.impersonation?.length || 0} found</p>
                              {expandedSections.includes('impersonation') && brandScanResult.impersonation?.length > 0 && (
                                <div className="mt-2 text-xs space-y-1">
                                  {brandScanResult.impersonation.slice(0, 10).map((imp: any, i: number) => (
                                    <div key={i} className="p-1 bg-background rounded truncate">{imp.domain}</div>
                                  ))}
                                  {brandScanResult.impersonation.length > 10 && <p className="text-muted-foreground">+{brandScanResult.impersonation.length - 10} more</p>}
                                </div>
                              )}
                            </div>
                            
                            {/* Clickable: NS Records */}
                            <div className="p-2 bg-muted rounded cursor-pointer hover:bg-muted/80" onClick={() => setExpandedSections(expandedSections.includes('ns') ? expandedSections.filter(e => e !== 'ns') : [...expandedSections, 'ns'])}>
                              <p className="text-muted-foreground flex items-center gap-1">
                                NS Records
                                <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('ns') ? 'rotate-90' : ''}`} />
                              </p>
                              {expandedSections.includes('ns') ? (
                                <div className="mt-1 text-xs space-y-1">
                                  {(brandScanResult.dns_provider?.ns || []).map((ns: string, i: number) => (
                                    <div key={i} className="p-1 bg-background rounded truncate">{ns}</div>
                                  ))}
                                </div>
                              ) : (
                                <p className="font-medium text-xs truncate">{brandScanResult.dns_provider?.ns?.[0] || '-'}</p>
                              )}
                            </div>
                          </div>
                          {brandScanResult.issues?.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Issues:</p>
                              {brandScanResult.issues.map((issue: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                                  <span>{issue.type}: {issue.count} issues</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {brandScanResult.recommendations?.length > 0 && (
                            <div className="text-sm text-muted-foreground">
                              <p className="font-medium mb-1">Recommendations:</p>
                              <ul className="list-disc list-inside">
                                {brandScanResult.recommendations.map((rec: string, i: number) => (
                                  <li key={i}>{rec}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
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

          </Tabs>
        </div>

        <footer className="border-t border-border/40 py-6 mt-10">
          <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
            <p>Nexus Brand Protection</p>
          </div>
        </footer>

        {/* Brand Details Modal */}
        {selectedBrand && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedBrand(null)}>
            <div className="bg-background border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold">{selectedBrand.domain}</h3>
                  <p className="text-sm text-muted-foreground">{selectedBrand.brand_name}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedBrand(null)}>
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>

              <div className="space-y-6">
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setShowTakedownModal(true)}>
                    <Zap className="w-4 h-4 mr-1" /> Submit Takedown
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowThreatModal(true)}>
                    <AlertTriangle className="w-4 h-4 mr-1" /> Add Threat
                  </Button>
                </div>

                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Tracked Threats ({brandThreats.length})
                  </h4>
                  {brandThreats.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No threats tracked</p>
                  ) : (
                    <div className="space-y-2">
                      {brandThreats.map((threat: any) => (
                        <div key={threat.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                          <div>
                            <p className="font-medium text-sm">{threat.domain}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant={threat.severity === 'high' ? 'destructive' : threat.severity === 'medium' ? 'default' : 'secondary'} className="text-xs">
                                {threat.threat_type}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{threat.severity}</Badge>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" title="Mark as Safe" onClick={() => markAsSafe(selectedBrand.id, threat.domain)}>
                              <CheckCircle className="w-4 h-4 text-emerald-500" />
                            </Button>
                            <Button variant="ghost" size="sm" title="Submit Takedown" onClick={() => {
                              setTakedownForm({ ...takedownForm, domain: threat.domain });
                              setShowTakedownModal(true);
                            }}>
                              <Zap className="w-4 h-4 text-amber-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-orange-500" />
                    Takedown Requests ({brandTakedowns.length})
                  </h4>
                  {brandTakedowns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No takedown requests</p>
                  ) : (
                    <div className="space-y-2">
                      {brandTakedowns.map((takedown: any) => (
                        <div key={takedown.id} className="p-3 border rounded-lg bg-muted/30">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm">{takedown.domain}</p>
                              <p className="text-xs text-muted-foreground">{takedown.threat_type} • {takedown.provider}</p>
                            </div>
                            <Badge variant={takedown.status === 'completed' ? 'default' : takedown.status === 'in_progress' ? 'secondary' : 'outline'}>
                              {takedown.status}
                            </Badge>
                          </div>
                          {takedown.notes && <p className="text-xs text-muted-foreground mt-2">{takedown.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedBrand.safe_list && selectedBrand.safe_list.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      Safe List ({selectedBrand.safe_list.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedBrand.safe_list.map((domain: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600">
                          {domain}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showTakedownModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTakedownModal(false)}>
            <div className="bg-background border rounded-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Submit Takedown Request</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm">Domain</label>
                  <Input value={takedownForm.domain} onChange={(e) => setTakedownForm({ ...takedownForm, domain: e.target.value })} placeholder="bad-domain.com" />
                </div>
                <div>
                  <label className="text-sm">Threat Type</label>
                  <select className="w-full p-2 border rounded" value={takedownForm.threat_type} onChange={(e) => setTakedownForm({ ...takedownForm, threat_type: e.target.value })}>
                    <option value="impersonation">Impersonation</option>
                    <option value="typosquatting">Typosquatting</option>
                    <option value="phishing">Phishing</option>
                    <option value="fake_store">Fake Store</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm">Evidence / Notes</label>
                  <textarea className="w-full p-2 border rounded" rows={3} value={takedownForm.evidence} onChange={(e) => setTakedownForm({ ...takedownForm, evidence: e.target.value })} placeholder="Describe the abuse..." />
                </div>
                <div>
                  <label className="text-sm">Contact Email</label>
                  <Input value={takedownForm.contact_email} onChange={(e) => setTakedownForm({ ...takedownForm, contact_email: e.target.value })} placeholder="legal@yourbrand.com" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => submitTakedown(selectedBrand?.id)}>Submit Request</Button>
                  <Button variant="ghost" onClick={() => setShowTakedownModal(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showThreatModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowThreatModal(false)}>
            <div className="bg-background border rounded-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Manual Threat</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm">Domain</label>
                  <Input value={threatForm.domain} onChange={(e) => setThreatForm({ ...threatForm, domain: e.target.value })} placeholder="fake-brand.com" />
                </div>
                <div>
                  <label className="text-sm">Threat Type</label>
                  <select className="w-full p-2 border rounded" value={threatForm.threat_type} onChange={(e) => setThreatForm({ ...threatForm, threat_type: e.target.value })}>
                    <option value="manual">Manual</option>
                    <option value="impersonation">Impersonation</option>
                    <option value="typosquatting">Typosquatting</option>
                    <option value="phishing">Phishing</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm">Severity</label>
                  <select className="w-full p-2 border rounded" value={threatForm.severity} onChange={(e) => setThreatForm({ ...threatForm, severity: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm">Notes</label>
                  <textarea className="w-full p-2 border rounded" rows={2} value={threatForm.notes} onChange={(e) => setThreatForm({ ...threatForm, notes: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => addThreat(selectedBrand?.id)}>Add Threat</Button>
                  <Button variant="ghost" onClick={() => setShowThreatModal(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAlertsModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAlertsModal(false)}>
            <div className="bg-background border rounded-lg w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Threat Alerts ({brandAlerts.length})</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowAlertsModal(false)}>
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              {brandAlerts.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No alerts</p>
              ) : (
                <div className="space-y-3">
                  {brandAlerts.map((alert: any) => (
                    <div key={alert.id} className={`p-3 border rounded-lg ${alert.severity === 'high' ? 'bg-rose-500/10 border-rose-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{alert.domain}</p>
                          <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">{alert.brand_name} • {new Date(alert.timestamp).toLocaleString()}</p>
                        </div>
                        <Badge variant={alert.severity === 'high' ? 'destructive' : 'default'} className="text-xs">
                          {alert.severity}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {showVerifyModal && verifyDomain && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowVerifyModal(false)}>
            <div className="bg-background border rounded-lg w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Verify Domain Ownership</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowVerifyModal(false)}>
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              
              <p className="text-sm text-muted-foreground mb-4">
                To unlock email security features for <span className="font-medium">{verifyDomain.name}</span>, 
                you must prove ownership by adding a DNS record.
              </p>

              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="font-medium text-sm mb-2">TXT Record (Recommended)</p>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> <code className="bg-background px-1">_nexusemail-verification</code></p>
                    <p><span className="text-muted-foreground">Value:</span> <code className="bg-background px-1">_nexusemail-verification={verifyToken}</code></p>
                  </div>
                </div>

                <div className="p-3 bg-muted rounded-lg">
                  <p className="font-medium text-sm mb-2">CNAME Alternative</p>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> <code className="bg-background px-1">verify.{verifyDomain.name}</code></p>
                    <p><span className="text-muted-foreground">Points to:</span> <code className="bg-background px-1">{verifyToken}.verification.nexusemail.local</code></p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  After adding the record, click Verify below. DNS changes may take a few minutes to propagate.
                </p>

                <div className="flex gap-2">
                  <Button onClick={verifyDomainOwnership} disabled={verifying}>
                    {verifying ? 'Verifying...' : 'Verify Now'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowVerifyModal(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
