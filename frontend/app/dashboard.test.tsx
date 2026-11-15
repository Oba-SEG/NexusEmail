// @vitest-environment jsdom
import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  'GET /domains/2': () => resp(200, DOM_B),
  'POST /settings/bulk-delete': () => resp(200, {}),
};

const keyOf = (input: unknown, init?: RequestInit) => {
  const url = String(input).replace(API, '');
  const method = (init?.method || 'GET').toUpperCase();
  return `${method} ${url}`;
};

const listCallCount = () =>
  (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains').length;

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

async function inspectB() {
  const dIns = deferred();
  oneShot.push({ key: 'GET /domains/2', fn: () => dIns.promise });
  fireEvent.click(screen.getAllByTitle('Inspect')[1]); // rows render in list order: a, b
  dIns.resolve(resp(200, DOM_B));
  await screen.findByText('DMARC Aggregate Reports'); // the details panel is open on b.test
}

async function deleteBThenRespond(reloadResponse: Res) {
  const before = listCallCount();
  const d3 = deferred();
  oneShot.push({ key: 'GET /domains', fn: () => d3.promise });
  fireEvent.click(screen.getAllByLabelText('Select')[1]); // b.test
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
  await waitFor(() => expect(listCallCount()).toBe(before + 1)); // the post-delete reload fired
  d3.resolve(reloadResponse);
}

describe('Dashboard (real component) — delete/list races', () => {
  test('a pre-delete list response cannot resurrect the deleted domain', async () => {
    await renderDashboardWithList();

    // an overlapping list request goes in flight BEFORE the delete:
    // Re-scan b.test (scanDomain -> POST scan -> loadDomains)
    const d2 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d2.promise });
    const before = listCallCount();
    fireEvent.click(screen.getAllByTitle('Re-scan')[1]);
    await waitFor(() => expect(listCallCount()).toBe(before + 1)); // the scan-triggered load fired

    // select b.test and delete it; the post-delete reload applies []
    await deleteBThenRespond(resp(200, []));
    await waitFor(() => expect(screen.queryByText('b.test')).toBeNull());

    // the stale PRE-delete list response (contains b.test) arrives now;
    // act flushes its processing before the assertion
    await act(async () => {
      d2.resolve(resp(200, [DOM_A, DOM_B]));
    });
    expect(screen.queryByText('b.test')).toBeNull(); // dropped: stays out of the list
  });

  test('a failed post-delete reload closes the deleted domain details and upload action', async () => {
    await renderDashboardWithList();
    await inspectB(); // b.test details open (with the DMARC upload action)

    await deleteBThenRespond(resp(500, { error: 'boom' }));
    await waitFor(() => {
      // the shown domain was deleted: the panel is cleared immediately,
      // and the failed reload must not resurrect it
      expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();
      expect(screen.queryByRole('button', { name: /Upload XML/ })).toBeNull();
    });
  });

  test('a successful post-delete reload selects the first remaining domain', async () => {
    await renderDashboardWithList();
    await inspectB(); // b.test details open

    await deleteBThenRespond(resp(200, [DOM_A]));
    await waitFor(() => {
      // the reconciled selection is the first remaining domain, shown
      // in the details panel (row + details title both render a.test)
      expect(screen.queryByText('b.test')).toBeNull();
      expect(screen.getAllByText('a.test').length).toBe(2);
      expect(screen.getByText('DMARC Aggregate Reports')).toBeTruthy();
    });
  });
});
