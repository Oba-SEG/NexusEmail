"use client";

import { Key, CheckCircle, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { providerBrand, PROVIDER_METADATA, type ProviderField } from "@/lib/providers";

interface ProviderModalProps {
  selectedProvider: any;
  providerCreds: Record<string, string>;
  onCredsChange: (creds: Record<string, string>) => void;
  savingProvider: boolean;
  onSave: () => void;
  onClose: () => void;
}

/** Configure-provider modal. Presentational: all state and persistence live
 * in the Integrations tab; this component renders the provider's field
 * stack, docs deep-link and actions. */
export default function ProviderModal({
  selectedProvider,
  providerCreds,
  onCredsChange,
  savingProvider,
  onSave,
  onClose,
}: ProviderModalProps) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="premium-surface rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-0 gap-0">
      {/* Hero — provider brand strip */}
      {(() => {
        const brand = providerBrand(selectedProvider.name);
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
                <DialogTitle className="font-display text-xl font-bold tracking-tight">{selectedProvider.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1 leading-relaxed">{meta?.summary}</DialogDescription>
              </div>
              <span aria-hidden="true" className="w-8 h-8" />
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
                <label htmlFor={`provider-field-${field.key}`} className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  {field.label}
                  {field.required && <span className="ml-1.5 text-orange-400 normal-case" title="Required">*</span>}
                </label>
                {!field.required && <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Optional</span>}
              </div>
              <Input
                id={`provider-field-${field.key}`}
                type={field.type}
                value={providerCreds[field.key] || ''}
                onChange={(e) => onCredsChange({...providerCreds, [field.key]: e.target.value})}
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
            onClick={onSave}
            disabled={
              savingProvider ||
              !!(PROVIDER_METADATA[selectedProvider.name]?.fields || [])
                .filter((f: ProviderField) => f.required)
                .find((f: ProviderField) => !providerCreds[f.key]?.trim())
            }
          >
            {savingProvider ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <><CheckCircle className="w-4 h-4 mr-2" /> Save credentials</>}
          </Button>
          <Button variant="outline" className="border-white/10 hover:border-orange-500/40 hover:bg-orange-500/5" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
