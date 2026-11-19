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
  user: { name?: string; email?: string } | null;
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
              ? "group w-full justify-start gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.03] hover:text-foreground data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground"
              : "group h-9 w-full justify-start gap-2.5 rounded-md border-0 px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.03] hover:text-foreground data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground"
          }
        >
          <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground transition-colors group-data-[state=active]:text-primary" />
          {item.label}
          {item.value === "threats" && alertCount > 0 && (
            <>
              <span aria-hidden="true" className="ml-auto rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-red-300">
                {alertCount}
              </span>
            </>
          )}
        </TabsTrigger>
      );
  };

  const triggers = (compact: boolean, onSelect?: () => void) => groups.map((group) => (
    <Fragment key={group.label}>
      <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
        {group.label}
      </p>
      {group.items.map((item) => trigger(item, compact, onSelect))}
    </Fragment>
  ));

  const brand = (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="nbp-mark w-8 h-8 text-[11px] flex-shrink-0">N</div>
      <div className="leading-tight min-w-0">
        <h1 className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">Nexus</h1>
        <p className="text-[11px] text-muted-foreground">Brand protection</p>
      </div>
    </div>
  );

  const userCluster = (
    <div className="flex items-center gap-3">
      <button
        onClick={onOpenSearch}
        aria-label="Search domains, brands and pages"
        title="Search (⌘K)"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
      >
        <Search className="w-4 h-4" />
      </button>
      {logoutNotice && (
        <span className="text-[11px] text-amber-400 max-w-[220px] leading-tight" role="alert">{logoutNotice}</span>
      )}
      {user?.email && (
        <div className="hidden sm:block text-right leading-tight">
          <p className="text-[12px] font-medium text-foreground truncate max-w-[180px]">{user.name || user.email}</p>
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{user.email}</p>
        </div>
      )}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border bg-white/[0.04] text-[11px] font-semibold text-foreground">
        {(user?.name || user?.email || 'OB').slice(0, 2).toUpperCase()}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} orientation="vertical" className="min-h-screen">
      {/* Mobile top bar */}
      <nav className="lg:hidden sticky top-0 z-40 border-b border-border bg-background">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <button
            ref={toggleRef}
            className="p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          {brand}
          {userCluster}
        </div>
        {mobileNavOpen && (
          <div data-mobile-nav className="px-3 pb-3">
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-0.5 border-0 bg-transparent p-0">
              {triggers(true, closeMobileNav)}
            </TabsList>
          </div>
        )}
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-border bg-[#0b0b0d]">
        <div className="px-4 py-4">{brand}</div>
        <TabsList className="flex h-auto w-full flex-col items-stretch gap-0.5 border-0 bg-transparent p-2 pt-0">
          {triggers(false)}
        </TabsList>
      </aside>

      {/* Content */}
      <div className="lg:pl-60 min-h-screen flex flex-col">
        <div className="hidden lg:flex h-14 items-center justify-end gap-3 border-b border-border px-6 sticky top-0 z-30 bg-background/95 backdrop-blur-sm">
          {userCluster}
        </div>
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </Tabs>
  );
}
