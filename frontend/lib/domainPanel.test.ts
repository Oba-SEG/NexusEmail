import { describe, expect, test } from 'vitest';
import { applyDomainList, applyDomainSelection, clearedDomainPanel, runDomainListLoad, type DomainPanelState } from './domainPanel';

describe('identity switch: user A -> user B', () => {
  test("A's domains must not survive a switch even when B's load fails", () => {
    // A signs in and loads domains
    let panel: DomainPanelState = clearedDomainPanel();
    panel = applyDomainList(panel, [{ id: 1, name: 'a.test' }, { id: 2, name: 'a2.test' }]);
    expect(panel.domains.map((d: any) => d.name)).toEqual(['a.test', 'a2.test']);

    // identity switch -> the reset clears everything
    const reset = clearedDomainPanel();
    expect(reset.domains).toEqual([]);

    // B's domain load FAILS (null data -> panel untouched): A's list
    // must not reappear
    const failed = applyDomainList(reset, null);
    expect(failed.domains).toEqual([]);
    expect(failed.selected).toBeNull();
    expect(failed.showDetails).toBe(false);
  });

  test("B's successful load shows B's domains and auto-selects the first", () => {
    const panel = applyDomainList(clearedDomainPanel(), [{ id: 3, name: 'b.test' }]);
    expect(panel.domains.map((d: any) => d.name)).toEqual(['b.test']);
    expect(panel.selected?.id).toBe(3);
    expect(panel.shownId).toBe(3);
  });
});

describe('runDomainListLoad — the Dashboard load flow', () => {
  const res = (ok: boolean, status: number, body: unknown) => ({
    ok,
    status,
    json: async () => body,
  });

  test('A-to-B switch: B failing (HTTP + network + bad payload) keeps the panel cleared', async () => {
    // A signed in and loaded
    const panelA = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }]);
    expect(panelA.domains.length).toBe(1);

    // identity switch -> reset clears everything
    const reset = clearedDomainPanel();
    expect(reset.domains).toEqual([]);

    // B's load fails in every way a real request can — none may touch
    // the panel (A's domains must not reappear)
    const httpFail = await runDomainListLoad(async () => res(false, 500, { error: 'boom' }), reset);
    expect(httpFail.kind).toBe('fail');

    const networkFail = await runDomainListLoad(async () => { throw new Error('ECONNRESET'); }, reset);
    expect(networkFail.kind).toBe('fail');

    const badPayload = await runDomainListLoad(async () => res(true, 200, { not: 'an array' }), reset);
    expect(badPayload.kind).toBe('fail');

    const jsonFail = await runDomainListLoad(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), reset);
    expect(jsonFail.kind).toBe('fail');

    expect(reset.domains).toEqual([]);
    expect(reset.selected).toBeNull();
  });

  test('401 reports auth (caller re-checks its generation before identity reset)', async () => {
    const r = await runDomainListLoad(async () => res(false, 401, { error: 'expired' }), clearedDomainPanel());
    expect(r.kind).toBe('auth');
  });

  test("B's successful load shows B's domains and auto-selects the first", async () => {
    const r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 3, name: 'b.test' }, { id: 4, name: 'b2.test' }]),
      clearedDomainPanel()
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.state.domains.map((d: any) => d.name)).toEqual(['b.test', 'b2.test']);
      expect(r.state.selected?.id).toBe(3);
      expect(r.state.shownId).toBe(3);
    }
  });

  test('an existing selection survives a successful reload', async () => {
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    const r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]),
      panel
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.state.selected?.id).toBe(2);
      expect(r.state.shownId).toBe(2);
    }
  });
});

describe('selection and upload refresh association', () => {
  test('an existing selection survives reloads; the shown id follows it', () => {
    let panel = clearedDomainPanel();
    panel = applyDomainList(panel, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);

    // reload with the same list: selection 2 stays, no auto-select flip
    const reloaded = applyDomainList(panel, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    expect(reloaded.selected?.id).toBe(2);
    expect(reloaded.shownId).toBe(2);
  });

  test('a failed Inspect leaves the panel and shown id on the previous domain', () => {
    let panel = clearedDomainPanel();
    panel = applyDomainList(panel, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 1, name: 'a.test' }, true);

    // Inspect b.test FAILS — panel and shownId stay on a.test, so an
    // upload refresh for a.test still applies
    const failed = applyDomainSelection(panel, { id: 2, name: 'b.test' }, false);
    expect(failed.selected?.id).toBe(1);
    expect(failed.shownId).toBe(1);
    expect(failed.domains).toEqual(panel.domains);
  });

  test('a successful Inspect moves both selection and shown id', () => {
    let panel = clearedDomainPanel();
    panel = applyDomainList(panel, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    expect(panel.selected?.id).toBe(2);
    expect(panel.shownId).toBe(2);
    expect(panel.showDetails).toBe(true);
  });
});
