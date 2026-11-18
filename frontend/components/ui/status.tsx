"use client";

import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Unified status surface. Replaces every window.alert in the app:
//   notify("SMTP settings saved.", "success")
//   notify("SMTP settings couldn't be saved.", "error", describeError(e))
// Mounted once via <StatusViewport />; callable from anywhere.

type Tone = "success" | "error" | "info"

interface StatusItem {
  id: number
  title: string
  detail?: string
  tone: Tone
  action?: { label: string; onClick: () => void }
}

const DURATION_MS = { success: 5000, info: 5000, error: 8000 }

const listeners = new Set<(items: StatusItem[]) => void>()
let items: StatusItem[] = []
let counter = 0

function emit() {
  const snapshot = [...items]
  listeners.forEach((listener) => listener(snapshot))
}

function dismissStatus(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export function notify(
  title: string,
  tone: Tone = "info",
  detail?: string,
  action?: { label: string; onClick: () => void },
) {
  counter += 1
  items = [...items, { id: counter, title, detail, tone, action }]
  emit()
}

// Identity change: a signed-out user's pending statuses must never reach
// the next user. Called from every session-reset path (logout, auth
// failure, fresh login).
export function clearStatusQueue() {
  items = []
  emit()
}

// DNS and network failure strings arrive from the backend or the browser
// as raw error codes. Operators should never read them unexplained.
const DNS_HINTS: Array<[RegExp, string]> = [
  [/ENOTFOUND/i, "DNS lookup found no record. If you just added it, DNS may still be propagating — check again in a few minutes."],
  [/EAI_AGAIN/i, "The DNS resolver is temporarily unavailable. Try again in a moment."],
  [/ETIMEDOUT|ESOCKETTIMEDOUT/i, "The DNS lookup timed out. The resolver may be slow or unreachable — try again shortly."],
  [/queryTxt|resolveMx|resolveTxt/i, "The DNS lookup could not be completed."],
  [/ENODATA/i, "The record exists but contains no data for this lookup type."],
  [/ECONNREFUSED/i, "The connection was refused. The service may be down or firewalled."],
]

export function describeApiError(raw?: string | null): string {
  if (!raw) return "The request failed. Try again in a moment."
  for (const [pattern, copy] of DNS_HINTS) {
    if (pattern.test(raw)) return copy
  }
  const http = raw.match(/HTTP (\d{3})/)
  if (http) {
    const code = Number(http[1])
    if (code === 401) return "Your session expired. Sign in again to continue."
    if (code === 403) return "This account doesn't have permission for that action."
    if (code === 404) return "That record no longer exists — refresh and try again."
    if (code === 429) return "Too many requests. Wait a moment and try again."
    if (code >= 500) return "The server hit an unexpected error. Try again in a moment."
    return "The request was rejected. Check the values and try again."
  }
  return raw
}

export function describeError(e: unknown, fallback: string): string {
  if (e instanceof TypeError) return "Couldn't reach the Nexus Brand Protection server. Check your connection and try again."
  if (e instanceof Error && e.message) {
    if (DNS_HINTS.some(([pattern]) => pattern.test(e.message))) return describeApiError(e.message)
    return `${fallback} (${e.message})`
  }
  return fallback
}

const toneStyles: Record<Tone, { icon: React.ReactNode; iconClass: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4 shrink-0" />, iconClass: "text-emerald-400" },
  error: { icon: <AlertTriangle className="h-4 w-4 shrink-0" />, iconClass: "text-red-400" },
  info: { icon: <Info className="h-4 w-4 shrink-0" />, iconClass: "text-primary" },
}

function StatusCard({ item }: { item: StatusItem }) {
  const { icon, iconClass } = toneStyles[item.tone]
  return (
    <ToastPrimitive.Root
      open
      duration={DURATION_MS[item.tone]}
      role="status"
      onOpenChange={(open) => { if (!open) dismissStatus(item.id) }}
      className={cn(
        "group pointer-events-auto relative flex items-start gap-3 rounded-lg border p-4 shadow-lg",
        "bg-popover text-popover-foreground border-border",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-right-full duration-200 ease-out-quart"
      )}
    >
      <span className={iconClass} aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <ToastPrimitive.Title className="text-sm font-medium leading-snug">
          {item.title}
        </ToastPrimitive.Title>
        {item.detail && (
          <ToastPrimitive.Description className="mt-1 text-sm leading-snug text-muted-foreground">
            {item.detail}
          </ToastPrimitive.Description>
        )}
      </div>
      {item.action && (
        <button
          onClick={() => { item.action!.onClick(); dismissStatus(item.id) }}
          className="rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
        >
          {item.action.label}
        </button>
      )}
      <ToastPrimitive.Close
        aria-label="Dismiss"
        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}

export function StatusViewport() {
  const [current, setCurrent] = React.useState<StatusItem[]>([])
  React.useEffect(() => {
    listeners.add(setCurrent)
    // An item queued before the viewport mounted (e.g. a failed login
    // fetch resolving during hydration) must still surface.
    if (items.length) setCurrent([...items])
    return () => { listeners.delete(setCurrent) }
  }, [])
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {current.map((item) => <StatusCard key={item.id} item={item} />)}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  )
}
