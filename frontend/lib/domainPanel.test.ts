import { describe, expect, test } from 'vitest';
import { applyDomainList, applyDomainSelection, clearedDomainPanel, type DomainPanelState } from './domainPanel';

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
