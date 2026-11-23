// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ThreatEvidenceDialog from '@/components/dashboard/ThreatEvidenceDialog';

afterEach(() => cleanup());

describe('ThreatEvidenceDialog', () => {
  test('loads and renders collected evidence artifacts', async () => {
    const apiFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        enrichment_status: 'complete',
        evidence_status: 'complete',
        artifacts: [
          {
            id: 7,
            kind: 'dns',
            status: 'ok',
            collector: 'dns',
            collected_at: '2026-11-23T10:00:00.000Z',
            metadata: { records: { a: [{ address: '203.0.113.10' }], mx: [], ns: [], txt: [], aaaa: [] } },
          },
        ],
      }),
    }));

    render(
      <ThreatEvidenceDialog
        open
        onClose={() => {}}
        brandId={1}
        threat={{ id: 2, domain: 'evil.test' }}
        apiFetch={apiFetch as any}
        tokenRef={{ current: 'token' }}
        onAuthFailure={() => {}}
        openerRef={{ current: null }}
      />,
    );

    expect(await screen.findByText(/Evidence: evil.test/)).toBeTruthy();
    expect(await screen.findByText('DNS records')).toBeTruthy();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(/\/brands\/1\/threats\/2\/evidence$/)));
  });
});
