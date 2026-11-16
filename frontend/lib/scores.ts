// Score bands — one definition used by every surface (KPI strip, filter
// pills, score rings, admin badges). The same score must mean the same
// thing everywhere. Unscored domains are 'unknown', never 'failed'
// (unknown is a state, not an error).

export const PASSING_SCORE = 80;
export const WARNING_SCORE = 50;
export type ScoreBand = 'passing' | 'warnings' | 'failed' | 'unknown';
export function scoreBand(score: unknown): ScoreBand {
  if (typeof score !== 'number') return 'unknown';
  if (score >= PASSING_SCORE) return 'passing';
  if (score >= WARNING_SCORE) return 'warnings';
  return 'failed';
}
export function filterByBand(list: any[], band: string | null): any[] {
  if (band === 'passing' || band === 'warnings' || band === 'failed') {
    return list.filter((d: any) => scoreBand(d.last_score) === band);
  }
  return list;
}
