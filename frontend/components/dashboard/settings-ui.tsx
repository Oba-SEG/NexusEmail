"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { RefreshCw, Save, Send, Zap, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Shared chrome for the settings-style tabs (Integrations, Notifications,
 * Settings) so page headers, section headers, toggle rows and save/test
 * actions stay identical instead of being copy-pasted per tab. */

export function TabHeader({
  title,
  description,
  headingRef,
  headingId,
  action,
}: {
  title: string;
  description: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  headingId?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id={headingId} ref={headingRef} tabIndex={headingId ? -1 : undefined} className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="mt-1 max-w-[65ch] text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  actions,
  children,
  contentClassName = "space-y-4",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em]">
            {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className={cn("px-5 py-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function ToggleRow({
  label,
  description,
  on,
  onClick,
  onLabel = "Enabled",
  offLabel = "Disabled",
  disabled = false,
  pending = false,
  className,
}: {
  label: string;
  description: string;
  on: boolean;
  onClick: () => void;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div className={cn("flex items-center justify-between gap-4 py-3", className)}>
      <div className="min-w-0">
        <p id={labelId} className="text-[13px] font-medium">{label}</p>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <span className="flex shrink-0 items-center gap-3">
        <span role="status" aria-live="polite" className="min-w-[4.5rem] text-right text-[12px] font-medium text-muted-foreground">
          {pending ? 'Saving…' : on ? onLabel : offLabel}
        </span>
        <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-busy={pending}
        aria-disabled={disabled || pending}
        disabled={disabled}
        onClick={() => { if (!pending) onClick(); }}
        className={cn(
          "pressable relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          on
            ? "border-primary/60 bg-primary/70"
            : "border-input bg-white/[0.06] hover:bg-white/[0.09]"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full shadow-sm transition-transform duration-150 ease-out-quart",
            on ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-white/70",
            pending && "animate-pulse"
          )}
        />
        <span className="sr-only">{on ? onLabel : offLabel}</span>
        </button>
      </span>
    </div>
  );
}

export function FormField({
  label,
  className,
  id,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const inputId = id || generatedId;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <Input id={inputId} {...props} className="mt-1.5" />
    </div>
  );
}

export function SaveTestActions({
  onSave,
  saving,
  saveLabel,
  savingLabel = "Saving…",
  onTest,
  testing,
  testLabel,
  testingLabel,
  testIcon = "send",
  disabled = false,
}: {
  onSave?: () => void;
  saving?: boolean;
  saveLabel: string;
  savingLabel?: string;
  onTest: () => void;
  testing: boolean;
  testLabel: string;
  testingLabel?: string;
  testIcon?: "send" | "zap";
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {onSave ? (
        <Button size="sm" onClick={onSave} disabled={disabled || saving} aria-busy={saving}>
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? savingLabel : saveLabel}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={disabled || testing || saving}
        title="Tests the saved configuration"
      >
        {testing ? (
          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {testingLabel || `${testLabel.replace(/^Send /, "Sending ").replace(/^Test /, "Testing ")}…`}</>
        ) : (
          <>{testIcon === "zap" ? <Zap className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />} {testLabel}</>
        )}
      </Button>
    </div>
  );
}
