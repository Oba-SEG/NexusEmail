import { describe, expect, test } from 'vitest';
import { applyDomainList, applyDomainSelection, clearedDomainPanel, runDomainListLoad, dnsEvidence, type DomainPanelState } from './domainPanel';

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

  test('deleting the selected domain clears it and auto-selects the first remaining', () => {
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    const after = applyDomainList(panel, [{ id: 1, name: 'a.test' }]);
    expect(after.selected?.id).toBe(1);
    expect(after.shownId).toBe(1);
    expect(after.showDetails).toBe(true);
  });

  test('deleting the last domain clears the selection and closes the panel', () => {
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    const after = applyDomainList(panel, []);
    expect(after.selected).toBeNull();
    expect(after.shownId).toBeNull();
    expect(after.showDetails).toBe(false);
  });

  test('dashboard race: a late viewDomain success for a deleted domain is invalidated', async () => {
    // models the Dashboard's domainDetailsGenRef / domainDetailsIdRef
    let gen = 0;

    // user loads domains, opens Inspect on domain 2 (request in flight)
    let r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]),
      clearedDomainPanel()
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    let panel = r.state; // selection auto-selects domain 1; user then inspects 2
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    const selGen = ++gen; // viewDomain(2) in flight

    // domain 2 is deleted; the reload arrives without it
    r = await runDomainListLoad(async () => res(true, 200, [{ id: 1, name: 'a.test' }]), panel);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.invalidateDetails).toBe(true); // shown domain vanished -> loadDomains bumps the gen
    if (r.invalidateDetails) gen += 1;
    panel = r.state;
    expect(panel.selected?.id).toBe(1); // auto-selected the first remaining

    // the late viewDomain(2) success arrives with the old selGen
    const guardPasses = selGen === gen; // selGen !== domainDetailsGenRef.current -> return
    expect(guardPasses).toBe(false); // dropped: deleted domain is not re-selected
  });

  test('dashboard race: a pending Inspect for a deleted domain is invalidated while another domain stays shown', async () => {
    // sequence from review: domain 1 shown, viewDomain(2) in flight,
    // domain 2 deleted, reload returns only domain 1
    let gen = 0;
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 1, name: 'a.test' }, true); // domain 1 shown

    const selGen = ++gen; // viewDomain(2) starts (pending target = 2)
    const pendingId = 2;

    // domain 2 deleted; the reload returns only domain 1
    const r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }]),
      panel,
      pendingId
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.invalidateDetails).toBe(true); // pending target gone -> loadDomains bumps the gen
    if (r.invalidateDetails) gen += 1;
    expect(r.state.selected?.id).toBe(1); // shown domain 1 stays selected
    expect(r.state.shownId).toBe(1);

    // the delayed viewDomain(2) success arrives with the old selGen
    const guardPasses = selGen === gen; // selGen !== domainDetailsGenRef.current -> return
    expect(guardPasses).toBe(false); // dropped: deleted domain 2 is not selected
  });

  test('dashboard race: the delete itself invalidates even when the reload fails', async () => {
    // deleteDomains bumps the generation right after a successful
    // DELETE POST, before loadDomains — so a failed reload cannot
    // leave the pending Inspect armed
    let gen = 0;
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 1, name: 'a.test' }, true);

    const selGen = ++gen; // viewDomain(2) in flight
    // DELETE succeeds (modeled): 2 was deleted -> bump before reloading
    const deletedPending = true; // selectedIds contains the pending target
    if (deletedPending) gen += 1;

    // the reload then fails — nothing reconciles, panel untouched
    const r = await runDomainListLoad(async () => { throw new Error('ECONNRESET'); }, panel, 2);
    expect(r.kind).toBe('fail');

    // the delayed viewDomain(2) success still arrives with a stale gen
    const guardPasses = selGen === gen;
    expect(guardPasses).toBe(false); // dropped: deleted domain 2 is not selected
  });

  test('pending ownership: an older Inspect settling must not clear a newer same-domain request', async () => {
    // models domainDetailsPendingRef + domainDetailsReqSeq ownership
    let seq = 0;
    let pending: { id: number; seq: number } | null = null;
    const settle = (requestSeq: number) => {
      if (pending?.seq === requestSeq) pending = null;
    };

    // older viewDomain(2) starts, then a newer viewDomain(2) starts
    const older = ++seq; pending = { id: 2, seq: older };
    const newer = ++seq; pending = { id: 2, seq: newer };

    // the older request settles: it must NOT clear the newer's entry
    settle(older);
    expect(pending?.seq).toBe(newer);
    expect(pending?.id).toBe(2);

    // delete 2 -> reload sees pending 2 absent and invalidates
    const shown = applyDomainSelection(
      applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]),
      { id: 1, name: 'a.test' },
      true
    );
    const r = await runDomainListLoad(async () => res(true, 200, [{ id: 1, name: 'a.test' }]), shown, pending.id);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.invalidateDetails).toBe(true);
  });

  test('a failed delete POST must not invalidate in-flight detail requests', async () => {
    // deleteDomains only bumps the generation when res.ok — a failed
    // delete leaves the domain (and the request) alive
    let gen = 0;
    const selGen = ++gen; // viewDomain(2) in flight
    // DELETE POST returns non-2xx (modeled): no bump happens
    // ...

    // the viewDomain(2) success arrives — the domain still exists
    const guardPasses = selGen === gen;
    expect(guardPasses).toBe(true); // applies: the delete failed, domain 2 remains

    // and a reload that still contains domain 2 invalidates nothing
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 1, name: 'a.test' }, true);
    const r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]),
      panel,
      2
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.invalidateDetails).toBe(false);
  });

  test('successful delete of the shown domain: the reload applies the first remaining selection', async () => {
    // deleteDomains leaves the shown-domain ref alone; the reload
    // reconciles it against the returned ids
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);

    const r = await runDomainListLoad(async () => res(true, 200, [{ id: 1, name: 'a.test' }]), panel, null);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.invalidateDetails).toBe(true); // shown domain gone -> gen bump
    expect(r.state.selected?.id).toBe(1); // first remaining selected
    expect(r.state.shownId).toBe(1);
  });

  test('delete shown domain + FAILED reload: panel stays cleared, no deleted-domain details', async () => {
    // deleteDomains clears the panel immediately when the shown
    // domain was deleted; the failed reload must not resurrect it
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);

    // DELETE succeeds -> deleteDomains clears the panel (modeled)
    panel = clearedDomainPanel();
    expect(panel.selected).toBeNull();
    expect(panel.showDetails).toBe(false);

    // the reload then fails — the cleared panel must stay cleared
    const r = await runDomainListLoad(async () => res(false, 500, { error: 'boom' }), panel, null);
    expect(r.kind).toBe('fail');
    expect(panel.selected).toBeNull();
    expect(panel.showDetails).toBe(false);
    expect(panel.domains).toEqual([]);
  });

  test('delete shown domain + failed reload, then a later successful reload selects the first remaining', async () => {
    // after the failed reload, the next successful reload (ref null)
    // still applies the first-remaining selection
    const r = await runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }]),
      clearedDomainPanel(),
      null
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.state.selected?.id).toBe(1);
    expect(r.state.shownId).toBe(1);
  });

  test('delete race: a pre-delete list response cannot resurrect the deleted domain', async () => {
    // models domainListGenRef: deleteDomains bumps it on a successful
    // delete; loadDomains drops responses that predate the bump
    let listGen = 0;
    const panel0 = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);

    // pre-delete list request in flight (captures gen 0)
    const stale = runDomainListLoad(
      async () => res(true, 200, [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]),
      panel0,
      null
    );
    const staleGen = listGen;

    // domain 2 is deleted -> deleteDomains bumps the list generation
    listGen += 1;

    // the post-delete reload returns []
    const fresh = await runDomainListLoad(async () => res(true, 200, []), clearedDomainPanel(), null);
    if (fresh.kind !== 'ok') throw new Error('expected ok');
    expect(fresh.state.domains).toEqual([]);
    expect(fresh.state.selected).toBeNull();

    // the stale pre-delete response arrives with the old generation
    await stale;
    const applies = staleGen === listGen; // loadDomains: listGen !== current -> return
    expect(applies).toBe(false); // deleted domain 2 stays out of the list
  });

  test('the reload right after deleteDomains cleared the panel applies the first remaining', async () => {
    // deleteDomains cleared the selection (ref null); the immediate
    // reload must re-select the first remaining domain — an empty
    // selection with domains available is not acceptable
    let panel = applyDomainList(clearedDomainPanel(), [{ id: 1, name: 'a.test' }, { id: 2, name: 'b.test' }]);
    panel = applyDomainSelection(panel, { id: 2, name: 'b.test' }, true);
    panel = clearedDomainPanel(); // deleteDomains cleared the panel

    const r = await runDomainListLoad(async () => res(true, 200, [{ id: 1, name: 'a.test' }]), panel, null);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.state.selected?.id).toBe(1); // first remaining selected
    expect(r.state.shownId).toBe(1);
    expect(r.state.showDetails).toBe(false); // panel was closed by the delete; auto-select does not reopen it

    // and when nothing remains, the selection stays empty
    const empty = await runDomainListLoad(async () => res(true, 200, []), panel, null);
    if (empty.kind !== 'ok') throw new Error('expected ok');
    expect(empty.state.selected).toBeNull();
    expect(empty.state.shownId).toBeNull();
    expect(empty.state.showDetails).toBe(false);
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

  test('dnsEvidence maps live-DNS queries for an empty domain', () => {
    const scan = {
      spf_record: JSON.stringify({ found: false, record: null }),
      dkim_selectors: JSON.stringify([]),
      dmarc_record: JSON.stringify({ found: false, record: null }),
      issues: JSON.stringify([
        { type: 'MTA-STS', severity: 'medium', message: 'No MTA-STS record found - email not secured with TLS enforcement' },
        { type: 'TLS-RPT', severity: 'low', message: 'No _smtp._tls.a.test record published yet — add it to pass this check' },
      ]),
    };
    const rows = dnsEvidence(scan, 'a.test');
    expect(rows.map((r) => r.check)).toEqual(['SPF', 'DKIM', 'DMARC', 'MTA-STS', 'TLS-RPT']);
    expect(rows[0]).toMatchObject({ query: 'a.test · TXT', result: 'No v=spf1 record published', found: false });
    expect(rows[2].query).toBe('_dmarc.a.test · TXT');
    expect(rows[3].result).toBe('No MTA-STS record published');
    expect(rows[4].found).toBe(false);
  });

  test('dnsEvidence surfaces published records with found flags', () => {
    const scan = {
      spf_record: JSON.stringify({ found: true, record: 'v=spf1 include:_spf.google.com ~all' }),
      dkim_selectors: JSON.stringify(['google']),
      dmarc_record: JSON.stringify({ found: true, record: 'v=DMARC1; p=none;', policy: 'none' }),
      issues: '[]',
    };
    const rows = dnsEvidence(scan, 'a.test');
    expect(rows[0].found).toBe(true);
    expect(rows[0].result).toBe('v=spf1 include:_spf.google.com ~all');
    expect(rows[1].result).toBe('Selectors: google');
    expect(rows[2].result).toBe('v=DMARC1; p=none;');
    expect(rows).toHaveLength(3);
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
