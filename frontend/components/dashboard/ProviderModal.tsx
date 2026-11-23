"use client";

import { Key, CheckCircle, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, dialogFocusReturn,
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
  openerRef?: React.RefObject<HTMLButtonElement | null>;
  fallbackRef?: React.RefObject<HTMLElement | null>;
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
  openerRef,
  fallbackRef,
}: ProviderModalProps) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto p-0 gap-0"
        onCloseAutoFocus={openerRef ? dialogFocusReturn(openerRef, fallbackRef) : undefined}
      >
      {/* Hero — provider brand strip */}
      {(() => {
        const brand = providerBrand(selectedProvider.name);
        const meta = PROVIDER_METADATA[selectedProvider.name];
        return (
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-start gap-4">
              <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border text-[13px] font-semibold"
                style={{ background: brand.bg, color: brand.text, letterSpacing: '-0.02em' }}
              >
                {brand.mono}
              </div>
              <div className="flex-1 min-w-0">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Connect provider · {meta?.category}</p>
                <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{selectedProvider.name}</DialogTitle>
                <DialogDescription className="mt-1 text-[12px] leading-relaxed">{meta?.summary}</DialogDescription>
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
                <label htmlFor={`provider-field-${field.key}`} className="text-[12px] font-medium text-foreground">
                  {field.label}
                  {field.required && <span className="ml-1.5 text-primary" title="Required">*</span>}
                </label>
                {!field.required && <span className="text-[11px] text-muted-foreground">Optional</span>}
              </div>
              <Input
                id={`provider-field-${field.key}`}
                type={field.type}
                value={providerCreds[field.key] || ''}
                onChange={(e) => onCredsChange({...providerCreds, [field.key]: e.target.value})}
                placeholder={field.placeholder}
                className="font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{field.description}</p>
            </div>
          ))}
        </div>

        {/* Docs deep-link + security note */}
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-white/[0.02] p-3.5">
          <Key className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <div className="flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
            <p className="mb-1">
              <a
                href={PROVIDER_METADATA[selectedProvider.name]?.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Open {selectedProvider.name} API settings ↗
              </a>
            </p>
            <p>Credentials are encrypted at rest and stay inside this workspace. We never log or show them again after you save.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-2">
          <Button
            className="flex-1"
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
