"use client";

import {
  Bell, LogOut, Globe, Plug, BarChart3, Settings,
  Shield, Building2, Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";

interface DashboardChromeProps {
  children: React.ReactNode;
  user: { name?: string; email?: string } | null;
  logoutNotice: string | null;
  onLogout: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
}

const NAV = [
  { value: "domains", label: "Domains", icon: Globe },
  { value: "brands", label: "Brand Protection", icon: Shield },
  { value: "reports", label: "Reports", icon: BarChart3 },
  { value: "integrations", label: "Integrations", icon: Plug },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "settings", label: "Settings", icon: Settings },
];

/** App chrome: fixed left sidebar console on desktop, collapsible top
 * nav on mobile. One Tabs root; two TabsLists drive the same value. */
export default function DashboardChrome({
  children, user, logoutNotice, onLogout, activeTab, onTabChange, isAdmin,
}: DashboardChromeProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [activeTab]);

  const items = [...NAV];
  if (isAdmin) items.push({ value: "admin", label: "Admin", icon: Building2 });

  const triggers = (compact: boolean) =>
    items.map((item) => {
      const Icon = item.icon;
      return (
        <TabsTrigger
          key={item.value}
          value={item.value}
          className={
            compact
              ? "gap-2 px-3 py-2 text-sm data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground whitespace-nowrap"
              : "group relative w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:bg-white/[0.05] data-[state=active]:text-foreground data-[state=active]:border-white/10 border border-transparent hover:bg-white/[0.03] hover:text-foreground transition-colors"
          }
        >
          {!compact && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-emerald-400 opacity-0 group-data-[state=active]:opacity-100" aria-hidden />
          )}
          <Icon className="w-4 h-4 flex-shrink-0" />
          {item.label}
        </TabsTrigger>
      );
    });

  const brand = (
    <div className="flex items-center gap-3 min-w-0">
      <div className="nbp-mark w-10 h-10 text-[14px] flex-shrink-0">NBP</div>
      <div className="leading-tight min-w-0">
        <h1 className="font-display text-[15px] font-bold tracking-tight text-foreground truncate">Nexus Brand Protection</h1>
        <p className="text-[11px] text-muted-foreground">Domain security console</p>
      </div>
    </div>
  );

  const userCluster = logoutNotice ? (
    <span className="text-[11px] text-amber-400 max-w-[220px] leading-tight" role="alert">{logoutNotice}</span>
  ) : (
    <div className="flex items-center gap-3">
      {user?.email && (
        <div className="hidden sm:block text-right leading-tight">
          <p className="text-xs font-medium text-foreground truncate max-w-[180px]">{user.name || user.email}</p>
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{user.email}</p>
        </div>
      )}
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-sm font-bold text-[#052e14] flex-shrink-0">
        {(user?.name || user?.email || 'OB').slice(0, 2).toUpperCase()}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="w-[18px] h-[18px]" />
      </Button>
    </div>
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="min-h-screen">
      {/* Mobile top bar */}
      <nav className="lg:hidden sticky top-0 z-40 border-b border-white/5 bg-background/95 backdrop-blur">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <button
            className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
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
          <TabsList className="flex gap-1 overflow-x-auto px-3 pb-3 bg-transparent border-0 p-0 h-auto w-full justify-start">
            {triggers(true)}
          </TabsList>
        )}
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-white/5 bg-[#0d1526]">
        <div className="px-5 py-5">{brand}</div>
        <TabsList className="flex flex-col gap-1 px-3 bg-transparent border-0 p-0 h-auto w-full" data-orientation="vertical">
          {triggers(false)}
        </TabsList>
        <div className="mt-auto px-5 py-4 text-[11px] text-muted-foreground leading-relaxed">
          SPF · DKIM · DMARC monitoring for the domains you operate.
        </div>
      </aside>

      {/* Content */}
      <div className="lg:pl-64 min-h-screen flex flex-col">
        <div className="hidden lg:flex items-center justify-end gap-3 px-8 py-3 border-b border-white/5 bg-background/80 backdrop-blur sticky top-0 z-30">
          {userCluster}
        </div>
        <main className="flex-1 px-4 sm:px-8 py-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </Tabs>
  );
}
