// Domain-panel transitions (issue #64 review): pure functions modeling
// exactly how the dashboard's domain list, details selection and
// shown-domain ref move across loads, failures and identity switches.
// Kept framework-free so the identity-boundary behavior is unit-testable
// (a new identity must never inherit the previous one's domains).

export interface DomainPanelState {
  domains: any[];
  selected: any | null;
  showDetails: boolean;
  shownId: number | null;
}

/** Identity switch / logout: nothing of the previous identity survives. */
export function clearedDomainPanel(): DomainPanelState {
  return { domains: [], selected: null, showDetails: false, shownId: null };
}

/** A domain-list load result. `null` data means the load FAILED — the
 * panel must not be touched (a cleared panel stays cleared; the current
 * identity's list stays). A successful load reconciles the selection
 * against the returned ids: a selection whose domain is still present
 * survives (deletes included — a removed domain must not stay selected),
 * otherwise the first domain is auto-selected, or nothing when the list
 * is empty. */
export function applyDomainList(panel: DomainPanelState, data: any[] | null): DomainPanelState {
  if (data === null) return panel;
  const kept = panel.selected && data.some((d) => d.id === panel.selected.id) ? panel.selected : null;
  const selected = kept ?? data[0] ?? null;
  return {
    ...panel,
    domains: data,
    selected,
    showDetails: selected ? panel.showDetails : false,
    shownId: selected ? selected.id : null,
  };
}

/** A domain-details (Inspect) result. A failed load leaves the panel —
 * and the shown-domain ref — on the previous domain, so uploads for it
 * keep refreshing. A success moves both selection and shownId. */
export function applyDomainSelection(panel: DomainPanelState, domain: any, ok: boolean): DomainPanelState {
  if (!ok) return panel;
  return { ...panel, selected: domain, showDetails: true, shownId: domain.id };
}

export interface DomainListResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type DomainListResult =
  | { kind: 'ok'; state: DomainPanelState }
  | { kind: 'auth' }
  | { kind: 'fail' };

/** The Dashboard's domain-list load flow, framework-free so the
 * identity-boundary behavior is exercised by tests. Auth results are
 * reported back instead of handled here — the caller re-checks its
 * session generation BEFORE triggering an identity reset, so a stale
 * load from session A can never sign user B out. */
export async function runDomainListLoad(
  fetchDomains: () => Promise<DomainListResponse>,
  state: DomainPanelState
): Promise<DomainListResult> {
  let res: DomainListResponse;
  try {
    res = await fetchDomains();
  } catch (e) {
    return { kind: 'fail' };
  }
  if (res.status === 401) return { kind: 'auth' };
  if (!res.ok) return { kind: 'fail' };
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    return { kind: 'fail' };
  }
  if (!Array.isArray(data)) return { kind: 'fail' };
  return { kind: 'ok', state: applyDomainList(state, data) };
}
