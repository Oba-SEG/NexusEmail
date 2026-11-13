// HTML-escape a value for interpolation into HTML text/attribute contexts.
// Every dynamic value rendered into report or email templates must pass
// through this — DNS TXT/RRT content is attacker-controllable, so anything
// that came out of DNS, user input, or stored JSON is untrusted.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
