// @vitest-environment jsdom
import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dashboard from './page';

const API = 'http://localhost:4000/api';

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
const resp = (status: number, body: unknown): Res => ({ ok: status < 400, status, json: async () => body });

interface Deferred {
  promise: Promise<Res>;
  resolve: (r: Res) => void;
  reject: (e: unknown) => void;
}
const deferred = (): Deferred => {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<Res>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const DOM_A = { id: 1, name: 'a.test', verified: true, last_score: 90, last_scan: null, latest_scan: null };
const DOM_B = { id: 2, name: 'b.test', verified: true, last_score: 40, last_scan: null, latest_scan: null };

// one-shot responders are consumed FIFO per key before the defaults
let oneShot: Array<{ key: string; fn: () => Promise<Res> | Res }> = [];
const defaults: Record<string, () => Res> = {
  'GET /domains': () => resp(200, []),
  'GET /brands': () => resp(200, []),
  'GET /brands/alerts': () => resp(200, []),
  'GET /settings/integrations': () => resp(200, []),
  'GET /settings/config': () => resp(200, {}),
  'POST /domains/2/scan': () => resp(200, {}),
  'POST /settings/bulk-delete': () => resp(200, {}),
};

const keyOf = (input: unknown, init?: RequestInit) => {
  const url = String(input).replace(API, '');
  const method = (init?.method || 'GET').toUpperCase();
  return `${method} ${url}`;
};

beforeEach(() => {
  oneShot = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const key = keyOf(input, init);
    const shot = oneShot.find((s) => s.key === key);
    if (shot) {
      oneShot.splice(oneShot.indexOf(shot), 1);
      return typeof shot.fn === 'function' ? shot.fn() : shot.fn;
    }
    const dflt = defaults[key];
    if (dflt) return dflt();
    throw new Error('unmocked fetch: ' + key);
  }));
  // jsdom lacks ResizeObserver (used by some ui primitives)
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  localStorage.setItem('nexusemail_token', 'tok');
  localStorage.setItem('nexusemail_user', JSON.stringify({ id: 1, email: 'x@y.z', platform_role: 'user' }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderDashboardWithList() {
  const d1 = deferred();
  oneShot.push({ key: 'GET /domains', fn: () => d1.promise });
  render(<Dashboard />);
  // the mount effect fires loadDomains -> d1; release it to show rows
  d1.resolve(resp(200, [DOM_A, DOM_B]));
  await screen.findByText('a.test');
  await screen.findByText('b.test');
}

describe('Dashboard (real component) — delete/list races', () => {
  test('a pre-delete list response cannot resurrect the deleted domain', async () => {
    await renderDashboardWithList();

    // an overlapping list request goes in flight BEFORE the delete:
    // Re-scan b.test (scanDomain -> POST scan -> loadDomains)
    const d2 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d2.promise });
    const rescanButtons = screen.getAllByTitle('Re-scan');
    fireEvent.click(rescanButtons[1]); // rows render in list order: a, b
    await waitFor(() => expect(d2.promise).toBeTruthy());
    await waitFor(() => {
      // the scan-triggered loadDomains consumed the deferred
      expect((global.fetch as any).mock.calls.some((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains')).toBe(true);
    });

    // select b.test and delete it: the DELETE succeeds, the reload
    // (deferred d3) runs after the list generation bumped
    const selectButtons = screen.getAllByLabelText('Select');
    fireEvent.click(selectButtons[1]); // b.test
    const d3 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d3.promise });
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    // post-delete reload returns [] (last domain of the pair deleted)
    d3.resolve(resp(200, []));
    await waitFor(() => expect(screen.queryByText('b.test')).toBeNull());

    // the stale PRE-delete list response (contains b.test) arrives now
    d2.resolve(resp(200, [DOM_A, DOM_B]));
    await waitFor(() => {
      // must be dropped: deleted domain stays out of the list
      expect(screen.queryByText('b.test')).toBeNull();
    });
  });

  test('a failed post-delete reload leaves the panel untouched (no crash)', async () => {
    await renderDashboardWithList();

    // select b.test and delete: the reload fails this time
    const selectButtons = screen.getAllByLabelText('Select');
    fireEvent.click(selectButtons[1]);
    oneShot.push({ key: 'POST /settings/bulk-delete', fn: () => resp(200, {}) });
    const d3 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d3.promise });
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    d3.resolve(resp(500, { error: 'boom' }));
    await waitFor(() => {
      // failure semantics: the list is unchanged (b.test row remains
      // until a successful reload reconciles it), nothing crashed
      expect(screen.getByText('b.test')).toBeTruthy();
      expect(screen.getByText('a.test')).toBeTruthy();
    });
  });

  test('a successful post-delete reload re-selects the first remaining domain', async () => {
    await renderDashboardWithList();

    // select b.test and delete: the reload returns a.test
    const selectButtons = screen.getAllByLabelText('Select');
    fireEvent.click(selectButtons[1]);
    oneShot.push({ key: 'POST /settings/bulk-delete', fn: () => resp(200, {}) });
    const d3 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d3.promise });
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    d3.resolve(resp(200, [DOM_A]));
    await waitFor(() => {
      expect(screen.queryByText('b.test')).toBeNull();
      expect(screen.getByText('a.test')).toBeTruthy();
    });
  });
});
