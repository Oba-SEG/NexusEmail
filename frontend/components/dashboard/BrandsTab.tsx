"use client";

import { useEffect, useRef, useState } from "react";
import {
  Shield, Search, AlertTriangle, CheckCircle, XCircle, Plus, RefreshCw,
  Zap, Eye, ChevronRight, Bell, Trash2, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { notify, describeApiError } from "@/components/ui/status";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, dialogFocusReturn,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface BrandsTabProps {
  brands: any[];
  domains: any[];
  loadBrands: (gen?: number) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  sessionGenRef: { current: number };
  onGoToDomains: () => void;
  onAuthFailure: () => void;
}

/** Brand Protection tab: monitored brand list, add-brand scan flow and
 * the brand-details / takedown / threat / alerts overlays. State is
 * owned here so it resets with the tab (identity change included). */
export default function BrandsTab({
  brands, domains, loadBrands, apiFetch, sessionGenRef, onGoToDomains, onAuthFailure,
}: BrandsTabProps) {
  const brandDetailsRef = useRef<number | null>(null);
  const brandDetailsGenRef = useRef(0);
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
    try {
      const res = await apiFetch(`${API_BASE}/brands/alerts`);
      if (gen !== sessionGenRef.current) return;
      if (seq !== alertsLoadSeqRef.current) return;
      if (res.status === 401) {
        onAuthFailure();
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
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/threats`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) {
        onAuthFailure();
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
        onAuthFailure();
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
    try {
      const res = await apiFetch(`${API_BASE}/brands/${brandId}/history`);
      if (gen !== sessionGenRef.current) return;
      if (res.status === 401) { onAuthFailure(); return; }
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

  return (
    <>
<div>
  <h2 className="font-display text-2xl font-bold tracking-tight mb-1">Watch for impersonation</h2>
  <p className="text-sm text-muted-foreground">Detect typosquats, look-alikes, and brand abuse on domains you own.</p>
</div>

<Card className="premium-surface premium-card">
  <CardHeader className="flex flex-row items-center justify-between gap-3">
    <div>
      <CardTitle className="font-display tracking-tight flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-400" /> Monitored brands
      </CardTitle>
      <CardDescription>Each brand is tied to a verified domain you own.</CardDescription>
    </div>
    <div className="flex gap-2 flex-shrink-0">
      {brandAlerts.length > 0 && (
        <Button variant="outline" size="sm" className="border-red-500/30 bg-red-500/5 text-red-300 hover:bg-red-500/10 hover:border-red-500/50" onClick={(e) => { alertsOpenerRef.current = e.currentTarget; setShowAlertsModal(true); }}>
          <Bell className="w-4 h-4 mr-1.5" /> Alerts
          <span className="ml-2 px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[11px] font-bold leading-none">{brandAlerts.length}</span>
        </Button>
      )}
      <Button variant="outline" size="sm" className="border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5" onClick={bulkScanAll} disabled={bulkScanning || brandScanning}>
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
            <div>
              <label htmlFor="new-brand-schedule" className="text-sm text-muted-foreground">Automatic scans</label>
              <select
                id="new-brand-schedule"
                value={newBrandSchedule}
                onChange={(e) => setNewBrandSchedule(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="manual">Manual only</option>
              </select>
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
                <Save className="w-4 h-4 mr-1" /> Save
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
              <Shield className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="font-medium">{brand.domain}</p>
                <p className="text-sm text-muted-foreground">
                  {brand.brand_name}
                  {(brand.threats?.length || 0) > 0 && (
                    <span className="ml-2 text-amber-400">{brand.threats.length} threat{brand.threats.length === 1 ? '' : 's'} tracked</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {brand.last_scan ? `Last scan ${new Date(brand.last_scan).toLocaleString()}` : 'Never scanned'}
                  {brand.next_scan ? ` · Next ${new Date(brand.next_scan).toLocaleString()}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={`brand-schedule-${brand.id}`} className="sr-only">Scan schedule for {brand.domain}</label>
              <select
                id={`brand-schedule-${brand.id}`}
                value={brand.scan_schedule || 'manual'}
                onChange={(e) => updateBrandSchedule(brand.id, e.target.value)}
                disabled={savingSchedules.has(brand.id)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
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
                <Search className="w-4 h-4 mr-1" /> Scan
              </Button>
              <Button variant="outline" size="sm" onClick={(e) => { brandDetailsOpenerRef.current = e.currentTarget; openBrandDetails(brand); }}>
                <Eye className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Delete brand ${brand.domain}`} onClick={(e) => { brandDeleteOpenerRef.current = e.currentTarget; setBrandToDelete(brand); }}>
                <Trash2 className="w-4 h-4 text-rose-500" />
              </Button>
            </div>
          </div>
        ))}
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
      <div className="mt-4 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Scanning brand surface…</span>
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

{/* Brand Details Modal */}
{selectedBrand && (
  <Dialog open onOpenChange={(o) => { if (!o) setSelectedBrand(null); }}>
    <DialogContent className="bg-background rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(brandDetailsOpenerRef)}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <DialogTitle className="text-lg font-bold">{selectedBrand.domain}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{selectedBrand.brand_name}</DialogDescription>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex gap-2">
          <Button size="sm" onClick={(e) => { takedownOpenerRef.current = e.currentTarget; setShowTakedownModal(true); }}>
            <Zap className="w-4 h-4 mr-1" /> Submit Takedown
          </Button>
          <Button variant="outline" size="sm" onClick={(e) => { threatOpenerRef.current = e.currentTarget; setShowThreatModal(true); }}>
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
            <Zap className="w-4 h-4 text-emerald-400" />
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

        <div>
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <Search className="w-4 h-4 text-emerald-400" />
            Scan History ({brandHistory.length})
          </h4>
          {historyState === 'loading' ? (
            <p className="text-sm text-muted-foreground">Loading scan history…</p>
          ) : historyState === 'error' ? (
            <p className="text-sm text-muted-foreground">
              Scan history couldn't be loaded.{' '}
              <button
                type="button"
                className="underline text-emerald-400"
                onClick={() => selectedBrand && loadBrandHistory(selectedBrand.id)}
              >
                Retry
              </button>
            </p>
          ) : brandHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved scans yet — run a scan or set an automatic schedule.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {[...brandHistory].reverse().map((scan: any) => (
                <div key={scan.id} className="flex items-center justify-between p-2 border rounded-lg bg-muted/30 text-xs">
                  <span className="text-muted-foreground">{new Date(scan.scanned_at).toLocaleString()}</span>
                  <span className="tabular-nums">
                    Score {scan.score}/100 · typo {scan.typosquatting} · lookalike {scan.lookalikes} · subdomain {scan.impersonation} · homograph {scan.homographs}
                  </span>
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
    </DialogContent>
  </Dialog>
)}

{showTakedownModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowTakedownModal(false); }}>
    <DialogContent className="bg-background rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(takedownOpenerRef)}>
      <DialogTitle className="text-lg font-bold mb-4">Submit Takedown Request</DialogTitle>
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
    </DialogContent>
  </Dialog>
)}

{showThreatModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowThreatModal(false); }}>
    <DialogContent className="bg-background rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(threatOpenerRef)}>
      <DialogTitle className="text-lg font-bold mb-4">Add Manual Threat</DialogTitle>
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
    </DialogContent>
  </Dialog>
)}

{showAlertsModal && (
  <Dialog open onOpenChange={(o) => { if (!o) setShowAlertsModal(false); }}>
    <DialogContent className="bg-background rounded-lg w-full max-w-lg max-h-[80vh] overflow-y-auto" onCloseAutoFocus={dialogFocusReturn(alertsOpenerRef)}>
      <div className="flex items-center justify-between mb-4">
        <DialogTitle className="text-lg font-bold">Threat Alerts ({brandAlerts.length})</DialogTitle>
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
