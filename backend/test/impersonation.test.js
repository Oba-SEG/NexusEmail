const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/database');
const { sign, verifyToken, requireAuth, auditIdentity, hashPassword } = require('../src/auth');
const express = require('express');

const target = { id: 'customer', email: 'customer@example.test', status: 'active', org_id: 'tenant', role: 'owner', token_version: 1 };
const admin = { id: 'admin', email: 'admin@example.test', status: 'active', platform_role: 'platform_admin' };

test('impersonation retains tenant permissions and distinct audit identities across password refresh', async (t) => {
  const rows = [];
  const currentUser = { ...target, password_hash: hashPassword('old-password') };
  t.mock.method(db, 'getUser', async (id) => id === admin.id ? admin : id === target.id ? currentUser : null);
  t.mock.method(db, 'withTransaction', async (fn) => fn({}));
  t.mock.method(db, 'insertAuditLog', async (row) => rows.push(row));
  t.mock.method(db, 'updateOrganization', async () => ({ id: 'tenant', name: 'New name', slug: 'tenant' }));
  t.mock.method(db, 'setUserPassword', async () => { currentUser.token_version += 1; return currentUser.token_version; });
  const app = express();
  app.use(express.json(), requireAuth, require('../src/routes/settings').router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const original = sign({ sub: target.id, tv: 1, act: { sub: admin.id } }, 300);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, body, method = 'POST') => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const changed = await call('/password', original, { current_password: 'old-password', new_password: 'new-password' });
  assert.equal(changed.status, 200);
  const refreshed = (await changed.json()).token;
  assert.equal(verifyToken(refreshed).act.sub, admin.id);
  assert.ok(verifyToken(refreshed).exp <= verifyToken(original).exp);
  assert.equal((await call('/organization', refreshed, { name: 'New name' }, 'PATCH')).status, 200);
  assert.deepEqual(rows.map((row) => [row.actorUserId, row.detail.impersonated_user.id, row.targetOrgId]), [[admin.id, target.id, 'tenant'], [admin.id, target.id, 'tenant']]);
  const req = { headers: { authorization: `Bearer ${refreshed}` } };
  await requireAuth(req, {}, () => {});
  assert.equal(req.user.id, target.id);
  assert.equal(req.actor.id, admin.id);
  assert.deepEqual(auditIdentity({ user: target }, { name: 'Name' }), { actorUserId: target.id, actorEmail: target.email, detail: { name: 'Name' } });
});
