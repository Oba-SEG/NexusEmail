const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  slugify,
  isValidSlug,
  isValidEmail,
  tenantNameError,
  ownerNameError,
  passwordError,
} = require('../src/services/provisioning');

test('slugify produces stable URL-safe workspace slugs', () => {
  assert.equal(slugify('Segbytes Solutions'), 'segbytes-solutions');
  assert.equal(slugify('  Acme & Co.  '), 'acme-co');
  assert.equal(slugify('Café Défense'), 'cafe-defense');
  assert.equal(slugify('---'), 'workspace');
  assert.equal(slugify('A'.repeat(60)).length, 40);
});

test('isValidSlug limits shape and length', () => {
  assert.equal(isValidSlug('acme'), true);
  assert.equal(isValidSlug('acme-co'), true);
  assert.equal(isValidSlug('a'), false);
  assert.equal(isValidSlug('-acme'), false);
  assert.equal(isValidSlug('acme-'), false);
  assert.equal(isValidSlug('Acme'), false);
  assert.equal(isValidSlug('a'.repeat(41)), false);
  assert.equal(isValidSlug('acme co'), false);
});

test('email validation is deliberately narrow but not naive', () => {
  assert.equal(isValidEmail('owner@acme.co'), true);
  assert.equal(isValidEmail('owner+tag@acme.co.za'), true);
  assert.equal(isValidEmail('owner@acme'), false);
  assert.equal(isValidEmail('owner acme.co'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(undefined), false);
});

test('tenant, owner-name, and password validation report actionable errors', () => {
  assert.match(tenantNameError('x'), /at least 2/);
  assert.match(tenantNameError('x'.repeat(81)), /80/);
  assert.equal(tenantNameError('Acme'), null);

  assert.match(ownerNameError('x'.repeat(81)), /80/);
  assert.equal(ownerNameError(''), null);
  assert.equal(ownerNameError(undefined), null);

  assert.match(passwordError('short'), /8/);
  assert.match(passwordError('x'.repeat(201)), /200/);
  assert.equal(passwordError('long-enough'), null);
});
