"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { RefreshCw, Save, Send, Zap, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Shared chrome for the settings-style tabs (Integrations, Notifications,
 * Settings) so section headers, toggle rows and save/test actions stay
 * identical instead of being copy-pasted per tab. */

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
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 id={headingId} ref={headingRef} tabIndex={headingId ? -1 : undefined} className="font-display text-2xl font-bold tracking-tight mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
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
  contentClassName = "space-y-3",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <Card className="premium-surface premium-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-display tracking-tight flex items-center gap-2">
              {Icon ? <Icon className="w-4 h-4 text-emerald-400" /> : null}
              {title}
            </CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
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
}: {
  label: string;
  description: string;
  on: boolean;
  onClick: () => void;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <div>
        <p id={labelId} className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-labelledby={labelId}
        aria-pressed={on}
        disabled={disabled}
        className={`min-w-[78px] shrink-0 ${on ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 border border-emerald-500/30" : "text-muted-foreground border border-white/10 hover:bg-white/5"}`}
        onClick={onClick}
      >
        {on ? onLabel : offLabel}
      </Button>
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
      <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input
        id={inputId}
        {...props}
        className="mt-1.5 bg-background/50 border-white/10 focus-visible:border-emerald-500/40 font-mono text-sm"
      />
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
    <div className="flex gap-2">
      {onSave ? (
        <Button size="sm" onClick={onSave} disabled={disabled || saving} className="bg-emerald-600 hover:bg-emerald-500 text-white border-0">
          <Save className="w-4 h-4 mr-2" /> {saving ? savingLabel : saveLabel}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={disabled || testing || saving}
        title="Tests the saved configuration"
        className="border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5"
      >
        {testing ? (
          <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> {testingLabel || `${testLabel.replace(/^Send /, "Sending ").replace(/^Test /, "Testing ")}…`}</>
        ) : (
          <>{testIcon === "zap" ? <Zap className="w-4 h-4 mr-2" /> : <Send className="w-4 h-4 mr-2" />} {testLabel}</>
        )}
      </Button>
    </div>
  );
}
