"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bell, Building2, Globe, Plug, Search, Settings, Shield } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle, dialogFocusReturn,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: any[];
  brands: any[];
  isAdmin: boolean;
  onOpenDomain: (domain: any) => void;
  onOpenBrand: (brandId: number) => void;
  onNavigate: (tab: string) => void;
}

type Result = {
  key: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

const PAGES = [
  { tab: 'domains', label: 'Domains', hint: 'SPF, DKIM and DMARC posture', icon: Globe },
  { tab: 'brands', label: 'Brand protection', hint: 'Monitored brands and threats', icon: Shield },
  { tab: 'threats', label: 'Threat alerts', hint: 'Open typosquats and impersonation', icon: Shield },
  { tab: 'reports', label: 'Reports', hint: 'Single-domain reports and exports', icon: BarChart3 },
  { tab: 'integrations', label: 'DNS providers', hint: 'DNS provider connections', icon: Plug },
  { tab: 'notifications', label: 'Notifications', hint: 'E-mail and Slack delivery', icon: Bell },
  { tab: 'settings', label: 'Settings', hint: 'Operational defaults', icon: Settings },
];

/** ⌘K palette: jump to a page, a monitored domain or a brand without
 * scanning the nav. Entities are already loaded by the dashboard, so the
 * palette stays instant and works offline. */
export default function GlobalSearch({
  open, onOpenChange, domains, brands, isAdmin, onOpenDomain, onOpenBrand, onNavigate,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnFocus = dialogFocusReturn(openerRef);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const q = query.trim().toLowerCase();
  const pages = useMemo<Result[]>(() => {
    const all = isAdmin ? [...PAGES, { tab: 'admin', label: 'Administration', hint: 'Organisations and platform access', icon: Building2 }] : PAGES;
    return all
      .filter((p) => !q || p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q))
      .map((p) => ({
        key: `page-${p.tab}`,
        label: p.label,
        hint: p.hint,
        icon: p.icon,
        run: () => { onOpenChange(false); onNavigate(p.tab); },
      }));
  }, [q, isAdmin, onNavigate, onOpenChange]);

  const domainResults = useMemo<Result[]>(() => domains
    .filter((d: any) => q && String(d.name || '').toLowerCase().includes(q))
    .slice(0, 6)
    .map((d: any) => ({
      key: `domain-${d.id}`,
      label: d.name,
      hint: typeof d.last_score === 'number' ? `Domain · score ${d.last_score}` : 'Domain · not scanned',
      icon: Globe,
      run: () => { onOpenChange(false); onOpenDomain(d); },
    })), [q, domains, onOpenDomain, onOpenChange]);

  const brandResults = useMemo<Result[]>(() => brands
    .filter((b: any) => q && (
      String(b.domain || '').toLowerCase().includes(q)
      || String(b.brand_name || '').toLowerCase().includes(q)
    ))
    .slice(0, 6)
    .map((b: any) => ({
      key: `brand-${b.id}`,
      label: b.domain,
      hint: `${b.brand_name || 'Brand'} · monitored`,
      icon: Shield,
      run: () => { onOpenChange(false); onOpenBrand(b.id); },
    })), [q, brands, onOpenBrand, onOpenChange]);

  const sections = [
    { label: 'Pages', items: pages },
    { label: 'Domains', items: domainResults },
    { label: 'Brands', items: brandResults },
  ].filter((s) => s.items.length > 0);
  const flat = sections.flatMap((s) => s.items);
  const activeIndex = flat.length ? Math.min(Math.max(active, 0), flat.length - 1) : 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[activeIndex]?.run();
    }
  };

  let cursor = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden"
        onCloseAutoFocus={(e) => {
          if (!openerRef.current || openerRef.current === document.body) {
            const button = document.querySelector<HTMLElement>('button[aria-label="Search domains, brands and pages"]');
            if (button) {
              e.preventDefault();
              button.focus();
              return;
            }
          }
          returnFocus(e);
        }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, domains and brands. Use arrow keys to choose and Enter to open.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search domains, brands, pages…"
            aria-label="Search domains, brands and pages"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="global-search-results"
            aria-activedescendant={flat.length ? `gs-${flat[activeIndex].key}` : undefined}
            className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {flat.length === 0 && (
            <p role="status" className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {q ? `No results for “${query}”.` : 'Start typing to search.'}
            </p>
          )}
          <div id="global-search-results" role="listbox" aria-label="Search results">
          {sections.map((section) => (
            <div key={section.label} role="group" aria-label={section.label} className="mb-1">
              <p aria-hidden="true" className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                {section.label}
              </p>
              {section.items.map((item) => {
                cursor += 1;
                const index = cursor;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    id={`gs-${item.key}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    ref={index === activeIndex ? activeRef : undefined}
                    onClick={item.run}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                      index === activeIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-foreground">{item.label}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10.5px] text-muted-foreground">
          <span><kbd className="rounded border border-border px-1">↑</kbd> <kbd className="rounded border border-border px-1">↓</kbd> to navigate</span>
          <span><kbd className="rounded border border-border px-1">↵</kbd> to open</span>
          <span className="ml-auto">⌘K to toggle</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
