"use client";

import { Activity, Server, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DNS_PROVIDERS } from "@/lib/providers";
import { useState } from "react";
import { SettingsSection, TabHeader, ToggleRow } from "@/components/dashboard/settings-ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface SettingsTabProps {
  settings: any;
  onSettingsChange: (updater: any) => void;
  apiFetch: (url: string, options?: any) => Promise<Response>;
  onGoToIntegrations?: () => void;
}

/** Settings tab: operational defaults only (scanning cadence and
 * auto-remediation). Provider credentials live in Integrations, delivery
 * channels in Notifications — links point there instead of duplicating them. */
export default function SettingsTab({ settings, onSettingsChange, apiFetch, onGoToIntegrations }: SettingsTabProps) {
  const connected = DNS_PROVIDERS.filter((p: any) => settings?.provider_credentials?.[p.name.toLowerCase()]).length;
  // Reflecting the intent immediately keeps the click from feeling dead while
  // the write is in flight; the stored value still wins if it fails.
  const [pendingToggles, setPendingToggles] = useState({ schedule: false, remediation: false });
  const setPending = (key: 'schedule' | 'remediation', value: boolean) => {
    setPendingToggles((cur) => ({ ...cur, [key]: value }));
  };

  const toggleSchedule = async (enabled: boolean) => {
    setPending('schedule', true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (!res.ok) return;
      // Functional update: two rapid toggles must not resurrect each other's
      // stale snapshot.
      onSettingsChange((cur: any) => ({ ...cur, scan_schedule: { ...(cur?.scan_schedule || {}), enabled } }));
    } catch (e) {
      console.error('Failed to toggle schedule:', e);
    } finally {
      setPending('schedule', false);
    }
  };

  const toggleAutoRemediation = async (enabled: boolean) => {
    setPending('remediation', true);
    try {
      const res = await apiFetch(`${API_BASE}/settings/auto-remediation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (!res.ok) return;
      onSettingsChange((cur: any) => ({ ...cur, auto_remediation: enabled }));
    } catch (e) {
      console.error('Failed to toggle auto-remediation:', e);
    } finally {
      setPending('remediation', false);
    }
  };

  return (
    <>
      <TabHeader
        title="Settings"
        description="Scanning cadence and auto-remediation policy."
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={onGoToIntegrations}
            disabled={!onGoToIntegrations}
          >
            <Server className="w-3.5 h-3.5" />
            {connected}/{DNS_PROVIDERS.length} DNS providers connected
          </Button>
        )}
      />

      <SettingsSection
        icon={Activity}
        title="Scanning"
        description="How and when domains get re-scanned."
      >
        <ToggleRow
          label="Daily scheduled scan"
          description="Re-scan every domain at 02:00 UTC. (Scans on add always run.)"
          on={!!settings?.scan_schedule?.enabled}
          onClick={() => toggleSchedule(!settings?.scan_schedule?.enabled)}
          pending={pendingToggles.schedule}
        />
      </SettingsSection>

      <SettingsSection
        icon={Wrench}
        title="Auto-remediation"
        description="When a connected DNS provider can patch SPF / DMARC, do it automatically."
      >
        <ToggleRow
          label="Auto-fix issues"
          description="Apply recommended record changes via your DNS provider integration."
          on={!!settings?.auto_remediation}
          onClick={() => toggleAutoRemediation(!settings?.auto_remediation)}
          pending={pendingToggles.remediation}
        />
      </SettingsSection>
    </>
  );
}
