#!/usr/bin/env node
// Live verification for JWT revocation (issue #13): a token issued before
// POST /api/auth/revoke must fail requireAuth afterwards.
//
// Usage: node scripts/verify-jwt-revocation.js <api-base> <email> <password>
// Exits 0 when revocation is proven, 1 on failure.

const base = process.argv[2] || 'http://localhost:4100';
const email = process.argv[3];
const password = process.argv[4];

if (!email || !password) {
  console.error('usage: node scripts/verify-jwt-revocation.js <api-base> <email> <password>');
  process.exit(1);
}

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!login.ok) { console.error('login failed:', login.status); process.exit(1); }
  const { token } = await login.json();

  const me1 = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (me1.status !== 200) { console.error('token should be valid before revoke, got', me1.status); process.exit(1); }

  const revoke = await fetch(`${base}/api/auth/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (revoke.status !== 200) { console.error('revoke failed:', revoke.status); process.exit(1); }

  const me2 = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (me2.status !== 401) { console.error('old token should be revoked, got', me2.status); process.exit(1); }

  const relogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!relogin.ok) { console.error('re-login failed:', relogin.status); process.exit(1); }

  console.log('jwt revocation verified: pre-revoke token valid, post-revoke 401, re-login works');
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
