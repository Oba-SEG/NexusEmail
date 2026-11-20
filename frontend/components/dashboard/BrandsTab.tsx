"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Shield, Search, AlertTriangle, CheckCircle, XCircle, Plus, RefreshCw,
  Zap, Eye, ChevronRight, Bell, Trash2, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { notify, describeApiError } from "@/components/ui/status";
import { TabHeader } from "@/components/dashboard/settings-ui";
import { formatDateTime } from "@/lib/format";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, dialogFocusReturn,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const selectClass = "mt-1 flex h-9 w-full rounded-md border border-input bg-white/[0.02] px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const textareaClass = "mt-1 w-full rounded-md border border-input bg-white/[0.02] px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const ISSUE_LABELS: Record<string, string> = {
  typosquatting: 'Typosquatting',
  lookalike: 'Lookalike domains',
  subdomain_abuse: 'Subdomain abuse',
  homograph: 'Homographs',
  social_media: 'Social media profiles',
};

interface BrandsTabProps {
  brands: any[];
  domains: any[];
  loadBrands: (gen?: number) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  sessionGenRef: { current: number };
  tokenRef: { current: string | null };
  onGoToDomains: () => void;
  onAuthFailure: (requestToken?: string | null) => void;
  openBrandId?: number | null;
  onBrandSelectionChange?: (id: number | null) => void;
}

/** Brand Protection tab: monitored brand list, add-brand scan flow and
 * the brand-details / takedown / threat / alerts overlays. State is
 * owned here so it resets with the tab (identity change included). */
export default function BrandsTab({
  brands, domains, loadBrands, apiFetch, sessionGenRef, tokenRef, onGoToDomains, onAuthFailure,
  openBrandId = null, onBrandSelectionChange,
}: BrandsTabProps) {
  const brandDetailsRef = useRef<number | null>(null);
  const brandDetailsGenRef = useRef(0);
  const [selectedBrand, setSelectedBrand] = useState<any>(null);
  const [brandQuery, setBrandQuery] = useState('');
  const [showTakedownModal, setShowTakedownModal] = useState(false);
  const [showThreatModal, setShowThreatModal] = useState(false);
  const [takedownForm, setTakedownForm] = useState({ domain: '', threat_type: 'impersonation', evidence: '', contact_email: '' });
  const [threatForm, setThreatForm] = useState({ domain: '', threat_type: 'manual', severity: 'medium', notes: '' });
  const [brandThreats, setBrandThreats] = useState<any[]>([]);
  const [brandTakedowns, setBrandTakedowns] = useState<any[]>([]);
  const [brandAlerts, setBrandAlerts] = useState<any[]>([]);
  const [bulkScanning, setBulkScanning] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandDomain, setNewBrandDomain] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [brandScanResult, setBrandScanResult] = useState<any>(null);
  const [brandScanning, setBrandScanning] = useState(false);
  const [brandHistory, setBrandHistory] = useState<any[]>([]);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [savingSchedules, setSavingSchedules] = useState<Set<number>>(new Set());
  const [newBrandSchedule, setNewBrandSchedule] = useState('daily');
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const toggleSection = (key: string) => {
    setExpandedSections((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));
  };
  const sectionToggleProps = (key: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': expandedSections.includes(key),
    onClick: () => toggleSection(key),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      // Chrome exposes overflowing lists as focusable scrollers; their Space
      // key belongs to the list, not to this header.
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSection(key);
      }
    },
  });
  const [brandToDelete, setBrandToDelete] = useState<any>(null);
  const brandDetailsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const takedownOpenerRef = useRef<HTMLButtonElement | null>(null);
  const threatOpenerRef = useRef<HTMLButtonElement | null>(null);
  const alertsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const brandDeleteOpenerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alertsLoadSeqRef = useRef(0);
  const loadAlerts = async (gen: number = sessionGenRef.current) => {
    const seq = ++alertsLoadSeqRef.current;
    const requestToken = tokenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts`);
      if (gen !== sessionGenRef.current) return;
      if (seq !== alertsLoadSeqRef.current) return;
      if (res.status === 401) {
        onAuthFailure(requestToken);
        return;
      }
      if (!res.ok) {
        console.error(`Failed to load alerts: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      if (seq !== alertsLoadSeqRef.current) return;
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
    const requestToken = tokenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/threats`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        onAuthFailure(requestToken);
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
    const requestToken = tokenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/takedowns`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        onAuthFailure(requestToken);
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

  const loadBrandHistory = async (brandId: number, gen: number = sessionGenRef.current, sel: number = brandDetailsGenRef.current) => {
    if (gen === sessionGenRef.current && sel === brandDetailsGenRef.current) setHistoryState('loading');
    const requestToken = tokenRef.current;
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/history`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) { onAuthFailure(requestToken); return; }
      if (!res.ok) {
        console.error(`Failed to load history: HTTP ${res.status}`);
        if (brandDetailsRef.current === brandId && sel === brandDetailsGenRef.current) setHistoryState('error');
        return;
      }
      const data = await res.json();
      if (gen !== sessionGenRef.current) return;
      if (brandDetailsRef.current !== brandId) return;
      if (sel !== brandDetailsGenRef.current) return;
      setBrandHistory(Array.isArray(data) ? data : []);
      setHistoryState('ready');
    } catch (e) {
      console.error('Failed to load history:', e);
      if (gen === sessionGenRef.current && brandDetailsRef.current === brandId && sel === brandDetailsGenRef.current) setHistoryState('error');
    }
  };

  const updateBrandSchedule = async (brandId: number, scan_schedule: string) => {
    const gen = sessionGenRef.current;
    // Serialize per brand: the selector is disabled while its save is in
    // flight so an earlier request can't land after a later selection.
    setSavingSchedules((s) => new Set(s).add(brandId));
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_schedule }),
      });
      if (!res.ok) {
        if (gen === sessionGenRef.current) notify('Couldn\'t update the schedule.', 'error', `HTTP ${res.status}`);
        return;
      }
      if (gen === sessionGenRef.current) loadBrands(gen);
    } catch (e) {
      console.error('Failed to update schedule:', e);
      if (gen === sessionGenRef.current) notify('Couldn\'t update the schedule.', 'error', 'The request failed.');
    } finally {
      if (gen === sessionGenRef.current) {
        setSavingSchedules((s) => {
          const next = new Set(s);
          next.delete(brandId);
          return next;
        });
      }
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
    onBrandSelectionChange?.(brand.id);
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
    setBrandHistory([]);
    setHistoryState('idle');
    loadBrandThreats(brand.id);
    loadBrandTakedowns(brand.id);
    loadBrandHistory(brand.id);
  };

  // Deep links (?tab=brands&brand=…) open the brand dialog once the
  // brand list has arrived; manual opens sync the URL via
  // onBrandSelectionChange instead.
  const openedDeepLinkRef = useRef<number | null>(null);
  useEffect(() => {
    if (!openBrandId) return;
    if (selectedBrand?.id === openBrandId) return;
    if (openedDeepLinkRef.current === openBrandId) return;
    const brand = brands.find((b: any) => b.id === openBrandId);
    if (!brand) return;
    openedDeepLinkRef.current = openBrandId;
    openBrandDetails(brand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBrandId, brands, selectedBrand]);

  // Browser back/forward can clear the brand deep link while the dialog
  // is still open; close it to match the address bar.
  useEffect(() => {
    if (openBrandId === null && selectedBrand) setSelectedBrand(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBrandId]);

  const closeBrandDetails = () => {
    setSelectedBrand(null);
    openedDeepLinkRef.current = null;
    onBrandSelectionChange?.(null);
  };

  const deleteBrand = () => {
    const brand = brandToDelete;
    setBrandToDelete(null);
    const gen = sessionGenRef.current;
    apiFetch(`${API_BASE}/brands/${brand.id}`, { method: 'DELETE' })
      .then((res: Response) => {
        if (gen !== sessionGenRef.current) return;
        if (!res.ok) {
          notify('Couldn\'t remove the brand.', 'error', `HTTP ${res.status}`);
          return;
        }
        notify('Brand removed.', 'success');
        loadBrands(gen);
      })
      .catch((e: unknown) => {
        console.error('Failed to delete brand:', e);
        if (gen === sessionGenRef.current) notify('Couldn\'t remove the brand.', 'error', 'The request failed.');
      });
  };

  const normalizedBrandQuery = brandQuery.trim().toLowerCase();
  const filteredBrands = brands.filter((brand: any) =>
    !normalizedBrandQuery ||
    String(brand.domain || '').toLowerCase().includes(normalizedBrandQuery) ||
    String(brand.brand_name || '').toLowerCase().includes(normalizedBrandQuery)
  );

  return (
    <>
<TabHeader
  title="Brand protection"
  description="Detect typosquats, look-alikes, and brand abuse on the domains you operate."
  action={
    <>
      {brandAlerts.length > 0 && (
        <Button variant="outline" size="sm" className="text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={(e) => { alertsOpenerRef.current = e.currentTarget; setShowAlertsModal(true); }}>
          <Bell className="w-3.5 h-3.5" /> Alerts
          <span className="ml-0.5 tabular-nums opacity-80">{brandAlerts.length}</span>
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={bulkScanAll} disabled={bulkScanning || brandScanning}>
        <RefreshCw className={`w-3.5 h-3.5 ${bulkScanning ? 'animate-spin' : ''}`} />
        Scan all
      </Button>
      <Button size="sm" onClick={() => setShowAddBrand(true)}>
        <Plus className="w-3.5 h-3.5" /> Add brand
      </Button>
    </>
  }
/>

<div className="mt-1">
  <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h3 className="text-[14px] font-semibold">
        Monitored brands
        <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{brands.length}</span>
      </h3>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Each brand is tied to a verified domain you own.</p>
    </div>
    <div className="relative w-full sm:w-[240px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={brandQuery}
        onChange={(e) => setBrandQuery(e.target.value)}
        placeholder="Search brands"
        aria-label="Search brands"
        className="h-8 w-full border-0 border-b border-border bg-transparent pl-8 text-[12.5px] focus-visible:border-primary focus-visible:ring-0"
      />
    </div>
  </div>
  <div className="space-y-4">
    {showAddBrand && (
      <div className="border-y border-border py-4">
        <p className="text-[14px] font-semibold">Add a brand to monitor</p>
        <p className="mb-4 mt-0.5 text-[12px] text-muted-foreground">Pick a verified domain, then name the brand you want to protect.</p>
        {domains.filter((d: any) => d.verified).length === 0 ? (
          <div className="space-y-3">
            <div className="border-l border-amber-500/40 py-1 pl-3 text-[12.5px] leading-5 text-amber-300">
              You don't have any verified domains yet. Brand Protection only monitors domains you own and have verified, so you can't add a brand until at least one of your domains is verified.
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setShowAddBrand(false);
                  onGoToDomains();
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="new-brand-domain" className="text-[12px] font-medium text-muted-foreground">Domain</label>
              <select
                id="new-brand-domain"
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
                className={selectClass}
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
              <label htmlFor="new-brand-name" className="text-[12px] font-medium text-muted-foreground">Brand name (optional)</label>
              <Input
                id="new-brand-name"
                placeholder="My Company"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <label htmlFor="new-brand-schedule" className="text-[12px] font-medium text-muted-foreground">Automatic scans</label>
              <select
                id="new-brand-schedule"
                value={newBrandSchedule}
                onChange={(e) => setNewBrandSchedule(e.target.value)}
                className={selectClass}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
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
                      brand_name: newBrandName || newBrandDomain.split('.')[0],
                      scan_schedule: newBrandSchedule
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
                    setNewBrandSchedule('daily');
                    setShowAddBrand(false);
                  });
                }}
              >
                <Save className="w-3.5 h-3.5" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setShowAddBrand(false);
                setNewBrandDomain('');
                setNewBrandName('');
                setNewBrandSchedule('daily');
              }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    )}

    {brands.length === 0 && !showAddBrand ? (
      <div className="border-y border-border px-6 py-16 text-center">
        <p className="text-[15px] font-semibold">No brands monitored yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-5 text-muted-foreground">Add a brand to start watching for typosquatting and impersonation.</p>
      </div>
    ) : (
      <div className="divide-y divide-border border-y border-border">
        {filteredBrands.map((brand: any) => (
          <div key={brand.id} className="flex flex-col gap-3 py-3.5 transition-colors hover:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="truncate font-mono text-[12.5px] font-medium">{brand.domain}</p>
                <p className="text-[12px] text-muted-foreground">{brand.brand_name}</p>
                {(brand.threats?.length || 0) > 0 && (
                  <span className="text-[10.5px] font-medium text-amber-300">
                    {brand.threats.length} threat{brand.threats.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {brand.last_scan ? `Last scan ${formatDateTime(brand.last_scan)}` : 'Never scanned'}
                {brand.next_scan ? ` · Next ${formatDateTime(brand.next_scan)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:flex-shrink-0">
              <label htmlFor={`brand-schedule-${brand.id}`} className="sr-only">Scan schedule for {brand.domain}</label>
              <select
                id={`brand-schedule-${brand.id}`}
                value={brand.scan_schedule || 'manual'}
                onChange={(e) => updateBrandSchedule(brand.id, e.target.value)}
                disabled={savingSchedules.has(brand.id)}
                className="h-8 rounded-md border border-input bg-white/[0.03] px-2 text-[12px] text-muted-foreground disabled:opacity-50"
              >
                <option value="manual">Manual</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <Button variant="outline" size="sm" onClick={async () => {
                setBrandScanning(true);
                setBrandScanResult(null);
                const gen = sessionGenRef.current;
                try {
                    const res = await apiFetch(`${API_BASE}/brands/check/${brand.id}`, { method: 'POST' });
                    const data = await res.json();
                    if (gen !== sessionGenRef.current) return;
                    setBrandScanResult(data.error ? { error: data.error, brand: brand.domain } : { ...data, brand: brand.domain });
                    // Refresh the persisted view (last_scan, next_scan, threats)
                    // and the alert feed — a first scan can create alerts.
                    loadBrands(gen);
                    loadAlerts(gen);
                  } catch (e) {
                    if (gen === sessionGenRef.current) setBrandScanResult({ error: 'Scan failed' });
                } finally {
                  if (gen === sessionGenRef.current) setBrandScanning(false);
                }
              }} disabled={brandScanning || bulkScanning}>
                <Search className="w-3.5 h-3.5" /> Scan
              </Button>
              <Button variant="outline" size="sm" className="px-2" aria-label={`Open details for ${brand.domain}`} onClick={(e) => { brandDetailsOpenerRef.current = e.currentTarget; openBrandDetails(brand); }}>
                <Eye className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="px-2" aria-label={`Delete brand ${brand.domain}`} onClick={(e) => { brandDeleteOpenerRef.current = e.currentTarget; setBrandToDelete(brand); }}>
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              </Button>
            </div>
          </div>
        ))}
        {brands.length > 0 && filteredBrands.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            No brands match &ldquo;{brandQuery}&rdquo;.
            <button
              onClick={() => setBrandQuery('')}
              className="ml-2 text-primary underline-offset-2 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    )}

    {/* Scan Results Display */}
    {/* persistent live region so scan start/finish is announced */}
    <span role="status" aria-live="polite" className="sr-only">
      {brandScanning
        ? 'Scanning brand surface'
        : brandScanResult?.error
          ? `Brand scan failed: ${brandScanResult.error}`
          : brandScanResult
            ? 'Brand scan finished'
            : ''}
    </span>
    {brandScanning && (
      <div className="mt-4 rounded-md border border-border bg-white/[0.02] p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-[13px] font-medium">Scanning brand surface…</span>
        </div>
        {/* Honest status: the backend reports progress only when the scan
            completes, so a stepwise checklist here would be a lie. An
            indeterminate state with a real duration expectation isn't. */}
        <p className="text-xs text-muted-foreground mt-2">
          DNS lookups across typosquatting, lookalike, subdomain and homograph checks — usually takes 30–90 seconds. The result replaces this note when it lands.
        </p>
      </div>
    )}

    {brandScanResult && !brandScanning && (
      <div className="mt-4 rounded-md border border-border bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-medium">Brand protection results</p>
          <Button variant="ghost" size="sm" onClick={() => setBrandScanResult(null)}>Clear</Button>
        </div>
        {brandScanResult.error ? (
          <p className="text-[12px] text-red-400">{brandScanResult.error}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-md bg-white/[0.03] p-2.5">
                <p className="text-muted-foreground">Score</p>
                <p className="text-[15px] font-semibold tabular-nums">{brandScanResult.score}/100</p>
              </div>
              <div className="rounded-md bg-white/[0.03] p-2.5">
                <p className="text-muted-foreground">DNS provider</p>
                <p className="font-medium">{brandScanResult.dns_provider?.name || 'Unknown'}</p>
              </div>
              <div className="rounded-md bg-white/[0.03] p-2.5">
                <p className="text-muted-foreground">TLD coverage</p>
                <p className="font-medium tabular-nums">
                  {brandScanResult.tld_count ? `${brandScanResult.tld_count} TLDs checked` : 'Pending'}
                </p>
              </div>

              {/* Clickable: Typosquatting */}
              <div className="cursor-pointer rounded-md bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]" {...sectionToggleProps('typo')}>
                <p className="text-muted-foreground flex items-center gap-1">
                  Typosquatting
                  <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('typo') ? 'rotate-90' : ''}`} />
                </p>
                <p className="font-medium">{brandScanResult.typosquatting?.length || 0} found</p>
                {expandedSections.includes('typo') && brandScanResult.typosquatting?.length > 0 && (
                  <div className="mt-2 text-xs space-y-1 max-h-48 overflow-y-auto pr-1">
                    {brandScanResult.typosquatting.map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 p-1 bg-background rounded">
                        <span className="truncate flex-1" title={t.domain}>{t.domain}</span>
                        {String(t.type || '').startsWith('same_name') && (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">same name</Badge>
                        )}
                        {String(t.type || '').endsWith('_with_email') && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">email</Badge>
                        )}
                        {t.hasWebsite === false && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">parked</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clickable: Lookalikes */}
              <div className="cursor-pointer rounded-md bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]" {...sectionToggleProps('lookalike')}>
                <p className="text-muted-foreground flex items-center gap-1">
                  Lookalikes
                  <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('lookalike') ? 'rotate-90' : ''}`} />
                </p>
                <p className="font-medium">{brandScanResult.lookalikes?.length || 0} found</p>
                {expandedSections.includes('lookalike') && brandScanResult.lookalikes?.length > 0 && (
                  <div className="mt-2 text-xs space-y-1 max-h-48 overflow-y-auto pr-1">
                    {brandScanResult.lookalikes.map((l: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 p-1 bg-background rounded">
                        <span className="truncate flex-1" title={l.domain}>{l.domain}</span>
                        {l.type && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">{l.type}</Badge>
                        )}
                        {l.hasMailServer && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">email</Badge>
                        )}
                        {l.hasWebsite === false && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">parked</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clickable: Impersonation */}
              <div className="cursor-pointer rounded-md bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]" {...sectionToggleProps('impersonation')}>
                <p className="text-muted-foreground flex items-center gap-1">
                  Impersonation
                  <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('impersonation') ? 'rotate-90' : ''}`} />
                </p>
                <p className="font-medium">{brandScanResult.impersonation?.length || 0} found</p>
                {expandedSections.includes('impersonation') && brandScanResult.impersonation?.length > 0 && (
                  <div className="mt-2 text-xs space-y-1 max-h-48 overflow-y-auto pr-1">
                    {brandScanResult.impersonation.map((imp: any, i: number) => (
                      <div key={i} className="p-1 bg-background rounded truncate">{imp.domain}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clickable: Homographs */}
              <div className="cursor-pointer rounded-md bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]" {...sectionToggleProps('homograph')}>
                <p className="text-muted-foreground flex items-center gap-1">
                  Homographs
                  <ChevronRight className={`w-3 h-3 transition-transform ${expandedSections.includes('homograph') ? 'rotate-90' : ''}`} />
                </p>
                <p className="font-medium">{brandScanResult.homographs?.length || 0} found</p>
                {expandedSections.includes('homograph') && brandScanResult.homographs?.length > 0 && (
                  <div className="mt-2 text-xs space-y-1 max-h-48 overflow-y-auto pr-1">
                    {brandScanResult.homographs.map((h: any, i: number) => (
                      <div key={i} className="p-1 bg-background rounded">
                        <p className="truncate" title={h.domain}>{h.unicode || h.domain}</p>
                        {h.punycode && <p className="truncate text-muted-foreground">{h.punycode}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clickable: NS Records */}
              <div className="cursor-pointer rounded-md bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]" {...sectionToggleProps('ns')}>
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
                <p className="text-[13px] font-medium">Issues</p>
                {brandScanResult.issues.map((issue: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>{ISSUE_LABELS[issue.type] || issue.type}: {issue.count} {issue.count === 1 ? 'issue' : 'issues'}</span>
                  </div>
                ))}
              </div>
            )}
            {brandScanResult.recommendations?.length > 0 && (
              <div className="text-[12px] text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Recommendations</p>
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
    </div>
</div>

{/* Brand Details Modal */}
{selectedBrand && (
  <Dialog open onOpenChange={(o) => { if (!o) closeBrandDetails(); }}>
    <DialogContent className="max-h-[80vh] w-full max-w-2xl overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(brandDetailsOpenerRef)}>
      <div>
        <DialogTitle className="font-mono text-[15px]">{selectedBrand.domain}</DialogTitle>
        <DialogDescription>{selectedBrand.brand_name}</DialogDescription>
      </div>

      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 border-y border-border/60 py-3">
          <Button size="sm" onClick={(e) => { takedownOpenerRef.current = e.currentTarget; setShowTakedownModal(true); }}>
            <Zap className="w-3.5 h-3.5" /> Submit takedown
          </Button>
          <Button variant="outline" size="sm" onClick={(e) => { threatOpenerRef.current = e.currentTarget; setShowThreatModal(true); }}>
            <AlertTriangle className="w-3.5 h-3.5" /> Add threat
          </Button>
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Tracked threats <span className="ml-1 tabular-nums text-foreground/60">{brandThreats.length}</span>
          </h4>
          {brandThreats.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No threats tracked.</p>
          ) : (
            <div className="divide-y divide-border/60 border-y border-border/60">
              {brandThreats.map((threat: any) => (
                <div key={threat.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-[12px] font-medium">{threat.domain}</p>
                    <div className="mt-1 flex gap-1.5">
                      <Badge variant={threat.severity === 'high' ? 'destructive' : threat.severity === 'medium' ? 'default' : 'secondary'}>
                        {threat.threat_type}
                      </Badge>
                      <Badge variant="outline">{threat.severity}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="sm" className="px-2" title="Mark as safe" aria-label={`Mark ${threat.domain} as safe`} onClick={() => markAsSafe(selectedBrand.id, threat.domain)}>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    </Button>
                    <Button variant="ghost" size="sm" className="px-2" title="Submit takedown" aria-label={`Submit takedown for ${threat.domain}`} onClick={() => {
                      setTakedownForm({ ...takedownForm, domain: threat.domain });
                      setShowTakedownModal(true);
                    }}>
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Takedown requests <span className="ml-1 tabular-nums text-foreground/60">{brandTakedowns.length}</span>
          </h4>
          {brandTakedowns.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No takedown requests.</p>
          ) : (
            <div className="divide-y divide-border/60 border-y border-border/60">
              {brandTakedowns.map((takedown: any) => (
                <div key={takedown.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] font-medium">{takedown.domain}</p>
                      <p className="text-[11px] text-muted-foreground">{takedown.threat_type} · {takedown.provider}</p>
                    </div>
                    <Badge variant={takedown.status === 'completed' ? 'default' : takedown.status === 'in_progress' ? 'secondary' : 'outline'}>
                      {takedown.status}
                    </Badge>
                  </div>
                  {takedown.notes && <p className="mt-2 text-[11px] text-muted-foreground">{takedown.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Scan history <span className="ml-1 tabular-nums text-foreground/60">{brandHistory.length}</span>
          </h4>
          {historyState === 'loading' ? (
            <p className="text-[12px] text-muted-foreground">Loading scan history…</p>
          ) : historyState === 'error' ? (
            <p className="text-[12px] text-muted-foreground">
              Scan history couldn't be loaded.{' '}
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => selectedBrand && loadBrandHistory(selectedBrand.id)}
              >
                Retry
              </button>
            </p>
          ) : brandHistory.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No saved scans yet — run a scan or set an automatic schedule.</p>
          ) : (
            <div className="max-h-56 divide-y divide-border/60 overflow-y-auto border-y border-border/60">
              {[...brandHistory].reverse().map((scan: any) => (
                <div key={scan.id} className="flex items-center justify-between gap-3 py-2 text-[11px]">
                  <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(scan.scanned_at)}</span>
                  <span className="min-w-0 truncate tabular-nums text-foreground/80">
                    Score {scan.score}/100 · typo {scan.typosquatting} · lookalike {scan.lookalikes} · subdomain {scan.impersonation} · homograph {scan.homographs}
                    {scan.tld_count ? ` · ${scan.tld_count} TLDs` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedBrand.safe_list && selectedBrand.safe_list.length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-2 text-[13px] font-medium">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              Safe list ({selectedBrand.safe_list.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {selectedBrand.safe_list.map((domain: string, i: number) => (
                <Badge key={i} variant="outline" className="border-emerald-500/25 bg-emerald-500/10 font-mono text-emerald-300">
                  {domain}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  </Dialog>
)}

{showTakedownModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowTakedownModal(false); }}>
    <DialogContent className="max-h-[85vh] w-full max-w-md overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(takedownOpenerRef)}>
      <DialogTitle>Submit takedown request</DialogTitle>
      <div className="space-y-3">
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Domain</label>
          <Input className="mt-1 font-mono" value={takedownForm.domain} onChange={(e) => setTakedownForm({ ...takedownForm, domain: e.target.value })} placeholder="bad-domain.com" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Threat type</label>
          <select className={selectClass} value={takedownForm.threat_type} onChange={(e) => setTakedownForm({ ...takedownForm, threat_type: e.target.value })}>
            <option value="impersonation">Impersonation</option>
            <option value="typosquatting">Typosquatting</option>
            <option value="phishing">Phishing</option>
            <option value="fake_store">Fake store</option>
          </select>
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Evidence / notes</label>
          <textarea className={textareaClass} rows={3} value={takedownForm.evidence} onChange={(e) => setTakedownForm({ ...takedownForm, evidence: e.target.value })} placeholder="Describe the abuse…" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Contact email</label>
          <Input className="mt-1" value={takedownForm.contact_email} onChange={(e) => setTakedownForm({ ...takedownForm, contact_email: e.target.value })} placeholder="legal@yourbrand.com" />
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => submitTakedown(selectedBrand?.id)}>Submit request</Button>
          <Button variant="ghost" onClick={() => setShowTakedownModal(false)}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
)}

{showThreatModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowThreatModal(false); }}>
    <DialogContent className="max-h-[85vh] w-full max-w-md overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(threatOpenerRef)}>
      <DialogTitle>Add manual threat</DialogTitle>
      <div className="space-y-3">
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Domain</label>
          <Input className="mt-1 font-mono" value={threatForm.domain} onChange={(e) => setThreatForm({ ...threatForm, domain: e.target.value })} placeholder="fake-brand.com" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Threat type</label>
          <select className={selectClass} value={threatForm.threat_type} onChange={(e) => setThreatForm({ ...threatForm, threat_type: e.target.value })}>
            <option value="manual">Manual</option>
            <option value="impersonation">Impersonation</option>
            <option value="typosquatting">Typosquatting</option>
            <option value="phishing">Phishing</option>
          </select>
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Severity</label>
          <select className={selectClass} value={threatForm.severity} onChange={(e) => setThreatForm({ ...threatForm, severity: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Notes</label>
          <textarea className={textareaClass} rows={2} value={threatForm.notes} onChange={(e) => setThreatForm({ ...threatForm, notes: e.target.value })} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => addThreat(selectedBrand?.id)}>Add threat</Button>
          <Button variant="ghost" onClick={() => setShowThreatModal(false)}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
)}

{showAlertsModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowAlertsModal(false); }}>
    <DialogContent className="max-h-[80vh] w-full max-w-lg overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(alertsOpenerRef)}>
      <DialogTitle>Threat alerts ({brandAlerts.length})</DialogTitle>
      {brandAlerts.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-muted-foreground">No alerts.</p>
      ) : (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {brandAlerts.map((alert: any) => (
            <div key={alert.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${alert.severity === 'high' ? 'bg-red-400' : 'bg-amber-400'}`} aria-hidden="true" />
                  <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] font-medium">{alert.domain}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{alert.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{alert.brand_name} · {formatDateTime(alert.timestamp)}</p>
                  </div>
                </div>
                <Badge variant={alert.severity === 'high' ? 'destructive' : 'default'}>
                  {alert.severity}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </DialogContent>
  </Dialog>
)}
      <AlertDialog open={!!brandToDelete} onOpenChange={(o) => { if (!o) setBrandToDelete(null); }}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            if (brandDeleteOpenerRef.current) {
              e.preventDefault();
              brandDeleteOpenerRef.current.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove brand {brandToDelete?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              Monitoring stops and the brand's threat history is deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => { e.preventDefault(); deleteBrand(); }}
            >
              Remove brand
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
