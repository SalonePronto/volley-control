import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../scripts/local-network-fallback.cjs');
import { passwordHash, random, statement, saveGame } from '../worker/index.mjs';
const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
function splitSQL(sql) {
  const result = [];
  let rest = sql.trim();
  while (rest) {
    let end;
    if (rest.startsWith('CREATE TRIGGER')) {
      const match = /^END;/m.exec(rest);
      assert.ok(match);
      end = match.index + 4;
    } else end = rest.indexOf(';') + 1;
    if (!end) break;
    result.push(rest.slice(0, end));
    rest = rest.slice(end).trim();
  }
  return result;
}
test('runtime Cloudflare workerd + D1: migrazioni, auth, cookie, prenotazioni atomiche e backup', async () => {
  const pepper = random(),
    password = random(),
    hash = await passwordHash(password, pepper);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'test',
          modules: [
            { type: 'ESModule', path: new URL('../dist/worker.mjs', import.meta.url).pathname },
            { type: 'ESModule', path: new URL('../dist/domain.mjs', import.meta.url).pathname },
          ],
          compatibilityDate: '2026-10-01',
          d1Databases: { DB: 'local-runtime-test' },
          bindings: {
            PASSWORD_PEPPER: pepper,
            PATTY_HASH: hash,
            REGISTRATION_ENABLED: 'true',
            ENVIRONMENT: 'staging',
          },
        },
      ],
      inspectorPort: 0,
    }),
  );
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of [
      '0001_initial.sql',
      '0002_sync_jobs.sql',
      '0003_game_versions.sql',
      '0004_recovery_jobs.sql',
      '0005_write_guards.sql',
    ]) {
      const sql = await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8');
      for (const s of splitSQL(sql)) await db.prepare(s).run();
    }
    const request = async (path, data, auth = {}) => {
      const r = await mf.dispatchFetch('https://test.invalid/api/' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Origin: 'https://test.invalid',
          'Content-Type': 'application/json',
          Cookie: auth.cookie || '',
          'X-CSRF-Token': auth.csrf || '',
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: r.status, headers: r.headers, body: await r.json() };
    };
    assert.equal((await request('health')).status, 200);
    let r = await request('auth/login', { admin: true, password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    const adm = { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.body.csrf };
    const g = {
      game_key: 'TEST:workerd',
      team_id: 'FIPAV:229693',
      source: 'FIPAV',
      season: '2026-2027',
      group_id: '63945',
      date: '2030-01-05',
      time: '18:30',
      is_home: true,
      hidden: false,
      required_referees: 1,
      required_scorers: 1,
      home_team: 'TEST CASA',
      away_team: 'TEST OSPITE',
      category: 'U15',
      our_team_name: 'TEST',
      game_number: 'TEST',
      venue: 'TEST',
      address: '',
      sets: [],
    };
    await saveGame(db, g, g, {});
    const users = [];
    for (const name of ['runtime-one', 'runtime-two']) {
      r = await request('auth/register', {
        email: name + '@example.invalid',
        first_name: 'TEST',
        last_name: name,
        password,
        wants_referee: true,
        wants_scorer: true,
        staging_consent: true,
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const p = await statement(
        db,
        'SELECT id FROM people WHERE email=?',
        name + '@example.invalid',
      ).first();
      assert.equal(
        (
          await request(
            'admin/person',
            { id: p.id, approved: true, wants_referee: true, wants_scorer: true },
            adm,
          )
        ).status,
        200,
      );
      r = await request('auth/login', { email: name + '@example.invalid', password });
      assert.equal(r.status, 200);
      users.push({ cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.body.csrf });
    }
    const booked = await Promise.all(
      users.map((u) => request('book', { game_key: g.game_key, role: 'referee', slot: 1 }, u)),
    );
    assert.deepEqual(booked.map((x) => x.status).sort(), [201, 409]);
    const exported = await request('admin/backup', undefined, adm);
    assert.equal(exported.status, 200);
    assert.equal(exported.body.data.assignments.length, 1);
    assert.equal((await request('admin/backup')).status, 403);
    const state = await request('calendar');
    assert.equal(state.body.assignments.length, 1);
    assert.equal(state.body.games.length, 1);
    assert.ok(state.body.assignments[0].last_name.startsWith('runtime-'));
    assert.equal((await request('admin/state', undefined, users[0])).status, 403);
    assert.equal((await request('admin/usage', undefined, adm)).status, 200);
  } finally {
    await mf.dispose();
  }
});
