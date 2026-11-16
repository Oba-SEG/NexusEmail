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

const DOM_C = { id: 3, name: 'c.test', verified: true, last_score: 60, last_scan: null, latest_scan: null };
const DOM_A = { id: 1, name: 'a.test', verified: true, last_score: 90, last_scan: null, latest_scan: null };
const DOM_A_FULL = { ...DOM_A, dmarc_reports: [{ id: 9, report: { orgName: 'r', reportId: 'x', begin: 1700000000 }, insights: { totalMessages: 5, passingMessages: 4, failingMessages: 1, failingSources: [] } }] };
const DOM_B = { id: 2, name: 'b.test', verified: true, last_score: 40, last_scan: null, latest_scan: null };

// one-shot responders are consumed FIFO per key before the defaults
let oneShot: Array<{ key: string; fn: () => Promise<Res> | Res }> = [];
const defaults: Record<string, () => Res> = {
  'GET /domains': () => resp(200, []),
  'GET /brands': () => resp(200, []),
  'GET /brands/alerts': () => resp(200, []),
  'GET /settings/integrations': () => resp(200, []),
  'GET /settings/config': () => resp(200, {}),
  'POST /domains/1/scan': () => resp(200, {}),
  'POST /domains/2/scan': () => resp(200, {}),
  'GET /domains/2': () => resp(200, DOM_B),
  'GET /domains/1': () => resp(200, DOM_A_FULL),
  'POST /domains/3/scan': () => resp(200, {}),
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

async function inspectA() {
  const dIns = deferred();
  oneShot.push({ key: 'GET /domains/1', fn: () => dIns.promise });
  fireEvent.click(screen.getAllByTitle('Inspect')[0]); // rows render in list order: a, b
  dIns.resolve(resp(200, DOM_A_FULL));
  await screen.findByText('DMARC Aggregate Reports'); // the details panel is open on a.test
}

async function inspectB() {
  const dIns = deferred();
  oneShot.push({ key: 'GET /domains/2', fn: () => dIns.promise });
  fireEvent.click(screen.getAllByTitle('Inspect')[1]); // rows render in list order: a, b
  dIns.resolve(resp(200, DOM_B));
  await screen.findByText('DMARC Aggregate Reports'); // the details panel is open on b.test
}

async function confirmDeleteDialog() {
  // the confirm dialog names the domains; the action button reads
  // "Delete N domains" / "Delete 1 domain"
  fireEvent.click(await screen.findByRole('button', { name: /Delete \d+ domain/ }));
}

async function deleteBThenRespond(reloadResponse: Res) {
  const before = listCallCount();
  const d3 = deferred();
  oneShot.push({ key: 'GET /domains', fn: () => d3.promise });
  fireEvent.click(screen.getAllByLabelText('Select')[1]); // b.test
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
  await confirmDeleteDialog();
  await waitFor(() => expect(listCallCount()).toBe(before + 1)); // the post-delete reload fired
  // resolve AND flush the reload inside act, so loadDomains has fully
  // processed the response (success or failure) before assertions run
  await act(async () => {
    d3.resolve(reloadResponse);
  });
}

describe('Dashboard (real component) — delete/list races', () => {
  test("deleting another domain clears a pending Inspect's loading state", async () => {
    await renderDashboardWithList();

    // A is displayed with its report data...
    await inspectA();
    // ...then Inspect A starts again and is held in flight
    const dHeld = deferred();
    oneShot.push({ key: 'GET /domains/1', fn: () => dHeld.promise });
    fireEvent.click(screen.getAllByTitle('Inspect')[0]);
    await screen.findByText('Loading aggregate reports…');

    // delete B while Inspect A is pending: the delete invalidates the
    // pending request, so the panel must not stay on the loading state
    await deleteBThenRespond(resp(200, [DOM_A]));
    await waitFor(() => {
      expect(screen.queryByText('Loading aggregate reports…')).toBeNull();
      expect(screen.getByText('5 messages · 4 aligned · 1 failed')).toBeTruthy();
    });
  });

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
    // the detail-record fetch resolved: the stored report shows
    await screen.findByText('5 messages · 4 aligned · 1 failed');
  });

  test('the reconciled detail fetch shows a loading state until it settles', async () => {
    await renderDashboardWithList();
    await inspectB();

    // the reconciled detail fetch (GET /domains/1) is held in flight
    const dDet = deferred();
    oneShot.push({ key: 'GET /domains/1', fn: () => dDet.promise });
    await deleteBThenRespond(resp(200, [DOM_A]));
    await screen.findByText('Loading aggregate reports…'); // pending, not a false "no reports"
    expect(screen.queryByText(/No aggregate reports ingested yet/)).toBeNull();

    dDet.resolve(resp(200, DOM_A_FULL));
    await screen.findByText('5 messages · 4 aligned · 1 failed'); // the full record arrived
    expect(screen.queryByText('Loading aggregate reports…')).toBeNull();
  });

  test('a delete that kills the reconciled detail fetch restarts it for the still-shown row', async () => {
    const d1 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d1.promise });
    render(<Dashboard />);
    d1.resolve(resp(200, [DOM_A, DOM_B, DOM_C]));
    await screen.findByText('a.test');

    // Inspect B (settled: B open with full record)
    await inspectB();

    // delete B: the reconcile installs A's list row and starts the
    // A detail fetch — held in flight
    const dDetA = deferred();
    oneShot.push({ key: 'GET /domains/1', fn: () => dDetA.promise });
    await deleteBThenRespond(resp(200, [DOM_A, DOM_C]));
    await screen.findByText('Loading aggregate reports…'); // the reconcile fetch is pending

    // delete C while the A detail fetch is still pending: the delete
    // invalidates it; the reload retains A with no replacement fetch,
    // so the delete must RESTART the A detail fetch
    const aDetailCalls = () =>
      (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains/1').length;
    const before = listCallCount();
    const beforeA = aDetailCalls(); // 1: the reconcile's held fetch
    const d4 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d4.promise });
    fireEvent.click(screen.getAllByLabelText('Select')[1]); // c.test
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await confirmDeleteDialog();
    await waitFor(() => expect(listCallCount()).toBe(before + 1)); // the reload fired
    d4.resolve(resp(200, [DOM_A]));
    await waitFor(() => expect(aDetailCalls()).toBe(beforeA + 1)); // the RESTART fired
    await screen.findByText('5 messages · 4 aligned · 1 failed'); // the full record arrives, no false empty state
    expect(screen.queryByText('No aggregate reports ingested yet')).toBeNull();
  });

  test('overlapping deletes: the older delete still restarts the killed detail fetch via live panel state', async () => {
    const d1 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d1.promise });
    render(<Dashboard />);
    d1.resolve(resp(200, [DOM_A, DOM_B, DOM_C]));
    await screen.findByText('a.test');

    // C's delete starts while the panel is CLOSED (its handler captures
    // the stale closed state)
    const dC = deferred();
    oneShot.push({ key: 'POST /settings/bulk-delete', fn: () => dC.promise });
    fireEvent.click(screen.getAllByLabelText('Select')[2]); // c.test
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await confirmDeleteDialog();

    // before C's delete returns: inspect B, then delete B
    await inspectB();
    const dDetA1 = deferred();
    oneShot.push({ key: 'GET /domains/1', fn: () => dDetA1.promise });
    await deleteBThenRespond(resp(200, [DOM_A]));
    await screen.findByText('Loading aggregate reports…'); // B's reconcile fetch for A is pending

    // C's delete resolves NOW: it invalidates A's pending fetch; its
    // stale closure says the panel is closed, so it must use the live
    // state (panel open on A's row) to restart the fetch
    const dReloadC = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => dReloadC.promise });
    const aCalls = () =>
      (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains/1').length;
    const beforeA = aCalls(); // 1: B's reconcile fetch
    await act(async () => {
      dC.resolve(resp(200, {}));
    });
    await waitFor(() => expect(aCalls()).toBe(beforeA + 1)); // the restart fired
    await waitFor(() => expect(listCallCount()).toBeGreaterThanOrEqual(3)); // C's reload applied
    dReloadC.resolve(resp(200, [DOM_A]));
    await screen.findByText('5 messages · 4 aligned · 1 failed'); // full record, no false empty state
    expect(screen.queryByText(/No aggregate reports ingested yet/)).toBeNull();
  });

  test('closing the panel while the reload is in flight keeps it closed after reconciliation', async () => {
    const d1 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d1.promise });
    render(<Dashboard />);
    d1.resolve(resp(200, [DOM_A, DOM_B]));
    await screen.findByText('a.test');

    // Inspect B (panel open), then start a list reload via Re-scan on A
    await inspectB();
    const dReload = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => dReload.promise });
    fireEvent.click(screen.getAllByTitle('Re-scan')[0]);
    await waitFor(() => {
      expect((global.fetch as any).mock.calls.some((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains' && oneShot.length === 0)).toBe(true);
    });

    // the user CLOSES the panel while the reload is in flight
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();

    // the reload returns without B (deleted server-side): the
    // reconcile selects A but the panel must STAY closed and no
    // detail fetch may open it again
    dReload.resolve(resp(200, [DOM_A]));
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();
    const aCalls = () =>
      (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains/1').length;
    expect(aCalls()).toBe(0); // no unrequested detail fetch
  });

  test('deleting the shown domain while the panel is closed leaves it closed after the reload', async () => {
    const d1 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => d1.promise });
    render(<Dashboard />);
    d1.resolve(resp(200, [DOM_A, DOM_B]));
    await screen.findByText('a.test');

    // inspect B, then CLOSE the panel before deleting
    await inspectB();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();

    // delete B: the panel was already closed, so no reopen intent —
    // the reload's reconcile of A must not open it or fetch details
    const dDetA = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => dDetA.promise });
    fireEvent.click(screen.getAllByLabelText('Select')[1]); // b.test
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await confirmDeleteDialog();
    dDetA.resolve(resp(200, [DOM_A]));
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();
    const aCalls = () =>
      (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains/1').length;
    expect(aCalls()).toBe(0); // no unrequested detail fetch
  });

  test('reopen intent expires when the deletion reload retains a newer selection', async () => {
    await renderDashboardWithList();

    // B open, then delete B: the delete records reopen intent and
    // clears the panel; the reload is held in flight
    await inspectB();
    const dReload = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => dReload.promise });
    fireEvent.click(screen.getAllByLabelText('Select')[1]); // b.test
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await confirmDeleteDialog();
    await waitFor(() => expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull());

    // the deletion reload FAILS: the intent survives (no apply)
    await act(async () => {
      dReload.reject(new Error('network'));
    });

    // the user inspects A manually, then closes the panel — the
    // explicit Close must clear the stale intent
    await inspectA();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();

    // a later reload removes A (returns C): with the intent expired
    // the reconcile must NOT open C or fetch its details
    const dReload2 = deferred();
    oneShot.push({ key: 'GET /domains', fn: () => dReload2.promise });
    fireEvent.click(screen.getAllByTitle('Re-scan')[0]); // scan a.test
    await act(async () => {
      dReload2.resolve(resp(200, [DOM_C]));
    });
    await screen.findByText('c.test');
    expect(screen.queryByText('DMARC Aggregate Reports')).toBeNull();
    const cCalls = () =>
      (global.fetch as any).mock.calls.filter((c: any[]) => keyOf(c[0], c[1]) === 'GET /domains/3').length;
    expect(cCalls()).toBe(0); // no unrequested detail fetch
  });

  test('a failed reconciled detail fetch shows an error state', async () => {
    await renderDashboardWithList();
    await inspectB();

    const dDet = deferred();
    oneShot.push({ key: 'GET /domains/1', fn: () => dDet.promise });
    await deleteBThenRespond(resp(200, [DOM_A]));
    await screen.findByText('Loading aggregate reports…');

    dDet.resolve(resp(500, { error: 'boom' }));
    await screen.findByText(/Failed to load domain details/); // error state, not a false empty state
    expect(screen.queryByText('Loading aggregate reports…')).toBeNull();
    expect(screen.queryByText(/No aggregate reports ingested yet/)).toBeNull(); // no false empty state below the error
  });
});
