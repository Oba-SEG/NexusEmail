"use client";

import {
  Bell, LogOut, Globe, Plug, BarChart3, Settings,
  Shield, Building2, Menu, X, AlertTriangle, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fragment, useRef, useState } from "react";

interface DashboardChromeProps {
  children: React.ReactNode;
  user: { name?: string; email?: string; organization?: { name?: string; slug?: string } | null } | null;
  logoutNotice: string | null;
  onLogout: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
  alertCount?: number;
  onOpenSearch: () => void;
  impersonation?: { name?: string; email?: string } | null;
  onStopImpersonating: () => void;
}

const MONITORING_NAV = [
  { value: "domains", label: "Domains", icon: Globe },
  { value: "brands", label: "Brand protection", icon: Shield },
  { value: "threats", label: "Threat alerts", icon: AlertTriangle },
];

const OUTPUT_NAV = [
  { value: "reports", label: "Reports", icon: BarChart3 },
];

const CONFIG_NAV = [
  { value: "integrations", label: "DNS providers", icon: Plug },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "settings", label: "Settings", icon: Settings },
];

const ADMIN_NAV = [
  { value: "admin", label: "Administration", icon: Building2 },
];

const ALL_NAV = [...MONITORING_NAV, ...OUTPUT_NAV, ...CONFIG_NAV, ...ADMIN_NAV];

/** App chrome: one rail, one identity, one context line. The workspace is
 * context in the top bar, not a second card competing with navigation. */
export default function DashboardChrome({
  children, user, logoutNotice, onLogout, activeTab, onTabChange, isAdmin, alertCount = 0, onOpenSearch,
  impersonation = null, onStopImpersonating,
}: DashboardChromeProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMobileNav = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-mobile-nav]') && toggleRef.current) {
      toggleRef.current.focus();
    }
    setMobileNavOpen(false);
  };

  const organization = user?.organization;
  const currentLabel = ALL_NAV.find((item) => item.value === activeTab)?.label || "Domains";

  const trigger = (item: typeof ALL_NAV[number], onSelect?: () => void) => {
    const Icon = item.icon;
    return (
      <TabsTrigger
        key={item.value}
        value={item.value}
        onClick={onSelect}
        aria-label={item.value === "threats" && alertCount > 0 ? `${item.label}, ${alertCount} open` : undefined}
        className="group flex h-9 w-full items-center justify-start gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.045] hover:text-foreground data-[state=active]:bg-white/[0.065] data-[state=active]:text-foreground"
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-data-[state=active]:text-primary" />
        <span className="truncate">{item.label}</span>
        {item.value === "threats" && alertCount > 0 ? (
          <span aria-hidden="true" className="ml-auto text-[11px] font-medium tabular-nums text-red-300">
            {alertCount}
          </span>
        ) : null}
      </TabsTrigger>
    );
  };

  const navSection = (items: typeof ALL_NAV, onSelect?: () => void) => (
    <TabsList className="flex h-auto w-full flex-col items-stretch gap-0.5 border-0 bg-transparent p-0">
      {items.map((item) => trigger(item, onSelect))}
    </TabsList>
  );

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="nbp-mark flex h-7 w-7 flex-shrink-0 items-center justify-center text-[11px]">N</div>
      <div className="min-w-0 leading-tight">
        <p className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">Nexus</p>
        <p className="text-[10.5px] text-muted-foreground">Email security console</p>
      </div>
    </div>
  );

  const searchButton = (
    <button
      type="button"
      onClick={onOpenSearch}
      aria-label="Search domains, brands and pages"
      className="group flex h-8 w-full items-center gap-2 rounded-md border border-border bg-white/[0.02] px-2.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-foreground lg:w-[300px]"
    >
      <Search className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">Search domains, brands, pages</span>
      <kbd className="ml-auto hidden flex-shrink-0 rounded border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
        ⌘K
      </kbd>
    </button>
  );

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border bg-white/[0.04] text-[10.5px] font-semibold text-foreground">
        {(user?.name || user?.email || "OB").slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="max-w-[140px] truncate text-[12px] font-medium text-foreground">{user?.name || user?.email}</p>
        <p className="max-w-[140px] truncate text-[10.5px] text-muted-foreground">{organization?.name || "Personal workspace"}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-8 w-8 flex-shrink-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} orientation="vertical" className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              ref={toggleRef}
              className="-ml-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-label="Toggle navigation"
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            {brand}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Search domains, brands and pages"
              title="Search (⌘K)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </div>
        {logoutNotice && (
          <div className="border-t border-border bg-amber-500/[0.06] px-4 py-2">
            <p className="text-[11px] leading-tight text-amber-300" role="alert">{logoutNotice}</p>
          </div>
        )}
        {impersonation && (
          <div className="flex items-center gap-2 border-t border-[#ff9d52]/25 bg-[#ff9d52]/10 px-4 py-2" role="status">
            <p className="min-w-0 flex-1 truncate text-[11px] text-[#ffc99f]">
              Viewing as <span className="font-semibold text-[#ffe1c7]">{user?.email}</span>
            </p>
            <button
              type="button"
              onClick={onStopImpersonating}
              className="flex-shrink-0 rounded-full border border-[#ff9d52]/40 px-2.5 py-1 text-[10.5px] font-semibold text-[#ffc99f] hover:bg-[#ff9d52]/15"
            >
              Return to admin
            </button>
          </div>
        )}
        {mobileNavOpen && (
          <div data-mobile-nav className="border-t border-border px-3 pb-4 pt-3">
            <p className="px-2.5 pb-2 text-[11px] text-muted-foreground">{organization?.name || "Personal workspace"}</p>
            {navSection(MONITORING_NAV, closeMobileNav)}
            <div className="my-3 h-px bg-border" />
            {navSection(OUTPUT_NAV, closeMobileNav)}
            <div className="my-3 h-px bg-border" />
            {navSection(CONFIG_NAV, closeMobileNav)}
            {isAdmin && (
              <>
                <div className="my-3 h-px bg-border" />
                {navSection(ADMIN_NAV, closeMobileNav)}
              </>
            )}
            <div className="mt-5 border-t border-border pt-4">{identity}</div>
          </div>
        )}
      </nav>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-border bg-[#0a0b0d] lg:flex">
        <div className="px-5 pb-5 pt-5">{brand}</div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {navSection(MONITORING_NAV)}
          <div className="my-3 h-px bg-border" />
          {navSection(OUTPUT_NAV)}
          <div className="my-3 h-px bg-border" />
          {navSection(CONFIG_NAV)}
          {isAdmin && (
            <>
              <div className="my-3 h-px bg-border" />
              {navSection(ADMIN_NAV)}
            </>
          )}
        </div>
        <div className="border-t border-border px-3 py-3">{identity}</div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[232px]">
        <div className="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b border-border bg-background/95 px-8 backdrop-blur lg:flex">
          <p className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            <span className="truncate">{organization?.name || "Personal workspace"}</span>
            <span aria-hidden="true" className="text-white/20">/</span>
            <span className="flex-shrink-0 text-foreground">{currentLabel}</span>
          </p>
          {logoutNotice && (
            <span className="max-w-[320px] truncate text-[11px] leading-tight text-amber-300" role="alert">{logoutNotice}</span>
          )}
          <div className="ml-auto">{searchButton}</div>
        </div>
        {impersonation && (
          <div className="sticky top-14 z-20 flex min-h-10 items-center gap-3 border-b border-[#ff9d52]/25 bg-[#2a1a12]/95 px-8 py-2 text-[11.5px] text-[#ffc99f] backdrop-blur" role="status">
            <p className="min-w-0 truncate">
              Viewing as <span className="font-semibold text-[#ffe1c7]">{user?.name || user?.email}</span>
              {user?.name && user?.email ? <span className="text-[#e7c4a8]"> · {user.email}</span> : null}
              {organization?.name ? <span className="text-[#c8aa95]"> · {organization.name}</span> : null}
              {impersonation.email ? <span className="text-[#a98b76]"> · signed in from {impersonation.email}</span> : null}
            </p>
            <button
              type="button"
              onClick={onStopImpersonating}
              className="ml-auto flex-shrink-0 rounded-full border border-[#ff9d52]/40 px-3 py-1 text-[10.5px] font-semibold text-[#ffc99f] hover:bg-[#ff9d52]/15"
            >
              Return to admin
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </Tabs>
  );
}
