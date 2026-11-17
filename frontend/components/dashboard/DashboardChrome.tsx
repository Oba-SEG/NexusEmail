"use client";

import {
  Bell, LogOut, Globe, Plug, BarChart3, Settings,
  Shield, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DashboardChromeProps {
  children: React.ReactNode;
  user: { name?: string; email?: string } | null;
  logoutNotice: string | null;
  onLogout: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
}

/** App chrome: sticky navbar and the main tab strip. */
export default function DashboardChrome({
  children, user, logoutNotice, onLogout, activeTab, onTabChange, isAdmin,
}: DashboardChromeProps) {
  return (
    <>
{/* Navbar */}
<nav className="border-b border-white/5 bg-background sticky top-0 z-50">
  <div className="container mx-auto px-6 py-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="nbp-mark w-10 h-10 text-[14px]">NBP</div>
        <h1 className="text-[15px] font-display font-bold tracking-tight">Nexus Brand Protection</h1>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-3 pl-0 sm:pl-0">
          {logoutNotice && (
            <span className="text-[11px] text-amber-400 max-w-[220px] leading-tight" role="alert">{logoutNotice}</span>
          )}
          {user?.email && (
            <div className="hidden sm:block text-right leading-tight">
              <p className="text-xs font-medium text-foreground truncate max-w-[180px]">{user.name || user.email}</p>
              <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{user.email}</p>
            </div>
          )}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-sm font-bold text-[#1a0d04] ring-2 ring-emerald-500/20 ring-offset-2 ring-offset-background flex-shrink-0">
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
      </div>
    </div>
  </div>
</nav>

<div className="container mx-auto px-6 py-10">
  {/* Main Content */}
  <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
    <TabsList className="bg-white/[0.03] border border-white/5 p-1 h-auto flex-wrap rounded-xl">
      <TabsTrigger value="domains" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="domains">
        <Globe className="w-4 h-4 mr-2" /> Domains
      </TabsTrigger>
      <TabsTrigger value="integrations" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="integrations">
        <Plug className="w-4 h-4 mr-2" /> Integrations
      </TabsTrigger>
      <TabsTrigger value="notifications" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="notifications">
        <Bell className="w-4 h-4 mr-2" /> Notifications
      </TabsTrigger>
      <TabsTrigger value="reports" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="reports">
        <BarChart3 className="w-4 h-4 mr-2" /> Reports
      </TabsTrigger>
      <TabsTrigger value="settings" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="settings">
        <Settings className="w-4 h-4 mr-2" /> Settings
      </TabsTrigger>
      <TabsTrigger value="brands" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="brands">
        <Shield className="w-4 h-4 mr-2" /> Brand Protection
      </TabsTrigger>
      {isAdmin && (
        <TabsTrigger value="admin" className="data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground data-[state=active]:border-emerald-500/30 border border-transparent text-muted-foreground" data-value="admin">
          <Building2 className="w-4 h-4 mr-2" /> Admin
        </TabsTrigger>
      )}
    </TabsList>
      {children}
    </Tabs>
    </div>
    </>
  );
}
