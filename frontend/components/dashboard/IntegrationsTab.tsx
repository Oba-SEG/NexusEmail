"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, X, Zap, Plug, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ProviderModal from "@/components/dashboard/ProviderModal";
import { dialogFocusReturn } from "@/components/ui/dialog";
import { DNS_PROVIDERS, PROVIDER_METADATA, type ProviderField } from "@/lib/providers";
import { notify, describeError, describeApiError } from "@/components/ui/status";
import { TabHeader } from "@/components/dashboard/settings-ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface IntegrationsTabProps {
  settings: any;
  loadSettings: () => void;
  sessionGenRef: { current: number };
  apiFetch: (url: string, options?: any) => Promise<Response>;
  focusHeadingOnMount?: boolean;
  onFocusConsumed?: () => void;
}

/** Integrations tab: provider grid, connection summary, configure-provider
 * modal and all provider-credential state. The whole tab unmounts on tab
 * switch and identity change, which is the state reset (no secrets or
 * busy flags survive). */
export default function IntegrationsTab({ settings, loadSettings, sessionGenRef, apiFetch, focusHeadingOnMount, onFocusConsumed }: IntegrationsTabProps) {
  const [showProviderModal, setShowProviderModal] = useState(false);
  const providerOpenerRef = useRef<HTMLButtonElement | null>(null);
  // a save flips Configure -> Reconfigure (the opener unmounts), so the
  // dialog's focus return needs a stable fallback
  const integrationsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [providerCreds, setProviderCreds] = useState<any>({});
  const [savingProvider, setSavingProvider] = useState(false);

  // Consume the Settings shortcut's one-time focus request on mount.
  useEffect(() => {
    if (!focusHeadingOnMount) return;
    integrationsHeadingRef.current?.focus();
    onFocusConsumed?.();
  }, [focusHeadingOnMount, onFocusConsumed]);

const openProviderModal = (provider: any) => {
  setSelectedProvider(provider);
  const creds = settings?.provider_credentials?.[provider.name.toLowerCase()] || {};
  setProviderCreds(creds);
  setShowProviderModal(true);
};

const saveProviderCredentials = async () => {
  if (!selectedProvider) return;
  const gen = sessionGenRef.current;
  setSavingProvider(true);
  try {
    const res = await apiFetch(`${API_BASE}/settings/providers/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: selectedProvider.name,
        credentials: providerCreds
      })
    });
    if (gen === sessionGenRef.current) {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notify('Credentials couldn\'t be saved.', 'error', describeApiError(data.error || `HTTP ${res.status}`));
        return;
      }
      notify(`${selectedProvider.name} connected.`, 'success');
      setShowProviderModal(false);
      loadSettings();
    }
  } catch (e) {
    if (gen === sessionGenRef.current) notify('Credentials couldn\'t be saved.', 'error', describeError(e, 'The request failed.'));
  } finally {
    if (gen === sessionGenRef.current) setSavingProvider(false);
  }
};

const disconnectProvider = async (providerName: string) => {
  // Session generation is captured before the request and re-checked after:
  // follow-up work (toast + settings reload) belongs to the identity that
  // started it, never to a session signed in later.
  const gen = sessionGenRef.current;
  try {
    const res = await apiFetch(`${API_BASE}/settings/providers/credentials/${providerName}`, {
      method: 'DELETE'
    });
    if (gen !== sessionGenRef.current) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify('Couldn\'t disconnect the provider.', 'error', describeApiError(data.error || `HTTP ${res.status}`));
      return;
    }
    notify(`${providerName} disconnected.`, 'success');
    loadSettings();
  } catch (e) {
    if (gen === sessionGenRef.current) notify('Couldn\'t disconnect the provider.', 'error', describeError(e, 'The request failed.'));
  }
};

const testProviderConnection = async (provider: any) => {
  const creds = settings?.provider_credentials?.[provider.name.toLowerCase()];
  if (!creds) {
    notify('Configure credentials first.', 'info');
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
      notify(`${provider.name} connection successful.`, 'success', `Responded in ${data.latency}ms.`);
    } else {
      notify(`${provider.name} connection failed.`, 'error', describeApiError(data.error));
    }
  } catch (e) {
    notify('Connection test failed.', 'error', describeError(e, 'The test could not be run.'));
  }
};

  return (
    <>
            <TabHeader
              headingRef={integrationsHeadingRef}
              headingId="integrations-heading"
              title="DNS providers"
              description="Connect your DNS host so we can auto-remediate SPF / DMARC / DKIM records for you. Every provider listed has a real, working API."
            />

            {/* T164 — Connection summary strip: how much of the integration surface is configured */}
            {(() => {
              const totalProviders = DNS_PROVIDERS.length;
              const connected = DNS_PROVIDERS.filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
              const byCat = (cat: string) => DNS_PROVIDERS.filter((p: any) => p.category === cat);
              const connectedIn = (cat: string) => byCat(cat).filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
              return (
                <div className="premium-surface premium-card rounded-xl p-5">
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
                          <p className="uppercase tracking-widest text-muted-foreground font-semibold text-[11px]">{cat}</p>
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
              const providersInCategory = DNS_PROVIDERS.filter((p: any) => p.category === category);
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

                      return (
                        <Card key={provider.name} className={`premium-surface premium-card rounded-xl ${isConnected ? '!border-emerald-500/40' : ''}`}>
                          <CardContent className="p-5">
                            <div className="flex items-start justify-between mb-3 gap-3">
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                {/* one signal color rule: monograms stay
                                    monochrome, emerald only marks Connected */}
                                <div
                                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-bold text-[13px] bg-muted/50 border border-border text-muted-foreground"
                                  style={{ letterSpacing: '-0.02em' }}
                                >
                                  {provider.name.slice(0, 2).toUpperCase()}
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
                                  className="text-[11px] h-8 px-2 border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5"
                                  onClick={(e) => { providerOpenerRef.current = e.currentTarget; openProviderModal(provider); }}
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
                                className="w-full text-[11px] h-8 border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5"
                                onClick={(e) => { providerOpenerRef.current = e.currentTarget; openProviderModal(provider); }}
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
    {showProviderModal && selectedProvider && (
      <ProviderModal
        selectedProvider={selectedProvider}
        providerCreds={providerCreds}
        onCredsChange={setProviderCreds}
        savingProvider={savingProvider}
        onSave={saveProviderCredentials}
        onClose={() => setShowProviderModal(false)}
        openerRef={providerOpenerRef}
        fallbackRef={integrationsHeadingRef}
      />
    )}
    </>
  );
}
