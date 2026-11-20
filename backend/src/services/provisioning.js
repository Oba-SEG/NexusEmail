const crypto = require('crypto');
const db = require('../db/database');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(value) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'workspace';
}

function isValidSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}

function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

function tenantNameError(value) {
  if (typeof value !== 'string' || value.trim().length < 2) return 'Workspace name must be at least 2 characters.';
  if (value.trim().length > 80) return 'Workspace name must be 80 characters or fewer.';
  return null;
}

function ownerNameError(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 80) return 'Name must be 80 characters or fewer.';
  return null;
}

function passwordError(value) {
  if (typeof value !== 'string' || value.length < 8) return 'Password must be at least 8 characters.';
  if (value.length > 200) return 'Password must be 200 characters or fewer.';
  return null;
}

async function uniqueSlug(name) {
  const base = slugify(name);
  if (!(await db.getOrganization(base))) return base;
  for (let i = 0; i < 20; i += 1) {
    const candidate = `${base.slice(0, 35)}-${crypto.randomBytes(2).toString('hex')}`;
    if (!(await db.getOrganization(candidate))) return candidate;
  }
  throw new Error('Could not allocate a unique workspace slug');
}

module.exports = {
  slugify,
  isValidSlug,
  isValidEmail,
  tenantNameError,
  ownerNameError,
  passwordError,
  uniqueSlug,
};
