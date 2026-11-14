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
  MessageSquare, Send,
  X, LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  // Bumped on every identity change (login, logout, auth failure). Async
  // settings responses carry the generation they were started under and
  // are dropped if a newer identity exists.
  const sessionGenRef = useRef(0);
  const [loginForm, setLoginForm] = useState({ email: 'admin@segbytes.xyz', password: '' });
  const [loginError, setLoginError] = useState('');
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [domainInput, setDomainInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDomainError, setAddDomainError] = useState<string | null>(null);
  const [addDomainSuccess, setAddDomainSuccess] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [fixRecommendations, setFixRecommendations] = useState<any>(null);
  const [integrations, setIntegrations] = useState([]);
  const [notifications, setNotifications] = useState<any>({});
  const [settings, setSettings] = useState<any>(null);
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [slackForm, setSlackForm] = useState({ webhook_url: '' });
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [resendForm, setResendForm] = useState({ api_key: '', from: '' });
  const [testEmailTo, setTestEmailTo] = useState('');
  const [savingResend, setSavingResend] = useState(false);
  const [testingResend, setTestingResend] = useState(false);
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
  const [reportDomainId, setReportDomainId] = useState<number | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [providerCreds, setProviderCreds] = useState<any>({});
  const [savingProvider, setSavingProvider] = useState(false);
  
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

  const apiFetch = (url: string, options: any = {}) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  // T163b — explicit, narrow logout on detected stale session. Called only by
  // load* handlers when they see a 401 against an authenticated endpoint —
  // not from inside apiFetch itself, because apiFetch is also used by the
  // login flow (where a 401 from /auth/login is the normal "wrong password"
  // path and must NOT trigger session reset).
  const handleAuthFailure = () => {
    localStorage.removeItem('nexusemail_token');
    localStorage.removeItem('nexusemail_user');
    sessionGenRef.current += 1;
    // Secrets must not survive an identity change in the SPA state.
    setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
    setSlackForm({ webhook_url: '' });
    setResendForm({ api_key: '', from: '' });
    setSettings(null);
    setToken(null);
    setUser(null);
  };

  // Load local session or consume a short-lived WHMCS handoff token.
  useEffect(() => {
    const consumeWhmcsToken = async (handoffToken: string) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/auth/whmcs-exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: handoffToken })
        });
        if (!res.ok) throw new Error('WHMCS sign-in link is invalid or expired');
        const data = await res.json();
        // New identity: invalidate any in-flight settings responses.
        sessionGenRef.current += 1;
        setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
        setSlackForm({ webhook_url: '' });
        setResendForm({ api_key: '', from: '' });
        setSettings(null);
        localStorage.setItem('nexusemail_token', data.token);
        localStorage.setItem('nexusemail_user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
      } catch (e: any) {
        setLoginError(e.message || 'WHMCS sign-in failed');
      } finally {
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, cleanUrl);
        setLoading(false);
      }
    };

    const url = new URL(window.location.href);
    const handoffToken = url.searchParams.get('token');
    if (handoffToken) {
      consumeWhmcsToken(handoffToken);
      return;
    }

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
      setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
      setSlackForm({ webhook_url: '' });
      setResendForm({ api_key: '', from: '' });
      setSettings(null);
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
    setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
    setSlackForm({ webhook_url: '' });
    setResendForm({ api_key: '', from: '' });
    setSettings(null);
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
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

  const loadBrandThreats = async (brandId: number, gen: number = sessionGenRef.current) => {
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
      if (!Array.isArray(data)) {
        console.error('Failed to load threats: API returned non-array', data);
        return;
      }
      setBrandThreats(data);
    } catch (e) {
      console.error('Failed to load threats:', e);
    }
  };

  const loadBrandTakedowns = async (brandId: number, gen: number = sessionGenRef.current) => {
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
    loadBrandThreats(brand.id);
    loadBrandTakedowns(brand.id);
  };

  const loadDomains = async (gen: number = sessionGenRef.current) => {
    try {
      const res = await apiFetch(`${API_BASE}/domains`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load domains: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error('Failed to load domains: API returned non-array', data);
        return;
      }
      setDomains(data);
      if (data.length > 0) setSelectedDomain(data[0]);
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
    // response is stale and must not touch the new identity's forms.
    const gen = sessionGenRef.current;
    try {
      // Reset to a known-empty state first so settings from a previous
      // session never leak into a new identity's forms.
      setSlackForm({ webhook_url: '' });
      setResendForm({ api_key: '', from: '' });
      const res = await apiFetch(`${API_BASE}/settings/config`);
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      setSettings(data);
      setNotifications(data.notifications || {});
      if (data.smtp_config) {
        setSmtpForm({
          host: data.smtp_config.host || '',
          port: String(data.smtp_config.port || 587),
          secure: data.smtp_config.secure || false,
          user: data.smtp_config.user || '',
          pass: '',
          from: data.smtp_config.from || ''
        });
      } else {
        setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
      }
      if (data.slack_webhook) setSlackForm({ webhook_url: data.slack_webhook });
      if (data.resend_config) {
        setResendForm({ api_key: data.resend_config.api_key || '', from: data.resend_config.from || '' });
        if (data.resend_config.from) setTestEmailTo(data.resend_config.from);
      }
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

  const saveSmtp = async () => {
    try {
      await apiFetch(`${API_BASE}/settings/smtp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(smtpForm)
      });
      alert('SMTP settings saved!');
    } catch (e) {
      alert('Failed to save SMTP: ' + e.message);
    }
  };

  const testSmtp = async () => {
    setTestingSmtp(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/smtp/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? 'SMTP connection successful!' : 'SMTP failed: ' + data.error);
    } catch (e) {
      alert('SMTP test failed: ' + e.message);
    } finally {
      setTestingSmtp(false);
    }
  };

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
        alert('Failed to save Slack: ' + (data.error || `HTTP ${res.status}`));
        return;
      }
      alert('Slack webhook saved!');
    } catch (e) {
      alert('Failed to save Slack: ' + e.message);
    } finally {
      setSavingSlack(false);
    }
  };

  const testSlack = async () => {
    setTestingSlack(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/slack/test`, { method: 'POST' });
      const data = await res.json();
      alert(data.success ? 'Slack test message sent!' : 'Slack failed: ' + data.error);
    } catch (e) {
      alert('Slack test failed: ' + e.message);
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
        alert('Failed to save Resend: ' + (data.error || `HTTP ${res.status}`));
        return;
      }
      alert('Resend settings saved!');
    } catch (e) {
      alert('Failed to save Resend: ' + e.message);
    } finally {
      setSavingResend(false);
    }
  };

  const testResend = async () => {
    if (!testEmailTo) { alert('Enter a test email address first'); return; }
    setTestingResend(true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/resend/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailTo })
      });
      const data = await res.json();
      alert(data.success ? 'Test email sent! Check the inbox (and spam folder).' : 'Resend failed: ' + data.error);
    } catch (e) {
      alert('Resend test failed: ' + e.message);
    } finally {
      setTestingResend(false);
    }
  };

  const toggleSchedule = async (enabled: boolean) => {
    try {
      await apiFetch(`${API_BASE}/settings/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      setSettings({ ...settings, scan_schedule: { ...settings.scan_schedule, enabled } });
    } catch (e) {
      console.error('Failed to toggle schedule:', e);
    }
  };

  const toggleAutoRemediation = async (enabled: boolean) => {
    try {
      await apiFetch(`${API_BASE}/settings/auto-remediation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      setSettings({ ...settings, auto_remediation: enabled });
    } catch (e) {
      console.error('Failed to toggle auto-remediation:', e);
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
      await apiFetch(`${API_BASE}/settings/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_ids: selectedIds })
      });
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

  const getScoreColor = (score) => {
    if (score >= 70) return "text-emerald-400";
    if (score >= 40) return "text-amber-400";
    return "text-rose-400";
  };

  const getScoreRing = (score) => {
    if (score >= 70) return "stroke-emerald-500";
    if (score >= 40) return "stroke-amber-500";
    return "stroke-rose-500";
  };

  const stats = {
    total: domains.length,
    passing: domains.filter(d => (d.last_score || 0) >= 70).length,
    warnings: domains.filter(d => (d.last_score || 0) >= 40 && (d.last_score || 0) < 70).length,
    failed: domains.filter(d => (d.last_score || 0) < 40).length
  };

  const viewDomain = async (domain: any) => {
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domain.id}`);
      const data = await res.json();
      setSelectedDomain(data);
      setShowDetails(true);
    } catch (e) {
      console.error('Failed to load domain details:', e);
    }
  };

  const fixDomain = async (domainId: number) => {
    try {
      const res = await apiFetch(`${API_BASE}/domains/${domainId}/analyze-fix`, { method: 'POST' });
      const data = await res.json();
      
      if (data.error) {
        alert(data.error);
        return;
      }

      setFixRecommendations(data);
      setShowDetails(true);
    } catch (e) {
      alert('Failed to analyze domain: ' + e.message);
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
        alert('Domain verified successfully! Features unlocked.');
        setShowVerifyModal(false);
        loadDomains(gen);
      } else {
        alert('Verification failed: ' + (data.reason || 'TXT record not found'));
      }
    } catch (e) {
      alert('Verification failed: ' + e.message);
    } finally {
      setVerifying(false);
    }
  };

  const generateReport = async (domainId: number) => {
    setGeneratingReport(true);
    try {
      const response = await apiFetch(`${API_BASE}/reports/domains/${domainId}/report`);
      const html = await response.text();
      
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${domainId}-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Failed to generate report: ' + e.message);
    } finally {
      setGeneratingReport(false);
    }
  };

  const exportCSV = async () => {
    try {
      const response = await apiFetch(`${API_BASE}/reports/export/csv`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nexusemail-domains.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Failed to export CSV: ' + e.message);
    }
  };

  const exportJSON = async () => {
    try {
      const response = await apiFetch(`${API_BASE}/reports/export/json`);
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nexusemail-domains.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Failed to export JSON: ' + e.message);
    }
  };

  const openProviderModal = (provider: any) => {
    setSelectedProvider(provider);
    const creds = settings?.provider_credentials?.[provider.name.toLowerCase()] || {};
    setProviderCreds(creds);
    setShowProviderModal(true);
  };

  const saveProviderCredentials = async () => {
    if (!selectedProvider) return;
    setSavingProvider(true);
    try {
      await apiFetch(`${API_BASE}/settings/providers/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider.name,
          credentials: providerCreds
        })
      });
      alert(`${selectedProvider.name} connected successfully!`);
      setShowProviderModal(false);
      loadSettings();
    } catch (e) {
      alert('Failed to save credentials: ' + e.message);
    } finally {
      setSavingProvider(false);
    }
  };

  const disconnectProvider = async (providerName: string) => {
    try {
      await apiFetch(`${API_BASE}/settings/providers/credentials/${providerName}`, {
        method: 'DELETE'
      });
      alert(`${providerName} disconnected`);
      loadSettings();
    } catch (e) {
      alert('Failed to disconnect: ' + e.message);
    }
  };

  const testProviderConnection = async (provider: any) => {
    const creds = settings?.provider_credentials?.[provider.name.toLowerCase()];
    if (!creds) {
      alert('Please configure credentials first');
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/settings/providers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.name, credentials: creds })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${provider.name} connection successful! (${data.latency}ms)`);
      } else {
        alert(`❌ ${provider.name} failed: ${data.error}`);
      }
    } catch (e) {
      alert('Test failed: ' + e.message);
    }
  };

  const getProviderFields = (providerName: string) => {
    return (PROVIDER_METADATA[providerName]?.fields || []).map(f => f.key);
  };

  // T160 — Provider metadata is the single source of truth for the
  // integrations grid AND the configure-provider modal. Only providers with
  // real DNS-management API endpoints in backend/src/services/providers/index.js
  // are listed. Registrar-only / no-API providers (Aliyun SDK-required,
  // Domains.co.za, WebAfrica, HostAfrica, MWeb, Afrihost, CoolIdeas) used to
  // be in this list but were rendered as stubs that couldn't actually fix
  // SPF/DMARC records, which was misleading to customers.
  type ProviderField = {
    key: string;
    label: string;
    placeholder: string;
    description: string;
    type: 'text' | 'password';
    required: boolean;
  };
  type ProviderMeta = {
    category: 'Global' | 'Cloud' | 'Asia';
    docsUrl: string;
    summary: string;
    fields: ProviderField[];
  };
  const PROVIDER_METADATA: Record<string, ProviderMeta> = {
    'Cloudflare': {
      category: 'Global',
      docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      summary: 'Edit DNS records via Cloudflare API tokens. Fastest and most reliable.',
      fields: [
        { key: 'api_key', label: 'API Token', placeholder: 'cf-...', type: 'password', required: true,
          description: 'Create a token with Zone:DNS:Edit permission scoped to the relevant zone(s).' },
        { key: 'email', label: 'Account Email', placeholder: 'you@example.com', type: 'text', required: false,
          description: 'Optional. Only needed if the token has not yet superseded API-key authentication on legacy accounts.' },
      ],
    },
    'AWS Route53': {
      category: 'Cloud',
      docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
      summary: 'Edit Route53 hosted-zone records via an IAM access key with Route53 write permissions.',
      fields: [
        { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text', required: true,
          description: 'IAM user / role access-key ID.' },
        { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'wJalrXUtnFEMI/...', type: 'password', required: true,
          description: 'Corresponding secret. Grant route53:ChangeResourceRecordSets + ListHostedZones.' },
        { key: 'region', label: 'Region', placeholder: 'us-east-1', type: 'text', required: false,
          description: 'Defaults to us-east-1. Route53 is global, but the SDK still requires a region.' },
      ],
    },
    'GoDaddy': {
      category: 'Global',
      docsUrl: 'https://developer.godaddy.com/keys',
      summary: 'PUT TXT records via the GoDaddy v1 API.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'gd...', type: 'password', required: true,
          description: 'Generate a Production key (Test keys cannot edit live DNS).' },
        { key: 'secret', label: 'API Secret', placeholder: 'paired secret', type: 'password', required: true,
          description: 'Paired secret issued alongside the API key.' },
      ],
    },
    'DigitalOcean': {
      category: 'Cloud',
      docsUrl: 'https://cloud.digitalocean.com/account/api/tokens',
      summary: 'Edit DNS records on domains managed by DigitalOcean DNS.',
      fields: [
        { key: 'api_token', label: 'Personal Access Token', placeholder: 'dop_v1_...', type: 'password', required: true,
          description: 'Token must have Write scope on the Domains category.' },
      ],
    },
    'Vercel': {
      category: 'Cloud',
      docsUrl: 'https://vercel.com/account/tokens',
      summary: 'Edit DNS records on domains managed by Vercel.',
      fields: [
        { key: 'token', label: 'Access Token', placeholder: 'vercel_...', type: 'password', required: true,
          description: 'Account token with full access to the team / personal scope owning the domain.' },
      ],
    },
    'Namecheap': {
      category: 'Global',
      docsUrl: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
      summary: 'Edit DNS via the Namecheap XML API. Requires whitelisting your egress IP.',
      fields: [
        { key: 'username', label: 'Namecheap Username', placeholder: 'yourhandle', type: 'text', required: true,
          description: 'Account username (the one that owns the domain).' },
        { key: 'api_key', label: 'API Key', placeholder: 'a1b2c3...', type: 'password', required: true,
          description: 'Enable API access on your account first, then copy the key.' },
        { key: 'ip', label: 'Whitelisted IP', placeholder: 'auto', type: 'text', required: true,
          description: 'Public IP of the Brand Protection backend. Must be whitelisted in Namecheap API settings.' },
      ],
    },
    'NameSilo': {
      category: 'Global',
      docsUrl: 'https://www.namesilo.com/account/api-manager',
      summary: 'Edit DNS via the NameSilo XML API.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'ns-...', type: 'password', required: true,
          description: 'Generate from Account → API Manager.' },
      ],
    },
    'Gandi': {
      category: 'Global',
      docsUrl: 'https://account.gandi.net/en/users/_/security',
      summary: 'Edit LiveDNS records via Apikey authentication.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'gandi-...', type: 'password', required: true,
          description: 'Generate a personal API key under Account → Security.' },
      ],
    },
    'DNSimple': {
      category: 'Global',
      docsUrl: 'https://dnsimple.com/user',
      summary: 'Edit zone records via DNSimple v2 API.',
      fields: [
        { key: 'access_token', label: 'Account Access Token', placeholder: 'dnsimple_...', type: 'password', required: true,
          description: 'Generate from User Settings → Access Tokens. Use an Account-level token.' },
        { key: 'account_id', label: 'Account ID', placeholder: '12345', type: 'text', required: true,
          description: 'Numeric ID of your DNSimple account (visible in the URL when logged in).' },
      ],
    },
    'Linode': {
      category: 'Cloud',
      docsUrl: 'https://cloud.linode.com/profile/tokens',
      summary: 'Edit Linode-managed DNS via personal access token.',
      fields: [
        { key: 'access_token', label: 'Personal Access Token', placeholder: 'linode_...', type: 'password', required: true,
          description: 'Scope must include Domains: Read/Write.' },
      ],
    },
    'Porkbun': {
      category: 'Global',
      docsUrl: 'https://porkbun.com/account/api',
      summary: 'Edit DNS via Porkbun JSON API. Enable API access on the domain first.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'pk1_...', type: 'password', required: true,
          description: 'Enable API access in your account, then copy the key.' },
        { key: 'secret', label: 'Secret API Key', placeholder: 'sk1_...', type: 'password', required: true,
          description: 'Paired secret issued alongside the API key.' },
      ],
    },
    'ClouDNS': {
      category: 'Global',
      docsUrl: 'https://www.cloudns.net/api-settings/',
      summary: 'Edit DNS via the ClouDNS API.',
      fields: [
        { key: 'auth_id', label: 'Auth ID', placeholder: 'numeric ID', type: 'text', required: true,
          description: 'Auth-ID issued by ClouDNS for API access. Sub-auth IDs work too.' },
        { key: 'auth_password', label: 'Auth Password', placeholder: '••••••••', type: 'password', required: true,
          description: 'Paired password for the auth-ID.' },
      ],
    },
    'Google Cloud DNS': {
      category: 'Cloud',
      docsUrl: 'https://cloud.google.com/dns/docs/reference/v1',
      summary: 'Edit Cloud DNS managed-zone records via OAuth2 access token.',
      fields: [
        { key: 'project_id', label: 'GCP Project ID', placeholder: 'my-project-123', type: 'text', required: true,
          description: 'Project ID hosting the managed zone.' },
        { key: 'access_token', label: 'OAuth2 Access Token', placeholder: 'ya29...', type: 'password', required: true,
          description: 'Short-lived bearer token (use a service account with roles/dns.admin and mint via gcloud auth print-access-token).' },
      ],
    },
    'Azure DNS': {
      category: 'Cloud',
      docsUrl: 'https://learn.microsoft.com/en-us/azure/dns/dns-sdk',
      summary: 'Edit Azure DNS zone records via the Azure REST API.',
      fields: [
        { key: 'subscription_id', label: 'Subscription ID', placeholder: '00000000-0000-0000-0000-000000000000', type: 'text', required: true,
          description: 'Azure subscription that contains the DNS zone.' },
        { key: 'resource_group', label: 'Resource Group', placeholder: 'my-dns-rg', type: 'text', required: true,
          description: 'Resource group that owns the dnsZones resource.' },
        { key: 'access_token', label: 'OAuth2 Access Token', placeholder: 'eyJ...', type: 'password', required: true,
          description: 'Bearer token for management.azure.com (mint via service principal or az account get-access-token).' },
      ],
    },
    'DNSPod': {
      category: 'Asia',
      docsUrl: 'https://www.dnspod.cn/console/user/security',
      summary: 'Edit DNS via the DNSPod (Tencent Cloud) login_token API.',
      fields: [
        { key: 'token', label: 'login_token', placeholder: 'id,token', type: 'password', required: true,
          description: 'Format: <id>,<token>. Generate under Security → API Token in the DNSPod console.' },
      ],
    },
    'NS1': {
      category: 'Global',
      docsUrl: 'https://my.nsone.net/#/account/settings',
      summary: 'Edit NS1 zones via the X-Nsone-Key API.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'ns1-...', type: 'password', required: true,
          description: 'Generate under Account Settings → API Keys with at least Manage zones permission.' },
      ],
    },
    'Bunny DNS': {
      category: 'Global',
      docsUrl: 'https://dash.bunny.net/account/api-key',
      summary: 'Edit Bunny DNS records via Bearer-token API.',
      fields: [
        { key: 'api_key', label: 'API Key', placeholder: 'bunny_...', type: 'password', required: true,
          description: 'Account-level API key (DNS zones share the account scope).' },
      ],
    },
    'UltraDNS': {
      category: 'Global',
      docsUrl: 'https://docs.ultradns.com/',
      summary: 'Edit UltraDNS zones via Basic-auth REST API.',
      fields: [
        { key: 'username', label: 'Username', placeholder: 'your.username', type: 'text', required: true,
          description: 'UltraDNS portal username with zone-edit privileges.' },
        { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password', required: true,
          description: 'Portal password. Recommend dedicating an API user.' },
      ],
    },
    'EdgeDNS': {
      category: 'Global',
      docsUrl: 'https://techdocs.akamai.com/edge-dns/reference',
      summary: 'Edit Akamai EdgeDNS zones via OAuth2 access token.',
      fields: [
        { key: 'access_token', label: 'EdgeGrid Access Token', placeholder: 'akab-...', type: 'password', required: true,
          description: 'Generated via Akamai Control Center → Identity & Access → API Users.' },
        { key: 'cp_code', label: 'CP Code', placeholder: '12345', type: 'text', required: true,
          description: 'Customer Profile Code that owns the EdgeDNS zone.' },
      ],
    },
    'Hetzner DNS': {
      category: 'Cloud',
      docsUrl: 'https://dns.hetzner.com/settings/api-token',
      summary: 'Edit Hetzner DNS records via Bearer-token API.',
      fields: [
        { key: 'api_token', label: 'API Token', placeholder: 'hetzner_...', type: 'password', required: true,
          description: 'Generate from DNS Console → Settings → API Tokens.' },
      ],
    },
  };

  // T164 — Per-provider brand affordance for the integrations grid.
  // Two-letter monogram + the provider's actual brand colour. Falls back to
  // a neutral gradient if a provider isn't listed.
  const PROVIDER_BRAND: Record<string, { mono: string; bg: string; text: string }> = {
    'Cloudflare':       { mono: 'CF', bg: 'linear-gradient(135deg, #f6821f 0%, #f48120 100%)', text: '#fff' },
    'AWS Route53':      { mono: 'R5', bg: 'linear-gradient(135deg, #ff9900 0%, #ff6f00 100%)', text: '#1a1208' },
    'GoDaddy':          { mono: 'GD', bg: 'linear-gradient(135deg, #1bdbdb 0%, #00838f 100%)', text: '#fff' },
    'DigitalOcean':     { mono: 'DO', bg: 'linear-gradient(135deg, #0080ff 0%, #0069d9 100%)', text: '#fff' },
    'Vercel':           { mono: 'VC', bg: 'linear-gradient(135deg, #000 0%, #1a1a1a 100%)', text: '#fff' },
    'Namecheap':        { mono: 'NC', bg: 'linear-gradient(135deg, #de3723 0%, #b81d13 100%)', text: '#fff' },
    'NameSilo':         { mono: 'NS', bg: 'linear-gradient(135deg, #009688 0%, #00695c 100%)', text: '#fff' },
    'Gandi':            { mono: 'GA', bg: 'linear-gradient(135deg, #ff6961 0%, #e63946 100%)', text: '#fff' },
    'DNSimple':         { mono: 'DS', bg: 'linear-gradient(135deg, #2c3e50 0%, #1a2530 100%)', text: '#fff' },
    'Linode':           { mono: 'LD', bg: 'linear-gradient(135deg, #00a95c 0%, #007c40 100%)', text: '#fff' },
    'Porkbun':          { mono: 'PB', bg: 'linear-gradient(135deg, #ef9a9a 0%, #e57373 100%)', text: '#fff' },
    'ClouDNS':          { mono: 'CD', bg: 'linear-gradient(135deg, #5b6df3 0%, #3949ab 100%)', text: '#fff' },
    'Google Cloud DNS': { mono: 'GC', bg: 'linear-gradient(135deg, #4285f4 0%, #1976d2 100%)', text: '#fff' },
    'Azure DNS':        { mono: 'AZ', bg: 'linear-gradient(135deg, #0072c6 0%, #004578 100%)', text: '#fff' },
    'DNSPod':           { mono: 'DP', bg: 'linear-gradient(135deg, #00a4ff 0%, #0077c2 100%)', text: '#fff' },
    'NS1':              { mono: 'N1', bg: 'linear-gradient(135deg, #25c2a0 0%, #1a8b73 100%)', text: '#fff' },
    'Bunny DNS':        { mono: 'BN', bg: 'linear-gradient(135deg, #ff8800 0%, #e07000 100%)', text: '#fff' },
    'UltraDNS':         { mono: 'UD', bg: 'linear-gradient(135deg, #d32f2f 0%, #9a0007 100%)', text: '#fff' },
    'EdgeDNS':          { mono: 'AK', bg: 'linear-gradient(135deg, #009cde 0%, #0073a8 100%)', text: '#fff' },
    'Hetzner DNS':      { mono: 'HZ', bg: 'linear-gradient(135deg, #d50c2d 0%, #a30923 100%)', text: '#fff' },
  };

  const dnsProviders = Object.keys(PROVIDER_METADATA).map(name => ({
    name,
    icon: Server,
    category: PROVIDER_METADATA[name].category,
    summary: PROVIDER_METADATA[name].summary,
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
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
      <div className="min-h-screen text-foreground" style={{background: "radial-gradient(circle at top left, rgba(255, 157, 82, 0.08), transparent 35%), linear-gradient(180deg, #090b12 0%, #0b1018 100%)"}}>
        {/* Navbar */}
        <nav className="border-b border-white/5 bg-background/70 backdrop-blur-2xl sticky top-0 z-50">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="nbp-mark w-10 h-10 text-[14px]">NBP</div>
                <div className="leading-tight">
                  <p className="eyebrow">Premium</p>
                  <h1 className="text-[15px] font-display font-bold tracking-tight">Nexus Brand Protection</h1>
                </div>
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
          {/* Hero Search */}
          <div className="mb-10">
            <div className="text-center mb-6 max-w-2xl mx-auto">
              <p className="eyebrow mb-2">Domains</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-2">
                Add a domain. Watch its posture.
              </h2>
              <p className="text-sm text-muted-foreground">
                We'll scan SPF / DKIM / DMARC, score the result, and surface anything that needs fixing.
              </p>
            </div>
            <div className="relative max-w-2xl mx-auto">
              <div className="absolute inset-0 bg-gradient-to-r from-orange-400/15 via-amber-500/15 to-orange-600/15 blur-3xl rounded-3xl pointer-events-none" />
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

          {/* Domain Details Panel */}
          {showDetails && selectedDomain && (
            <Card className="border-orange-500/50 mb-6">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-lg">{selectedDomain.name}</CardTitle>
                  <CardDescription>Scan Results & Recommended Fixes</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fixDomain(selectedDomain.id)}>
                    <Wrench className="w-4 h-4 mr-1" /> Get Fix Records
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowDetails(false)}>Close</Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* DNS Status Cards */}
                <div className="grid md:grid-cols-3 gap-4 mb-4">
                  <div className={`p-4 rounded-lg border ${selectedDomain.latest_scan?.spf_status === 'PASS' ? 'border-emerald-500 bg-emerald-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">SPF</p>
                      <span className="text-xs cursor-help" title="Sender Policy Framework - Specifies which mail servers can send email for your domain">?</span>
                    </div>
                    <p className="font-semibold">{selectedDomain.latest_scan?.spf_status || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Authorizes senders for your domain</p>
                  </div>
                  <div className={`p-4 rounded-lg border ${selectedDomain.latest_scan?.dkim_status === 'PASS' ? 'border-emerald-500 bg-emerald-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">DKIM</p>
                      <span className="text-xs cursor-help" title="DomainKeys Identified Mail - Cryptographic signature to verify email hasn't been tampered">?</span>
                    </div>
                    <p className="font-semibold">{selectedDomain.latest_scan?.dkim_status || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Digital signature verification</p>
                  </div>
                  <div className={`p-4 rounded-lg border ${selectedDomain.latest_scan?.dmarc_status === 'PASS' ? 'border-emerald-500 bg-emerald-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">DMARC</p>
                      <span className="text-xs cursor-help" title="Domain-based Message Authentication - Policy for handling failed auth">?</span>
                    </div>
                    <p className="font-semibold">{selectedDomain.latest_scan?.dmarc_status || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Policy for SPF/DKIM failures</p>
                  </div>
                </div>

                {/* Issues with Tooltips */}
                {selectedDomain.issues?.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="font-medium text-sm">Issues Found:</p>
                    {selectedDomain.issues.map((issue: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm">{issue.message || issue.type || issue}</span>
                        {issue.type === 'SPF' && (
                          <span className="text-xs text-muted ml-auto" title="Add a TXT record with 'v=spf1 include:_spf.yourdomain.com ~all'">Fix: Add SPF record</span>
                        )}
                        {issue.type === 'DMARC' && (
                          <span className="text-xs text-muted ml-auto" title="Add a TXT record with 'v=DMARC1; p=quarantine; rua=mailto:reports@yourdomain.com'">Fix: Add DMARC record</span>
                        )}
                        {issue.type === 'MTA-STS' && (
                          <span className="text-xs text-muted ml-auto" title="Add _mta-sts TXT record for SMTP TLS enforcement">Fix: Add MTA-STS record</span>
                        )}
                        {issue.type === 'TLS-RPT' && (
                          <span className="text-xs text-muted ml-auto" title="Add _smtp._tls TXT record for TLS reporting">Fix: Add TLS-RPT record</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommendations Section */}
                {fixRecommendations && (
                  <div className="space-y-3 mt-4 p-4 bg-orange-500/10 rounded-lg border border-orange-500/30">
                    <p className="font-medium text-sm">Recommended DNS Records:</p>
                    <div className="grid gap-2 text-xs font-mono">
                      {fixRecommendations.recommended_records?.spf && (
                        <div className="p-2 bg-background rounded border">
                          <span className="text-muted">SPF:</span> {fixRecommendations.recommended_records.spf.recommended}
                        </div>
                      )}
                      {fixRecommendations.recommended_records?.dmarc && (
                        <div className="p-2 bg-background rounded border">
                          <span className="text-muted">DMARC:</span> {fixRecommendations.recommended_records.dmarc.recommended}
                        </div>
                      )}
                      {fixRecommendations.recommended_records?.mta_sts && (
                        <div className="p-2 bg-background rounded border">
                          <span className="text-muted">MTA-STS:</span> {fixRecommendations.recommended_records.mta_sts.recommended}
                        </div>
                      )}
                      {fixRecommendations.recommended_records?.tls_rpt && (
                        <div className="p-2 bg-background rounded border">
                          <span className="text-muted">TLS-RPT:</span> {fixRecommendations.recommended_records.tls_rpt.recommended}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      Provider: {fixRecommendations.email_provider?.provider} | Auto-fix: {fixRecommendations.auto_fix_supported ? 'Supported' : 'Manual only'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {[
              { label: "Total Domains", value: stats.total, icon: Globe, color: "indigo", filter: null },
              { label: "Passing", value: stats.passing, icon: CheckCircle, color: "emerald", filter: "passing" },
              { label: "Warnings", value: stats.warnings, icon: AlertTriangle, color: "amber", filter: "warnings" },
              { label: "Failed", value: stats.failed, icon: XCircle, color: "rose", filter: "failed" },
            ].map((stat, i) => (
              <Card key={i} className="border-border/40 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => { setActiveTab("domains"); setDomainFilter(stat.filter); }}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-${stat.color}-500/10 flex items-center justify-center`}>
                    <stat.icon className={`w-6 h-6 text-${stat.color}-500`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

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
            </TabsList>

            <TabsContent value="domains" className="space-y-4">
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
                const atRisk = domains.filter((d: any) => typeof d.last_score === 'number' && d.last_score < 80).length;
                const avgScoreColor = avgScore == null ? 'text-muted-foreground' : avgScore >= 80 ? 'text-emerald-400' : avgScore >= 50 ? 'text-amber-400' : 'text-red-400';
                const stats = [
                  { label: 'Total domains', value: total, hint: `${total === 1 ? 'domain' : 'domains'} on file`, icon: Globe, accent: 'text-foreground' },
                  { label: 'Verified', value: verified, hint: `${total - verified} pending verification`, icon: CheckCircle, accent: verified === total ? 'text-emerald-400' : 'text-foreground' },
                  { label: 'Avg health', value: avgScore == null ? '—' : `${avgScore}`, hint: avgScore == null ? 'No scans yet' : avgScore >= 80 ? 'Strong posture' : avgScore >= 50 ? 'Fixes recommended' : 'Action required', icon: Activity, accent: avgScoreColor },
                  { label: 'At risk', value: atRisk, hint: atRisk === 0 ? 'No domains below 80' : `${atRisk} below threshold`, icon: AlertTriangle, accent: atRisk > 0 ? 'text-amber-400' : 'text-emerald-400' },
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
                    { key: 'passing', label: 'Passing', count: domains.filter((d: any) => (d.last_score || 0) >= 80).length },
                    { key: 'warnings', label: 'Warnings', count: domains.filter((d: any) => (d.last_score || 0) >= 50 && (d.last_score || 0) < 80).length },
                    { key: 'failed', label: 'Failed', count: domains.filter((d: any) => (d.last_score || 0) < 50 && d.last_score != null).length },
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
                    <span>{((domainFilter === 'passing' ? domains.filter((d: any) => (d.last_score || 0) >= 80) :
                            domainFilter === 'warnings' ? domains.filter((d: any) => (d.last_score || 0) >= 50 && (d.last_score || 0) < 80) :
                            domainFilter === 'failed' ? domains.filter((d: any) => (d.last_score || 0) < 50 && d.last_score != null) :
                            domains).length)} shown</span>
                  </div>

                  {((domainFilter === 'passing' ? domains.filter((d: any) => (d.last_score || 0) >= 80) :
                    domainFilter === 'warnings' ? domains.filter((d: any) => (d.last_score || 0) >= 50 && (d.last_score || 0) < 80) :
                    domainFilter === 'failed' ? domains.filter((d: any) => (d.last_score || 0) < 50 && d.last_score != null) :
                    domains)).map((domain: any) => {
                    const score = domain.last_score;
                    const hasScore = typeof score === 'number';
                    const scoreColor = !hasScore ? '#94a3b8' : score >= 80 ? '#86efac' : score >= 50 ? '#fbbf24' : '#fca5a5';
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
                    const spf = domain.latest_scan?.spf_status || (hasScore ? 'UNKNOWN' : null);
                    const dkim = domain.latest_scan?.dkim_status || (hasScore ? 'UNKNOWN' : null);
                    const dmarc = domain.latest_scan?.dmarc_status || (hasScore ? 'UNKNOWN' : null);
                    const pillClass = (status: string | null) => !status ? 'bg-white/5 text-muted-foreground border-white/5' :
                      status === 'PASS' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' :
                      status === 'FAIL' ? 'bg-red-500/10 text-red-300 border-red-500/30' :
                      'bg-amber-500/10 text-amber-300 border-amber-500/30';

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
                                <span key={p.k} className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${pillClass(p.v)}`}>
                                  {p.k}
                                  {p.v && <span className="opacity-70">·</span>}
                                  {p.v && <span>{p.v === 'PASS' ? '✓' : p.v === 'FAIL' ? '✕' : '?'}</span>}
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
              <div>
                <p className="eyebrow mb-2">Integrations</p>
                <h2 className="font-display text-2xl font-bold tracking-tight mb-1">DNS providers</h2>
                <p className="text-sm text-muted-foreground">
                  Connect your DNS host so we can auto-remediate SPF / DMARC / DKIM records for you. Every provider listed has a real, working API.
                </p>
              </div>

              {/* T164 — Connection summary strip: how much of the integration surface is configured */}
              {(() => {
                const totalProviders = dnsProviders.length;
                const connected = dnsProviders.filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
                const byCat = (cat: string) => dnsProviders.filter((p: any) => p.category === cat);
                const connectedIn = (cat: string) => byCat(cat).filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
                return (
                  <div className="premium-surface premium-card border-0 rounded-xl p-5">
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="flex items-center gap-4">
                        <div className="relative w-16 h-16 flex-shrink-0">
                          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#86efac" strokeWidth="3" strokeLinecap="round"
                              strokeDasharray={`${totalProviders > 0 ? (connected / totalProviders) * 100 : 0} ${100 - (totalProviders > 0 ? (connected / totalProviders) * 100 : 0)}`} />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="font-display text-base font-bold tabular-nums leading-none text-emerald-300">{connected}</span>
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none mt-0.5">of {totalProviders}</span>
                          </div>
                        </div>
                        <div>
                          <p className="font-display text-lg font-bold tracking-tight">
                            {connected === 0 ? 'No providers connected' : `${connected} provider${connected === 1 ? '' : 's'} ready`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {connected === 0 ? 'Connect a DNS provider below to unlock auto-remediation.' : 'Auto-remediation will run on detected issues.'}
                          </p>
                        </div>
                      </div>
                      <div className="hairline flex-1 hidden sm:block" />
                      <div className="flex items-center gap-5 text-xs">
                        {(['Global', 'Cloud', 'Asia'] as const).map((cat) => (
                          <div key={cat}>
                            <p className="uppercase tracking-widest text-muted-foreground font-semibold text-[10px]">{cat}</p>
                            <p className="font-display font-bold text-base mt-0.5 tabular-nums">
                              <span className={connectedIn(cat) > 0 ? 'text-emerald-300' : 'text-muted-foreground'}>{connectedIn(cat)}</span>
                              <span className="text-muted-foreground/60 mx-1">/</span>
                              <span className="text-muted-foreground">{byCat(cat).length}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {(['Global', 'Cloud', 'Asia'] as const).map((category) => {
                const providersInCategory = dnsProviders.filter((p: any) => p.category === category);
                if (providersInCategory.length === 0) return null;
                return (
                  <div key={category} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">{category}</h3>
                      <div className="hairline flex-1" />
                      <span className="text-xs text-muted-foreground">{providersInCategory.length} providers</span>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {providersInCategory.map((provider: any) => {
                        const isConnected = settings?.provider_credentials?.[provider.name.toLowerCase()];
                        const meta = PROVIDER_METADATA[provider.name];
                        const requiredCount = meta?.fields.filter((f: ProviderField) => f.required).length || 0;
                        const brand = PROVIDER_BRAND[provider.name] || { mono: provider.name.slice(0, 2).toUpperCase(), bg: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)', text: '#fff' };

                        return (
                          <Card key={provider.name} className={`premium-surface premium-card rounded-xl ${isConnected ? 'border-emerald-500/30' : 'border-0'}`}>
                            <CardContent className="p-5">
                              <div className="flex items-start justify-between mb-3 gap-3">
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  <div
                                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-bold text-[13px] shadow-lg"
                                    style={{ background: brand.bg, color: brand.text, letterSpacing: '-0.02em' }}
                                  >
                                    {brand.mono}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-display font-semibold tracking-tight truncate text-[15px]">{provider.name}</p>
                                    {isConnected ? (
                                      <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5 font-medium">
                                        <span className="relative flex h-1.5 w-1.5">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400"></span>
                                        </span>
                                        Connected
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {requiredCount} field{requiredCount === 1 ? '' : 's'} required
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <p className="text-[11.5px] text-muted-foreground mb-4 line-clamp-2 leading-relaxed">
                                {provider.summary}
                              </p>
                              {isConnected ? (
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 text-[11px] h-8 border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-300"
                                    onClick={() => testProviderConnection(provider)}
                                  >
                                    <Zap className="w-3 h-3 mr-1" /> Test
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-[11px] h-8 px-2 border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5"
                                    onClick={() => openProviderModal(provider)}
                                    title="Reconfigure"
                                  >
                                    <Settings className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-[11px] h-8 px-2 border-white/10 text-red-400 hover:bg-red-500/10 hover:border-red-500/40"
                                    onClick={() => disconnectProvider(provider.name)}
                                    title="Disconnect"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full text-[11px] h-8 border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5"
                                  onClick={() => openProviderModal(provider)}
                                >
                                  <Plug className="w-3 h-3 mr-1.5" /> Configure
                                </Button>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </TabsContent>

        {showProviderModal && selectedProvider && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowProviderModal(false)}>
            <div className="premium-surface rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {/* Hero — provider brand strip */}
              {(() => {
                const brand = PROVIDER_BRAND[selectedProvider.name] || { mono: selectedProvider.name.slice(0, 2).toUpperCase(), bg: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)', text: '#fff' };
                const meta = PROVIDER_METADATA[selectedProvider.name];
                return (
                  <div className="relative px-6 pt-6 pb-5 border-b border-white/5">
                    <div className="absolute inset-0 opacity-[0.08]" style={{ background: brand.bg }} />
                    <div className="relative flex items-start gap-4">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-display font-bold text-base shadow-2xl"
                        style={{ background: brand.bg, color: brand.text, letterSpacing: '-0.02em' }}
                      >
                        {brand.mono}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="eyebrow mb-1">Connect provider · {meta?.category}</p>
                        <h3 className="font-display text-xl font-bold tracking-tight">{selectedProvider.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{meta?.summary}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-1" onClick={() => setShowProviderModal(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })()}

              <div className="p-6">
                {/* Field stack */}
                <div className="space-y-4">
                  {(PROVIDER_METADATA[selectedProvider.name]?.fields || []).map((field: ProviderField) => (
                    <div key={field.key}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                          {field.label}
                          {field.required && <span className="ml-1.5 text-orange-400 normal-case" title="Required">*</span>}
                        </label>
                        {!field.required && <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Optional</span>}
                      </div>
                      <Input
                        type={field.type}
                        value={providerCreds[field.key] || ''}
                        onChange={(e) => setProviderCreds({...providerCreds, [field.key]: e.target.value})}
                        placeholder={field.placeholder}
                        className="bg-background/50 border-white/10 focus-visible:border-orange-500/40 font-mono text-sm"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{field.description}</p>
                    </div>
                  ))}
                </div>

                {/* Docs deep-link + security note */}
                <div className="mt-5 p-3 rounded-lg bg-white/[0.03] border border-white/5 flex items-start gap-3">
                  <Key className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-[11px] text-muted-foreground leading-relaxed">
                    <p className="mb-1">
                      <a
                        href={PROVIDER_METADATA[selectedProvider.name]?.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-300 hover:text-orange-200 font-medium underline underline-offset-2"
                      >
                        Open {selectedProvider.name} API settings ↗
                      </a>
                    </p>
                    <p>Credentials are stored encrypted at rest, scoped to this tenant. We never log or display them after save.</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-5">
                  <Button
                    className="btn-premium-primary border-0 flex-1"
                    onClick={saveProviderCredentials}
                    disabled={
                      savingProvider ||
                      !!(PROVIDER_METADATA[selectedProvider.name]?.fields || [])
                        .filter((f: ProviderField) => f.required)
                        .find((f: ProviderField) => !providerCreds[f.key]?.trim())
                    }
                  >
                    {savingProvider ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <><CheckCircle className="w-4 h-4 mr-2" /> Save credentials</>}
                  </Button>
                  <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={() => setShowProviderModal(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

            <TabsContent value="notifications" className="space-y-6">
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
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-orange-500/15 text-orange-400' : 'bg-white/5 text-muted-foreground'}`}>
                            <pref.icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{pref.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{pref.desc}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`min-w-[70px] ${on ? 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 hover:text-orange-200 border border-orange-500/30' : 'text-muted-foreground border border-white/10 hover:bg-white/5'}`}
                          onClick={() => saveNotifications(pref.key, !on)}
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
            </TabsContent>

            <TabsContent value="reports" className="space-y-6">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="eyebrow mb-2">Reports</p>
                  <h2 className="font-display text-2xl font-bold tracking-tight mb-1">Generate &amp; export</h2>
                  <p className="text-sm text-muted-foreground">Per-domain HTML reports for stakeholders. Bulk CSV / JSON exports for archive.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportCSV}>
                    <Download className="w-4 h-4 mr-2" /> Export all (CSV)
                  </Button>
                  <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportJSON}>
                    <Download className="w-4 h-4 mr-2" /> Export all (JSON)
                  </Button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <Card className="premium-surface premium-card border-0">
                  <CardHeader>
                    <CardTitle className="font-display tracking-tight flex items-center gap-2">
                      <FileText className="w-4 h-4 text-orange-400" /> Single domain report
                    </CardTitle>
                    <CardDescription>Detailed HTML breakdown of one domain&rsquo;s SPF / DKIM / DMARC posture.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <select
                      className="w-full h-10 px-3 rounded-md border border-white/10 bg-background/50 text-sm focus-visible:outline-none focus-visible:border-orange-500/40"
                      value={reportDomainId || ''}
                      onChange={(e) => setReportDomainId(Number(e.target.value))}
                    >
                      <option value="">Select a domain&hellip;</option>
                      {domains.map((d: any) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <Button
                      className="w-full btn-premium-primary border-0"
                      onClick={() => reportDomainId && generateReport(reportDomainId)}
                      disabled={!reportDomainId || generatingReport}
                    >
                      {generatingReport ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating&hellip;</> : <><FileText className="w-4 h-4 mr-2" /> Generate report</>}
                    </Button>
                  </CardContent>
                </Card>

                <Card className="premium-surface premium-card border-0">
                  <CardHeader>
                    <CardTitle className="font-display tracking-tight flex items-center gap-2">
                      <Download className="w-4 h-4 text-orange-400" /> Bulk export
                    </CardTitle>
                    <CardDescription>Download every domain&rsquo;s latest scan as a single archive.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportCSV}>
                      <Download className="w-4 h-4 mr-2" /> CSV &mdash; spreadsheet-friendly
                    </Button>
                    <Button variant="outline" className="w-full border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={exportJSON}>
                      <Download className="w-4 h-4 mr-2" /> JSON &mdash; full structured data
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="space-y-6">
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
                    {dnsProviders.map((p: any) => {
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
                                      alert(err.error || `Failed to add brand (HTTP ${res.status})`);
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
                                  {brandScanResult.typosquatting.length > 10 && <p className="text-muted">+{brandScanResult.typosquatting.length - 10} more</p>}
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
                                  {brandScanResult.impersonation.length > 10 && <p className="text-muted">+{brandScanResult.impersonation.length - 10} more</p>}
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
