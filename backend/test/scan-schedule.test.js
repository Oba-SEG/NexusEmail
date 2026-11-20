const test = require('node:test');
const assert = require('node:assert/strict');
const { isScanEnabledValue } = require('../src/services/scanSchedule');

test('scheduled scans stay on when the setting was never saved', () => {
  assert.equal(isScanEnabledValue(undefined), true);
  assert.equal(isScanEnabledValue(null), true);
  assert.equal(isScanEnabledValue(''), true);
});

test('explicit false-ish values pause scheduled scans', () => {
  for (const value of ['false', 'FALSE', '0', 'off', 'disabled', ' false ']) {
    assert.equal(isScanEnabledValue(value), false);
  }
});

test('explicit enabled values keep scans running', () => {
  for (const value of ['true', '1', 'on', 'enabled']) {
    assert.equal(isScanEnabledValue(value), true);
  }
});
