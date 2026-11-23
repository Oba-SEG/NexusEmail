// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        enrichment_active: false,
        artifacts: [
          {
            id: 7,
            kind: 'dns',
            status: 'ok',
            collector: 'dns',
            collected_at: '2026-11-23T10:00:00.000Z',
            metadata: { records: { a: [{ address: '203.0.113.10' }], mx: [], ns: [], txt: [], aaaa: [] } },
          },
          {
            id: 9,
            kind: 'http',
            status: 'ok',
            collector: 'http',
            collected_at: '2026-11-23T10:00:00.000Z',
            storage_key: 'org-1/1/2/http-abc123.html',
            bytes: 114,
            sha256: '6dc9c7fc93bb488b0a71d4fbfd2dc03f2a1f6e8f15bd7f1d6b8f0e4f0c1b2a3d',
            metadata: { http_status: 200, headers: { 'content-type': 'text/html' } },
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
    expect(await screen.findByText('HTTP response')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy();
    expect(screen.getByText(/sha256 6dc9c7fc93bb/)).toBeTruthy();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(/\/brands\/1\/threats\/2\/evidence$/)));
  });

  test('downloads evidence through the authenticated client', async () => {
    const apiFetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('?download=1')) {
        return { ok: true, status: 200, blob: async () => new Blob(['html'], { type: 'text/html' }), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enrichment_status: 'complete',
          evidence_status: 'complete',
          enrichment_active: false,
          artifacts: [{
            id: 9,
            kind: 'http',
            status: 'ok',
            collector: 'http',
            storage_key: 'org-1/1/2/http-abc123.html',
            metadata: { http_status: 200, headers: { 'content-type': 'text/html' } },
          }],
        }),
      };
    });
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => 'blob:test');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
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
      fireEvent.click(await screen.findByRole('button', { name: /Download/ }));
      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(/\/brands\/1\/evidence\/9\?download=1$/)));
      expect(createObjectUrl).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
    } finally {
      click.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    }
  });

  test('does not poll a pending status that has no queued job', async () => {
    vi.useFakeTimers();
    try {
      const apiFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          enrichment_status: 'pending',
          evidence_status: 'pending',
          enrichment_active: false,
          artifacts: [],
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

      await act(async () => { await Promise.resolve(); });
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Collection not queued')).toBeTruthy();

      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(apiFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
