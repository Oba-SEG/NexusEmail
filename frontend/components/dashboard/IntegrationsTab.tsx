"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, X, Zap, Plug, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Integrations tab: provider list, connection summary, configure-provider
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
  const [query, setQuery] = useState('');

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

  const totalProviders = DNS_PROVIDERS.length;
  const connected = DNS_PROVIDERS.filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
  const categories = ['Global', 'Cloud', 'Asia'] as const;

  return (
    <>
      <TabHeader
        headingRef={integrationsHeadingRef}
        headingId="integrations-heading"
        title="DNS providers"
        description="Connect your DNS host so we can auto-remediate SPF / DMARC / DKIM records for you. Every provider listed has a real, working API."
      />

      {/* Connection summary + provider search */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers"
            aria-label="Search DNS providers"
            className="h-8 w-full border-0 border-b border-border bg-transparent pl-8 text-[12.5px] focus-visible:border-primary focus-visible:ring-0"
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          <span className={connected > 0 ? 'font-medium text-emerald-300' : 'font-medium text-foreground'}>{connected}</span>
          {' '}of {totalProviders} connected
        </p>
        <p className="text-[11px] text-muted-foreground sm:ml-auto">
          {connected === 0
            ? 'Connect a provider to use its credentials for remediation reviews.'
            : 'Connected providers supply credentials for scans and remediation reviews.'}
        </p>
      </div>

      {(() => {
        const q = query.trim().toLowerCase();
        const matching = DNS_PROVIDERS.filter((p: any) =>
          !q || p.name.toLowerCase().includes(q) || String(p.summary || '').toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
        );
        if (matching.length === 0) {
          return (
            <div className="mt-6 border-y border-border px-6 py-12 text-center">
              <p className="text-[13px] font-medium">No providers match &ldquo;{query}&rdquo;</p>
              <button onClick={() => setQuery('')} className="mt-1 text-[12px] text-primary underline-offset-2 hover:underline">
                Clear search
              </button>
            </div>
          );
        }
        return categories.map((category) => {
          const providersInCategory = matching
            .filter((p: any) => p.category === category)
            .sort((a: any, b: any) => {
              const aOn = settings?.provider_credentials?.[a.name.toLowerCase()] ? 1 : 0;
              const bOn = settings?.provider_credentials?.[b.name.toLowerCase()] ? 1 : 0;
              return bOn - aOn;
            });
          if (providersInCategory.length === 0) return null;
          return (
            <section key={category} className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="section-label">{category}</h3>
                <span className="text-[11px] tabular-nums text-muted-foreground/70">{providersInCategory.length} provider{providersInCategory.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y divide-border border-y border-border">
                {providersInCategory.map((provider: any) => {
                  const isConnected = settings?.provider_credentials?.[provider.name.toLowerCase()];
                  const meta = PROVIDER_METADATA[provider.name];
                  const requiredCount = meta?.fields.filter((f: ProviderField) => f.required).length || 0;
                  return (
                    <div key={provider.name} className="flex flex-col gap-2 py-3.5 transition-colors hover:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-medium">{provider.name}</p>
                            {isConnected ? (
                              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                Connected
                              </span>
                            ) : (
                              <span className="text-[10.5px] text-muted-foreground">{requiredCount} field{requiredCount === 1 ? '' : 's'} required</span>
                            )}
                          </div>
                          <p className="truncate text-[11.5px] text-muted-foreground">{provider.summary}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:flex-shrink-0">
                        {isConnected ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => testProviderConnection(provider)}>
                              <Zap className="w-3.5 h-3.5" /> Test
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="px-2"
                              title="Reconfigure"
                              aria-label={`Reconfigure ${provider.name}`}
                              onClick={(e) => { providerOpenerRef.current = e.currentTarget; openProviderModal(provider); }}
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="px-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                              title="Disconnect"
                              aria-label={`Disconnect ${provider.name}`}
                              onClick={() => disconnectProvider(provider.name)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { providerOpenerRef.current = e.currentTarget; openProviderModal(provider); }}
                          >
                            <Plug className="w-3.5 h-3.5" /> Configure
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        });
      })()}

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
