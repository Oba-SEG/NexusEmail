// Scheduled scanning is opt-out: workspaces that never touched the setting
// keep the historical behavior (daily 02:00 UTC scans). Only an explicit
// false-ish stored value pauses background scans for that organization.
function isScanEnabledValue(value) {
  if (value === undefined || value === null || value === '') return true;
  return !['false', '0', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
}

module.exports = { isScanEnabledValue };
