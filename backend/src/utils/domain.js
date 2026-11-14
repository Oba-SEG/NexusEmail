// RFC 952/1123-style hostname validation for monitored domains.
// Non-ASCII is rejected for now (no punycode conversion path yet).

const MAX_LEN = 253;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeDomain(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Domain must be a string' };
  const name = raw.toLowerCase().trim();
  if (!name) return { ok: false, error: 'Domain is required' };
  if (name.length > MAX_LEN) return { ok: false, error: 'Domain exceeds 253 characters' };
  // printable ASCII only (space..~); also excludes control chars
  if (/[^ -~]/.test(name)) return { ok: false, error: 'Non-ASCII domains are not supported (use punycode)' };
  if (!name.includes('.')) return { ok: false, error: 'Domain must include a TLD (at least one dot)' };
  if (name.startsWith('.') || name.endsWith('.')) return { ok: false, error: 'Domain cannot start or end with a dot' };

  for (const label of name.split('.')) {
    if (!label) return { ok: false, error: 'Domain contains an empty label' };
    if (label.length > 63) return { ok: false, error: 'Label exceeds 63 characters' };
    if (!LABEL_RE.test(label)) {
      return { ok: false, error: `Invalid label "${label}" (letters, digits, inner hyphens; no leading/trailing hyphen)` };
    }
  }

  return { ok: true, name };
}

module.exports = { normalizeDomain };
