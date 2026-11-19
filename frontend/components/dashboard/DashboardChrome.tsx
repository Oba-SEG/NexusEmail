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
}

// Grouped so the sidebar still reads as four short sections when the
// product grows past the single flat list.
const NAV_GROUPS = [
  {
    label: "Monitoring",
    items: [
      { value: "domains", label: "Domains", icon: Globe },
      { value: "brands", label: "Brand protection", icon: Shield },
      { value: "threats", label: "Threat alerts", icon: AlertTriangle },
    ],
  },
  {
    label: "Output",
    items: [
      { value: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Configure",
    items: [
      { value: "integrations", label: "DNS providers", icon: Plug },
      { value: "notifications", label: "Notifications", icon: Bell },
      { value: "settings", label: "Settings", icon: Settings },
    ],
  },
];

/** App chrome: fixed left sidebar on desktop, collapsible top nav on mobile.
 * One Tabs root; two TabsLists drive the same value. */
export default function DashboardChrome({
  children, user, logoutNotice, onLogout, activeTab, onTabChange, isAdmin, alertCount = 0, onOpenSearch,
}: DashboardChromeProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Close on selection, pointer or keyboard. If the keyboard focused a
  // trigger inside the mobile strip, it is about to unmount, so move
  // focus back to the toggle button first (never drop focus to body).
  const closeMobileNav = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-mobile-nav]') && toggleRef.current) {
      toggleRef.current.focus();
    }
    setMobileNavOpen(false);
  };

  const groups = isAdmin
    ? [...NAV_GROUPS, { label: "Account", items: [{ value: "admin", label: "Administration", icon: Building2 }] }]
    : NAV_GROUPS;

  const organization = user?.organization;

  const workspace = (
    <div className="min-w-0 rounded-lg border border-border bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
        Workspace
      </p>
      <p
        className="mt-1 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-foreground"
        title={organization?.name ? `Workspace: ${organization.name}` : undefined}
      >
        <Building2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="break-words">{organization?.name || "Personal workspace"}</span>
      </p>
      {organization?.slug && (
        <p className="mt-0.5 pl-5 truncate text-[11px] text-muted-foreground">{organization.slug}</p>
      )}
    </div>
  );

  const trigger = (item: typeof NAV_GROUPS[number]["items"][number], compact: boolean, onSelect?: () => void) => {
    const Icon = item.icon;
    return (
      <TabsTrigger
        key={item.value}
        value={item.value}
        onClick={onSelect}
        aria-label={item.value === "threats" && alertCount > 0 ? `${item.label}, ${alertCount} open` : undefined}
        className={
          compact
            ? "group flex h-10 w-full items-center justify-start gap-2.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground"
            : "group flex h-9 w-full items-center justify-start gap-2.5 rounded-md border-0 px-3 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground"
        }
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-data-[state=active]:text-primary" />
        <span className="truncate">{item.label}</span>
        {item.value === "threats" && alertCount > 0 ? (
          <span aria-hidden="true" className="ml-auto rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-red-300">
            {alertCount}
          </span>
        ) : (
          <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 rounded-full bg-primary opacity-0 transition-opacity group-data-[state=active]:opacity-100" />
        )}
      </TabsTrigger>
    );
  };

  const triggers = (compact: boolean, onSelect?: () => void) => groups.map((group) => (
    <Fragment key={group.label}>
      <p className="px-3 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
        {group.label}
      </p>
      {group.items.map((item) => trigger(item, compact, onSelect))}
    </Fragment>
  ));

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="nbp-mark flex h-8 w-8 flex-shrink-0 items-center justify-center text-[11px]">N</div>
      <div className="min-w-0 leading-tight">
        <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">Nexus</p>
        <p className="text-[11px] text-muted-foreground">Brand protection</p>
      </div>
    </div>
  );

  const searchButton = (
    <button
      type="button"
      onClick={onOpenSearch}
      aria-label="Search domains, brands and pages"
      className="group flex h-9 w-full items-center gap-2.5 rounded-md border border-border bg-white/[0.02] px-3 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-foreground lg:w-[280px]"
    >
      <Search className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">Search domains, brands, pages</span>
      <kbd className="ml-auto hidden flex-shrink-0 rounded border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
        ⌘K
      </kbd>
    </button>
  );

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5 text-right leading-tight">
      <div className="hidden min-w-0 text-right sm:block">
        <p className="max-w-[180px] truncate text-[12px] font-medium text-foreground">{user?.name || user?.email}</p>
        <p className="max-w-[180px] truncate text-[11px] text-muted-foreground xl:block hidden">{user?.email}</p>
      </div>
      <div className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border bg-white/[0.04] text-[11px] font-semibold text-foreground sm:flex">
        {(user?.name || user?.email || "OB").slice(0, 2).toUpperCase()}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} orientation="vertical" className="min-h-screen">
      {/* Mobile top bar */}
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
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              <Search className="h-4 w-4" />
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {logoutNotice && (
          <div className="border-t border-border bg-amber-500/[0.06] px-4 py-2">
            <p className="text-[11px] leading-tight text-amber-400" role="alert">{logoutNotice}</p>
          </div>
        )}
        {mobileNavOpen && (
          <div data-mobile-nav className="border-t border-border px-3 pb-4 pt-2">
            {workspace}
            <TabsList className="mt-1 flex h-auto w-full flex-col items-stretch gap-0.5 border-0 bg-transparent p-0">
              {triggers(true, closeMobileNav)}
            </TabsList>
          </div>
        )}
      </nav>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-border bg-[#0a0a0c] lg:flex">
        <div className="px-5 pb-4 pt-5">{brand}</div>
        <div className="px-3">{workspace}</div>
        <div className="mt-2 flex-1 overflow-y-auto px-3 pb-4">
          <TabsList className="flex h-auto w-full flex-col items-stretch gap-0.5 border-0 bg-transparent p-0">
            {triggers(false)}
          </TabsList>
        </div>
        <div className="border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground">Nexus · Email security console</p>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-h-screen flex-col lg:pl-[252px]">
        <div className="sticky top-0 z-30 hidden h-[60px] items-center gap-4 border-b border-border bg-background/95 px-8 backdrop-blur lg:flex">
          {searchButton}
          {logoutNotice && (
            <span className="max-w-[280px] text-[11px] leading-tight text-amber-400" role="alert">{logoutNotice}</span>
          )}
          <div className="ml-auto">{identity}</div>
        </div>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
          {children}
        </main>
      </div>
    </Tabs>
  );
}
