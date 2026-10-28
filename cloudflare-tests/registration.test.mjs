import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1 } from './db.mjs';
import repositoryWorker, { passwordHash, statement } from '../worker/index.mjs';
// Consente di collaudare anche il server attivo, conservato separatamente, prima del deploy.
const worker = process.env.VC_ACTIVE_SERVER_TEST
  ? (await import(new URL('../active-server-test.mjs', import.meta.url))).default
  : repositoryWorker;
const roleKeys = ['wants_referee', 'wants_scorer', 'wants_manager', 'wants_coach'];
const person = (roles = { wants_referee: true }) => ({ first_name: 'TEST', last_name: 'ISCRITTO', password: 'A123', ...roles });
async function setup() {
  const db = new LocalD1();
  const env = { DB: db, ENVIRONMENT: 'staging', REGISTRATION_ENABLED: 'true', PASSWORD_PEPPER: 'TEST-registration-pepper' };
  env.PATTY_HASH = await passwordHash('TEST-patty-password', env.PASSWORD_PEPPER);
  const client = () => {
    let cookie = '', csrf = '';
    return async (path, data) => {
      const headers = { Cookie: cookie, Origin: 'https://test.invalid' };
      if (data !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; }
      const response = await worker.fetch(new Request('https://test.invalid/api/' + path, {
        method: data === undefined ? 'GET' : 'POST', headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      }), env);
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = await response.json();
      if (result.csrf) csrf = result.csrf;
      return { status: response.status, body: result };
    };
  };
  return { db, env, client };
}
test('iscrizione senza consenso fittizio: quattro ruoli singoli e account multiruolo', async () => {
  const u = await setup();
  try {
    for (const [i, roles] of [...roleKeys.map(k => ({ [k]: true })), Object.fromEntries(roleKeys.map(k => [k, true]))].entries()) {
      const call = u.client();
      const data = { ...person(roles), last_name: 'RUOLO' + i };
      assert.equal((await call('auth/register', data)).status, 200);
      const me = await call('me');
      assert.equal(me.body.user.admin, false);
      for (const k of roleKeys) assert.equal(me.body.user[k], !!roles[k]);
      const p = await statement(u.db, 'SELECT * FROM people WHERE last_name=?', data.last_name).first();
      assert.equal(p.approved, 1);
      assert.notEqual(p.password_hash, data.password);
      assert.equal((await call('admin/state')).status, 403, 'un ruolo della società non dà accesso PATTY');
    }
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM people').first()).n, 5);
  } finally { u.db.close(); }
});
test('accesso persistente, uscita, codice errato e rientro con gli stessi ruoli', async () => {
  const u = await setup();
  try {
    const data = person({ wants_scorer: true, wants_coach: true });
    const call = u.client();
    assert.equal((await call('auth/register', data)).status, 200);
    const first = (await call('me')).body.user;
    assert.equal((await call('me')).body.user.id, first.id);
    assert.equal((await call('auth/logout', {})).status, 200);
    assert.equal((await call('me')).body.user, null);
    assert.equal((await call('auth/login', { ...data, password: 'Z999' })).status, 401);
    assert.equal((await call('auth/login', data)).status, 200);
    assert.deepEqual((await call('me')).body.user, first);
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM people').first()).n, 1);
  } finally { u.db.close(); }
});
test('registrazioni chiuse, ruolo mancante, codice invalido e doppioni sono rifiutati', async () => {
  const u = await setup();
  try {
    const call = u.client();
    u.env.REGISTRATION_ENABLED = 'false';
    assert.equal((await call('auth/register', person())).status, 403);
    u.env.REGISTRATION_ENABLED = 'true';
    assert.equal((await call('auth/register', person({}))).status, 400);
    assert.equal((await call('auth/register', { ...person(), password: '12' })).status, 400);
    assert.equal((await call('auth/register', person())).status, 200);
    assert.equal((await call('auth/register', person())).status, 409);
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM people').first()).n, 1);
  } finally { u.db.close(); }
});
test('PATTY vede multiruoli, disattiva le sessioni e riattiva senza cancellare dati', async () => {
  const u = await setup();
  try {
    const user = u.client(), patty = u.client(), outsider = u.client();
    const data = person(Object.fromEntries(roleKeys.map(k => [k, true])));
    await user('auth/register', data);
    const me = (await user('me')).body.user;
    assert.equal((await outsider('admin/person', { id: me.id, approved: false })).status, 403);
    assert.equal((await patty('auth/login', { admin: true, password: 'TEST-patty-password' })).status, 200);
    await patty('me');
    const list = (await patty('admin/state')).body.people;
    const visible = list.find(p => p.id === me.id);
    for (const k of roleKeys) assert.equal(visible[k], 1);
    const before = await statement(u.db, 'SELECT * FROM people WHERE id=?', me.id).first();
    assert.equal((await patty('admin/person', { id: me.id, approved: false })).status, 200);
    assert.equal((await user('me')).body.user, null);
    assert.equal((await user('auth/login', data)).status, 403);
    assert.equal((await patty('admin/person', { id: me.id, approved: true })).status, 200);
    assert.equal((await user('auth/login', data)).status, 200);
    const after = await statement(u.db, 'SELECT * FROM people WHERE id=?', me.id).first();
    assert.deepEqual(after, before, 'nome, codice cifrato e ruoli conservati');
    assert.equal((await outsider('admin/state')).status, 403);
  } finally { u.db.close(); }
});
