/** User-facing timestamps: 24-hour, day-first, unambiguous.
 * US-style dates read as slop in an operator tool; a single formatter also
 * keeps tables aligned and avoids locale drift across the app. */
const dateTimeFormatter = new Intl.DateTimeFormat('en-ZA', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDateTime(value?: string | number | Date | null): string {
  if (value == null || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}
