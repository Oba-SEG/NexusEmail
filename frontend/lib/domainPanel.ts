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
  | { kind: 'ok'; state: DomainPanelState; invalidateDetails: boolean }
  | { kind: 'auth' }
  | { kind: 'fail' };

/** The Dashboard's domain-list load flow, framework-free so the
 * identity-boundary behavior is exercised by tests. Auth results are
 * reported back instead of handled here — the caller re-checks its
 * session generation BEFORE triggering an identity reset, so a stale
 * load from session A can never sign user B out. */
export async function runDomainListLoad(
  fetchDomains: () => Promise<DomainListResponse>,
  state: DomainPanelState,
  pendingDetailsId: number | null = null
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
  const before = state.shownId;
  const next = applyDomainList(state, data);
  // A detail request targets a deleted domain: either the previously
  // SHOWN domain vanished from the list (deleted while its details
  // were open), or the target of the in-flight Inspect vanished (its
  // target was deleted while another domain is shown). The caller
  // must invalidate pending detail requests BEFORE re-selecting — a
  // late viewDomain success for a removed domain must not select it
  // again.
  const shownGone = before !== null && !data.some((d: any) => d.id === before);
  const pendingGone = pendingDetailsId !== null && !data.some((d: any) => d.id === pendingDetailsId);
  return { kind: 'ok', state: next, invalidateDetails: shownGone || pendingGone };
}


// --- Display helpers (moved from app/page.tsx): pure row/tone mapping ---




// --- Display helpers (moved from app/page.tsx): pure row/tone mapping ---

export function parseMaybeJson(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function recordState(scan: any, key: 'spf' | 'dkim' | 'dmarc'): { label: string; tone: 'pass' | 'fail' | 'warn' | 'none' } {
  if (!scan) return { label: 'Unknown', tone: 'none' };
  const selectorsForDkim = key === 'dkim' ? parseMaybeJson(scan.dkim_selectors) : null;
  const obj = parseMaybeJson(scan[key])
    ?? (key === 'dkim' ? null : parseMaybeJson(scan[`${key}_record`]))
    ?? (Array.isArray(selectorsForDkim) ? { found: selectorsForDkim.length > 0, selectors: selectorsForDkim } : null);
  const flat = scan[`${key}_status`];

  let status: string | null = null;
  if (flat && flat !== 'UNKNOWN' && typeof flat === 'string') status = flat;
  else if (obj?.status) status = String(obj.status);
  else if (obj == null) status = flat ? String(flat) : null;
  else if (obj.error || (Array.isArray(obj.errors) && obj.errors.length)) {
    // Validation errors beat found:true (+all, p=none); absent records
    // (ENOTFOUND / "No X record found") are NOT_FOUND, not ERROR.
    const msgs = [obj.error, ...(Array.isArray(obj.errors) ? obj.errors : [])].filter(Boolean).join(' ');
    // NOT_FOUND also matches the friendly wording emitted by the backend
    // (friendlyDnsError): "No _dmarc.<domain> record published yet".
    // A FOUND record whose errors[] carry only advisory warnings (e.g.
    // p=none) stays FOUND — the policy-based tone below renders it amber,
    // and "Error" would mislabel a live, valid record.
    if (!obj.found && /ENOTFOUND|NXDOMAIN|No (?:SPF|DMARC) record found|record published yet/i.test(msgs)) status = 'NOT_FOUND';
    else if (obj.found) {
      // FOUND stays FOUND only when every error is a known advisory
      // recommendation (e.g. the p=none note). A genuine validation
      // error (e.g. SPF `-all +all` CRITICAL) still resolves to ERROR,
      // never a passing pill.
      const errs = [
        ...(obj.error ? [String(obj.error)] : []),
        ...(Array.isArray(obj.errors) ? obj.errors.map(String) : []),
      ];
      const allAdvisory = errs.every((e) => /policy is "?none"?|no action taken|no action on failures/i.test(e));
      status = allAdvisory ? 'FOUND' : 'ERROR';
    }
    else status = 'ERROR';
  } else if (obj.found) status = 'FOUND';
  else status = 'NOT_FOUND';

  if (!status) return { label: 'Unknown', tone: 'none' };

  const selectors = Array.isArray(selectorsForDkim) ? selectorsForDkim : (Array.isArray(obj?.selectors) ? obj.selectors : []);
  const policy = obj?.policy ?? null;
  const enforcing = key === 'spf' ? (policy === 'hardfail' || policy === 'softfail')
    : key === 'dmarc' ? (policy === 'reject' || policy === 'quarantine')
    : selectors.length > 0;

  if (status === 'FOUND' || status === 'pass') {
    if (key === 'dkim') return { label: selectors.length ? `${selectors.length} selector${selectors.length === 1 ? '' : 's'}` : 'Found', tone: 'pass' };
    // "Found · p=none" not bare "none" — the bare policy read as "record
    // missing" (operators asked where the DMARC record was).
    if (policy) return { label: `Found · ${key === 'dmarc' ? 'p=' + policy : policy}`, tone: enforcing ? 'pass' : 'warn' };
    return { label: 'Found', tone: 'warn' };
  }
  if (status === 'NOT_FOUND') return { label: 'Not found', tone: 'fail' };
  if (status === 'ERROR') return { label: 'Error', tone: 'fail' };
  return { label: status, tone: 'warn' };
}

export const recordToneClass: Record<string, string> = {
  pass: 'border-emerald-500/25 bg-emerald-500/10',
  fail: 'border-red-500/25 bg-red-500/10',
  warn: 'border-amber-500/25 bg-amber-500/10',
  none: 'border-border bg-white/[0.03]'
};

// --- DNS evidence rows: prove what the scanner actually queried ---

export interface DnsEvidenceRow {
  check: string;
  query: string;
  result: string;
  found: boolean;
}

export function dnsEvidence(scan: any, domain: string): DnsEvidenceRow[] {
  if (!scan || !domain) return [];
  const spfObj = parseMaybeJson(scan.spf_record);
  const dmarcObj = parseMaybeJson(scan.dmarc_record);
  const selectors = parseMaybeJson(scan.dkim_selectors);
  const issues = parseMaybeJson(scan.issues);
  const issueFor = (type: string) =>
    Array.isArray(issues) ? String((issues.find((i: any) => i?.type === type) || {}).message || '') : '';
  const rows: DnsEvidenceRow[] = [];
  rows.push({
    check: 'SPF',
    query: `${domain} · TXT`,
    result: spfObj?.found && spfObj.record ? String(spfObj.record) : 'No v=spf1 record published',
    found: !!spfObj?.found,
  });
  const selList = (Array.isArray(selectors) ? selectors : [])
    .map((s: any) => (typeof s === 'string' ? s : s?.selector))
    .filter(Boolean);
  rows.push({
    check: 'DKIM',
    query: `${domain} · TXT (common selectors)`,
    result: selList.length ? `Selectors: ${selList.join(', ')}` : 'No selector records found',
    found: selList.length > 0,
  });
  rows.push({
    check: 'DMARC',
    query: `_dmarc.${domain} · TXT`,
    result: dmarcObj?.found && dmarcObj.record ? String(dmarcObj.record) : 'No DMARC record published',
    found: !!dmarcObj?.found,
  });
  const mtaIssue = issueFor('MTA-STS');
  if (mtaIssue) rows.push({
    check: 'MTA-STS',
    query: `mta-sts.${domain} · TXT`,
    result: /No MTA-STS/i.test(mtaIssue) ? 'No MTA-STS record published' : mtaIssue,
    found: !/No MTA-STS/i.test(mtaIssue),
  });
  const tlsIssue = issueFor('TLS-RPT');
  if (tlsIssue) rows.push({
    check: 'TLS-RPT',
    query: `_smtp._tls.${domain} · TXT`,
    result: /No _smtp._tls/i.test(tlsIssue) ? 'No TLS-RPT record published' : tlsIssue,
    found: !/No _smtp._tls/i.test(tlsIssue),
  });
  return rows;
}

// --- Score explanation rows: make the health number auditable ---

export interface ScoreRow {
  key: string;
  label: string;
  got: number;
  max: number;
  hint: string;
}

const SCORE_HINTS: Record<string, string> = {
  spf: '≤35 — hardfail (-all) 35, softfail (~all) 25, present 10',
  dkim: '≤30 — 20 for a valid key, +10 for a 2048-bit key',
  dmarc: '≤35 — reject 35, quarantine 25, p=none 10',
  mta_sts: '≤15 — valid enforce policy with max_age ≥ 86400',
  tls_rpt: '≤5 — rua reporting address present',
};

export function scoreBreakdownRows(breakdown: any): { total: number; rows: ScoreRow[] } | null {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const order = ['spf', 'dkim', 'dmarc', 'mta_sts', 'tls_rpt'];
  const rows: ScoreRow[] = order
    .filter((k) => breakdown[k] !== undefined)
    .map((k) => ({
      key: k,
      label: k === 'mta_sts' ? 'MTA-STS' : k === 'tls_rpt' ? 'TLS-RPT' : k.toUpperCase(),
      got: breakdown[k] || 0,
      max: breakdown.max?.[k] ?? 0,
      hint: SCORE_HINTS[k] || '',
    }));
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.got, 0);
  return { total, rows };
}
