import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1 } from './db.mjs';
import worker, {
  statement,
  passwordHash,
  verifyPassword,
  random,
  assign,
  saveGame,
  saveImport,
  syncScope,
  syncStep,
  exportBackup,
  restoreBackup,
  applyFixed,
} from '../worker/index.mjs';
import {
  dateISO,
  hour,
  weekStart,
  interval,
  normalizeFipav,
  normalizePgs,
  mergeGame,
  validatePatch,
  validateTeam,
  roleState,
  scopeFor,
} from '../worker/domain.mjs';
const envFor = (db) => ({
  DB: db,
  PASSWORD_PEPPER: 'TEST-ONLY-secret-not-a-production-key',
  ENVIRONMENT: 'staging',
  REGISTRATION_ENABLED: 'true',
});
const GAME = {
  game_key: 'TEST:game',
  team_id: 'FIPAV:229693',
  source: 'FIPAV',
  season: '2026-2027',
  group_id: '63945',
  official_id: 'TEST:game',
  game_number: 'TEST',
  our_team_id: '229693',
  our_team_name: 'TEST SQUADRA',
  category: 'U15',
  home_team: 'TEST CASA',
  away_team: 'TEST OSPITE',
  is_home: true,
  date: '2030-01-05',
  time: '18:30',
  venue: 'TEST PALESTRA',
  address: 'TEST INDIRIZZO',
  played: false,
  home_sets: null,
  away_sets: null,
  sets: [],
  notes: '',
  hidden: false,
  required_referees: 1,
  required_scorers: 1,
};
async function addPerson(db, id = 'TEST-person', approved = 1) {
  await statement(
    db,
    'INSERT INTO people(id,email,first_name,last_name,password_hash,wants_referee,wants_scorer,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    id + '@example.invalid',
    'TEST',
    id,
    'TEST-no-login',
    1,
    1,
    approved,
    new Date().toISOString(),
  ).run();
  return id;
}
async function game(db, patch = {}) {
  const g = { ...GAME, ...patch };
  await saveGame(db, g, g, {});
  return g;
}
const post = (path, data, cookie = '', csrf = '') =>
  new Request('https://test.invalid/api/' + path, {
    method: 'POST',
    headers: {
      Origin: 'https://test.invalid',
      'Content-Type': 'application/json',
      Cookie: cookie,
      'x-csrf-token': csrf,
    },
    body: JSON.stringify(data),
  });
async function loginAdmin(env) {
  env.PATTY_HASH = await passwordHash('TEST-only-password-123', env.PASSWORD_PEPPER);
  const r = await worker.fetch(
    post('auth/login', { admin: true, password: 'TEST-only-password-123' }),
    env,
  );
  assert.equal(r.status, 200);
  const b = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: b.csrf };
}
async function userSession(db, id) {
  const token = random(),
    csrf = random();
  const { sha } = await import('../worker/index.mjs');
  await statement(
    db,
    'INSERT INTO sessions VALUES(?,?,?,?,?)',
    await sha(token),
    id,
    0,
    csrf,
    Date.now() + 100000,
  ).run();
  return { cookie: '__Host-vc=' + token, csrf };
}
async function call(env, path, data, auth = {}) {
  const r = await worker.fetch(post(path, data, auth.cookie, auth.csrf), env);
  return { status: r.status, body: await r.json() };
}

test('date, ore, settimana e intervalli Roma (inverno/estate)', () => {
  assert.equal(dateISO('05/01/2030'), '2030-01-05');
  assert.equal(hour('18.30'), '18:30');
  assert.equal(weekStart('2030-01-05'), '2029-12-31');
  assert.throws(() => dateISO('31/02/2030'));
  assert.throws(() => hour('25:00'));
  assert.equal(interval(GAME)[0], Date.parse('2030-01-05T17:30:00Z'));
  assert.equal(interval({ ...GAME, date: '2030-07-05' })[0], Date.parse('2030-07-05T16:30:00Z'));
});
test('colori: coperto verde, parziale mancante rosso, trasferta —', () => {
  assert.equal(roleState(GAME, [], 'referee'), 'missing');
  assert.equal(roleState(GAME, [{ role: 'referee' }], 'referee'), 'covered');
  assert.equal(
    roleState({ ...GAME, required_referees: 2 }, [{ role: 'referee' }], 'referee'),
    'missing',
  );
  assert.equal(roleState({ ...GAME, is_home: false }, [], 'referee'), 'na');
});
test('normalizza FIPAV filtrando gli ID e mantenendo risultati/parziali', () => {
  const t = {
    id: 'FIPAV:1',
    source: 'FIPAV',
    season: '2026-2027',
    group_id: '1',
    official_team_id: '1',
    name: 'TEST',
    category: 'U15',
  };
  const m = {
    id: 10,
    ng: 7001,
    date: '05/01/2030',
    time: '18.00',
    team1: { id: 1, title: 'TEST' },
    team2: { id: 2, title: 'TEST AWAY' },
    played: true,
    'team1-setwin': 3,
    'team2-setwin': 0,
    pt_a: [25, 25, 25],
    pt_b: [20, 21, 22],
  };
  const out = normalizeFipav({ data: { matches: [m, { ...m, id: 11, team1: { id: 3 } }] } }, t);
  assert.equal(out.length, 1);
  assert.equal(out[0].sets.length, 3);
  assert.equal(out[0].home_sets, 3);
  assert.throws(() => normalizeFipav({ matches: [m, m] }, t));
});
test('normalizza PGS, gare incomplete e validazione identità', () => {
  const t = {
    id: 'TEST:pgs',
    source: 'PGS',
    season: '2026-2027',
    competition: 'TEST',
    group_id: '4',
    official_team_id: 'our',
    name: 'TEST SQUADRA',
    category: 'U11',
  };
  const teams = [
    { id: 'our', nomeSquadra: t.name, categoria: 'U11' },
    { id: 'other', nomeSquadra: 'TEST AWAY' },
  ];
  const match = {
    id: 'TEST',
    squadraCasaID: 'our',
    squadraTrasfertaID: 'other',
    categoria: 'U11',
    codiceCampionato: 'TEST',
    numeroGara: '1',
    parzialiCasa: [],
    parzialiTrasferta: [],
  };
  assert.equal(normalizePgs([match], teams, t)[0].date, '');
  assert.throws(() => normalizePgs([{ ...match, categoria: 'U12' }], teams, t));
  assert.throws(() => normalizePgs([], teams, t));
});
test('hash salato con pepper, password errata e lunghezza minima', async () => {
  const h = await passwordHash('TEST-only-long-password', 'pepper');
  assert.ok(await verifyPassword('TEST-only-long-password', h, 'pepper'));
  assert.ok(!(await verifyPassword('TEST-only-long-password', h, 'different')));
  assert.ok(!(await verifyPassword('TEST-wrong-password', h, 'pepper')));
  assert.notEqual(h, await passwordHash('TEST-only-long-password', 'pepper'));
  assert.ok(await verifyPassword('1234', await passwordHash('1234', 'pepper'), 'pepper'));
  await assert.rejects(passwordHash('abc', 'pepper'));
});
test('registrazione automatica, entrambi i ruoli, nessuna impersonificazione', async () => {
  const db = new LocalD1(),
    env = envFor(db),
    adm = await loginAdmin(env);
  let r = await call(env, 'auth/register', {
    first_name: 'TEST',
    last_name: 'COLLAUDO',
    password: 'P123',
    wants_referee: true,
    wants_scorer: true,
    staging_consent: true,
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await call(env, 'auth/login', {
        first_name: 'TEST',
        last_name: 'COLLAUDO',
        password: 'P123',
      })
    ).status,
    200,
  );
  const person = await statement(
    db,
    'SELECT * FROM people WHERE first_name=? AND last_name=?',
    'TEST',
    'COLLAUDO',
  ).first();
  assert.equal(person.approved, 1);
  await call(
    env,
    'admin/person',
    { id: person.id, approved: true, wants_referee: true, wants_scorer: true, wants_manager:false, wants_coach:false },
    adm,
  );
  await game(db);
  const user = await userSession(db, person.id);
  const someone = await addPerson(db, 'TEST-someone');
  r = await call(
    env,
    'book',
    { game_key: GAME.game_key, role: 'referee', slot: 1, person_id: someone },
    user,
  );
  assert.equal(r.status, 201);
  assert.equal(
    (await statement(db, 'SELECT person_id FROM assignments').first()).person_id,
    person.id,
  );
  db.close();
});
test('due utenti concorrenti: esattamente una prenotazione', async () => {
  const db = new LocalD1();
  await game(db);
  const p1 = await addPerson(db, 'TEST-1'),
    p2 = await addPerson(db, 'TEST-2');
  const r = await Promise.allSettled([
    assign(db, GAME.game_key, 'referee', 1, p1),
    assign(db, GAME.game_key, 'referee', 1, p2),
  ]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await statement(db, 'SELECT count(*) n FROM assignments').first()).n, 1);
  db.close();
});
test('stessa persona: nessun doppio ruolo nella gara o sovrapposizione', async () => {
  const db = new LocalD1(),
    p = await addPerson(db);
  await game(db);
  await game(db, { game_key: 'TEST:overlap', time: '19:00' });
  await assign(db, GAME.game_key, 'referee', 1, p);
  await assert.rejects(assign(db, GAME.game_key, 'scorer', 1, p));
  await assert.rejects(assign(db, 'TEST:overlap', 'scorer', 1, p), /sovrapposto/);
  db.close();
});
test('revoca approvazione o ruolo impedisce nuove prenotazioni, trasferta non prenotabile', async () => {
  const db = new LocalD1(),
    p = await addPerson(db, 'TEST', 0);
  await game(db);
  await assert.rejects(assign(db, GAME.game_key, 'referee', 1, p), /abilitata/);
  await statement(db, 'UPDATE people SET approved=1 WHERE id=?', p).run();
  await game(db, {
    game_key: 'TEST:away',
    is_home: false,
    required_referees: 0,
    required_scorers: 0,
  });
  await assert.rejects(assign(db, 'TEST:away', 'referee', 1, p));
  db.close();
});
test('cambio orario dopo booking: conflitto bloccato atomicamente', async () => {
  const db = new LocalD1(),
    p = await addPerson(db);
  await game(db);
  await game(db, { game_key: 'TEST:second', time: '21:30' });
  await assign(db, GAME.game_key, 'referee', 1, p);
  await assign(db, 'TEST:second', 'scorer', 1, p);
  await assert.rejects(game(db, { game_key: 'TEST:second', time: '19:00' }));
  assert.equal(
    (await statement(db, 'SELECT time FROM games WHERE game_key=?', 'TEST:second').first()).time,
    '21:30',
  );
  assert.equal((await statement(db, 'SELECT count(*) n FROM assignments').first()).n, 2);
  db.close();
});
test('sync idempotente conserva override, booking, segnala gare scomparse senza cancellare', async () => {
  const db = new LocalD1(),
    p = await addPerson(db);
  await game(db);
  const initial = await statement(db, 'SELECT * FROM games').first();
  await saveGame(
    db,
    { ...GAME, venue: 'TEST CORREZIONE' },
    GAME,
    { venue: 'TEST CORREZIONE' },
    'PATTY',
  );
  await assign(db, GAME.game_key, 'referee', 1, p);
  const scope = 'FIPAV:2026-2027:63945';
  let r = await saveImport(db, [{ ...GAME, venue: 'TEST UFFICIALE' }], scope);
  assert.equal(r.conflicts, 1);
  assert.equal(
    JSON.parse((await statement(db, 'SELECT effective_json FROM games').first()).effective_json)
      .venue,
    'TEST CORREZIONE',
  );
  r = await saveImport(db, [{ ...GAME, venue: 'TEST UFFICIALE' }], scope);
  assert.equal(r.unchanged, 1);
  await saveImport(db, [{ ...GAME, game_key: 'TEST:new' }], scope);
  assert.equal(
    (
      await statement(
        db,
        'SELECT source_missing FROM games WHERE game_key=?',
        GAME.game_key,
      ).first()
    ).source_missing,
    1,
  );
  assert.equal((await statement(db, 'SELECT count(*) n FROM assignments').first()).n, 1);
  assert.equal(initial.game_key, GAME.game_key);
  db.close();
});
test('sync orario conflittuale conserva calendario precedente e segnala PATTY', async () => {
  const db = new LocalD1(),
    p = await addPerson(db);
  await game(db);
  await game(db, { game_key: 'TEST:second', time: '21:30' });
  await assign(db, GAME.game_key, 'referee', 1, p);
  await assign(db, 'TEST:second', 'scorer', 1, p);
  const r = await saveImport(
    db,
    [{ ...GAME, game_key: 'TEST:second', time: '19:00' }],
    'FIPAV:2026-2027:63945',
    false,
    false,
  );
  assert.equal(r.errors.length, 1);
  assert.equal(
    (await statement(db, 'SELECT time FROM games WHERE game_key=?', 'TEST:second').first()).time,
    '21:30',
  );
  db.close();
});
test('gare incomplete completate rientrano nella settimana corretta senza duplicati', async () => {
  const db = new LocalD1(),
    env = envFor(db),
    adm = await loginAdmin(env);
  await game(db, { date: '', time: '' });
  const r = await call(
    env,
    'admin/game',
    { game_key: GAME.game_key, patch: { date: '2030-01-06', time: '20:15' } },
    adm,
  );
  assert.equal(r.status, 200);
  assert.equal(weekStart(r.body.game.date), '2029-12-31');
  await saveImport(db, [{ ...GAME, date: '', time: '' }], 'FIPAV:2026-2027:63945');
  assert.equal((await statement(db, 'SELECT count(*) n FROM games').first()).n, 1);
  const g = JSON.parse(
    (await statement(db, 'SELECT effective_json FROM games').first()).effective_json,
  );
  assert.equal(g.time, '20:15');
  assert.equal(g.date, '2030-01-06');
  db.close();
});
test('fisso automatico, eccezione singola e cancellazione PATTY', async () => {
  const db = new LocalD1(),
    env = envFor(db),
    p = await addPerson(db);
  await game(db);
  await statement(db, 'INSERT INTO team_fixed VALUES(?,?,?)', GAME.team_id, 'referee', p).run();
  assert.equal((await applyFixed(db)).created, 1);
  const adm = await loginAdmin(env);
  assert.equal(
    (await call(env, 'cancel', { game_key: GAME.game_key, role: 'referee', slot: 1 }, adm)).status,
    200,
  );
  assert.equal((await applyFixed(db)).created, 0);
  assert.equal((await statement(db, 'SELECT count(*) n FROM fixed_exceptions').first()).n, 1);
  db.close();
});
test('API: protezione PATTY, CSRF, origine, sessione scaduta e cookie sicuri', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  assert.equal(
    (await worker.fetch(new Request('https://test.invalid/api/admin/state'), env)).status,
    403,
  );
  const auth = await loginAdmin(env);
  assert.equal((await call(env, 'admin/team', {}, { cookie: auth.cookie })).status, 403);
  const bad = new Request('https://test.invalid/api/auth/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal((await worker.fetch(bad, env)).status, 403);
  await statement(db, 'UPDATE sessions SET expires_at=?', Date.now() - 1).run();
  assert.equal(
    (
      await worker.fetch(
        new Request('https://test.invalid/api/admin/state', { headers: { cookie: auth.cookie } }),
        env,
      )
    ).status,
    403,
  );
  const r = await worker.fetch(
    post('auth/login', { admin: true, password: 'TEST-only-password-123' }),
    env,
  );
  assert.match(r.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  db.close();
});
test('limitazione accessi e dati fittizi obbligatori sullo staging', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  for (let i = 0; i < 8; i++)
    await call(env, 'auth/login', {
      first_name: 'MISSING',
      last_name: 'USER',
      password: 'P123',
    });
  assert.equal(
    (
      await call(env, 'auth/login', {
        first_name: 'MISSING',
        last_name: 'USER',
        password: 'P123',
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await call(env, 'auth/register', {
        first_name: 'TEST',
        last_name: 'TEST',
        password: '123',
        wants_referee: true,
        staging_consent: true,
      })
    ).status,
    400,
  );
  db.close();
});
test('backup fuori DB e ripristino su database isolato, integrità incarichi', async () => {
  const db = new LocalD1(),
    restore = new LocalD1();
  await game(db);
  const p = await addPerson(db);
  await assign(db, GAME.game_key, 'referee', 1, p);
  const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
  await restoreBackup(restore, backup);
  assert.equal((await statement(restore, 'SELECT count(*) n FROM assignments').first()).n, 1);
  assert.equal(
    (await statement(restore, 'SELECT email FROM people').first()).email,
    p + '@example.invalid',
  );
  assert.equal(
    (await statement(restore, 'SELECT effective_json FROM games').first()).effective_json,
    (await statement(db, 'SELECT effective_json FROM games').first()).effective_json,
  );
  await assert.rejects(restoreBackup(db, backup), /vuoto/);
  db.close();
  restore.close();
});
test('20 squadre configurabili senza modificare codice, sync a piccoli passi e derby deduplicati', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  await statement(db, 'UPDATE teams SET active=0').run();
  const matches = [];
  for (let i = 0; i < 20; i++) {
    const t = {
      ...validateTeam({
        source: 'FIPAV',
        season: '2030-2031',
        group_id: '123',
        official_team_id: String(100 + i),
        name: 'TEST TEAM ' + i,
        category: 'U17',
        short_name: 'TEST ' + i,
      }),
      id: 'TEST:' + i,
    };
    await statement(
      db,
      'INSERT INTO teams(id,source,season,group_id,official_team_id,name,category,short_name) VALUES(?,?,?,?,?,?,?,?)',
      t.id,
      t.source,
      t.season,
      t.group_id,
      t.official_team_id,
      t.name,
      t.category,
      t.short_name,
    ).run();
    matches.push({
      id: 'TEST-match-' + i,
      team1: { id: t.official_team_id, title: t.name },
      team2: { id: '999', title: 'TEST AWAY' },
      date: '05/01/2031',
      time: '18:00',
      pt_a: [],
      pt_b: [],
    });
  }
  let fetches = 0;
  env.FETCH = async () => {
    fetches++;
    return new Response(JSON.stringify({ matches }));
  };
  const job = await syncScope(env, 'FIPAV:2030-2031:123');
  let result;
  do {
    db.calls = 0;
    result = await syncStep(env, job.job_id);
    assert.ok(db.calls < 50, 'limite query Free: ' + db.calls);
  } while (!result.done);
  assert.equal(fetches, 1);
  assert.equal(result.total, 20);
  assert.equal((await statement(db, 'SELECT count(*) n FROM games').first()).n, 20);
  db.close();
});
test('fonte indisponibile e JSON errato non cancellano archivio', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  await game(db);
  env.FETCH = async () => new Response('blocked', { status: 403 });
  await assert.rejects(syncScope(env, 'FIPAV:2026-2027:63945'));
  assert.equal((await statement(db, 'SELECT count(*) n FROM games').first()).n, 1);
  env.FETCH = async () => new Response('invalid-json');
  await assert.rejects(syncScope(env, 'FIPAV:2026-2027:63945'));
  assert.equal((await statement(db, 'SELECT count(*) n FROM games').first()).n, 1);
  db.close();
});
test('dopo giorni di inattività i dati dipendono solo da D1, non dalla memoria del Worker', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  await game(db);
  const r = await worker.fetch(new Request('https://test.invalid/api/calendar'), env);
  assert.equal((await r.json()).games.length, 1);
  const fresh = await import('../worker/index.mjs?fresh=' + Date.now());
  const r2 = await fresh.default.fetch(new Request('https://test.invalid/api/calendar'), env);
  assert.equal((await r2.json()).games.length, 1);
  db.close();
});
test('validazione patch e identificativi squadra, nessun campo tecnico alterabile', () => {
  assert.throws(() => validatePatch({ game_key: 'injection' }));
  assert.throws(() => validatePatch({ required_referees: -1 }));
  assert.throws(() => validatePatch({ hidden: 'false' }));
  assert.throws(() =>
    validateTeam({
      source: 'PGS',
      season: '2026-2027',
      official_team_id: 'a/../',
      name: 'TEST',
      category: 'U11',
      short_name: 'TEST',
    }),
  );
});
test('ripristino 400 gare su DB isolato in blocchi entro 50 query e ripristino guardie', async () => {
  const { startRecovery, recoveryStep } = await import('../worker/index.mjs');
  const db = new LocalD1(),
    target = new LocalD1();
  await addPerson(db);
  for (let i = 0; i < 400; i++) await game(db, { game_key: 'TEST:restore:' + i });
  const backup = await exportBackup(db);
  const job = await startRecovery(target, backup);
  let r;
  do {
    target.calls = 0;
    r = await recoveryStep(target, job.job_id);
    assert.ok(target.calls < 50);
  } while (!r.done);
  assert.equal((await statement(target, 'SELECT count(*) n FROM games').first()).n, 400);
  assert.equal(
    (await statement(target, "SELECT count(*) n FROM sqlite_master WHERE type='trigger'").first())
      .n,
    6,
  );
  assert.equal((await statement(target, 'PRAGMA foreign_key_check').all()).results.length, 0);
  await statement(target, 'UPDATE people SET approved=0').run();
  await assert.rejects(assign(target, 'TEST:restore:0', 'referee', 1, 'TEST-person'));
  db.close();
  target.close();
});
test('concorrenza correzioni: versione vecchia non sovrascrive la nuova', async () => {
  const db = new LocalD1();
  await game(db);
  const old = await statement(db, 'SELECT * FROM games').first();
  await saveGame(
    db,
    { ...GAME, venue: 'TEST NEW' },
    GAME,
    { venue: 'TEST NEW' },
    'PATTY',
    'test',
    old.version,
  );
  await assert.rejects(
    saveGame(
      db,
      { ...GAME, venue: 'TEST STALE' },
      GAME,
      { venue: 'TEST STALE' },
      'PATTY',
      'test',
      old.version,
    ),
    /altro aggiornamento/,
  );
  assert.equal(
    JSON.parse((await statement(db, 'SELECT effective_json FROM games').first()).effective_json)
      .venue,
    'TEST NEW',
  );
  db.close();
});
test('ora inesistente al cambio legale viene rifiutata', () =>
  assert.throws(() => interval({ ...GAME, date: '2030-03-31', time: '02:30' }), /ora legale/));
test('sync Free: budget query rispettato anche con entrambi i ruoli FISSI su 20 squadre', async () => {
  const db = new LocalD1(),
    env = envFor(db),
    ref = await addPerson(db, 'TEST-fixed-ref'),
    scorer = await addPerson(db, 'TEST-fixed-scorer');
  await statement(db, 'UPDATE teams SET active=0').run();
  const matches = [];
  for (let i = 0; i < 20; i++) {
    const id = 'TEST:budget:' + i;
    await statement(
      db,
      'INSERT INTO teams(id,source,season,group_id,official_team_id,name,category,short_name) VALUES(?,?,?,?,?,?,?,?)',
      id,
      'FIPAV',
      '2031-2032',
      '123',
      String(100 + i),
      'TEST TEAM ' + i,
      'U17',
      'TEST ' + i,
    ).run();
    await statement(db, 'INSERT INTO team_fixed VALUES(?,?,?)', id, 'referee', ref).run();
    await statement(db, 'INSERT INTO team_fixed VALUES(?,?,?)', id, 'scorer', scorer).run();
    matches.push({
      id: 'TEST-match-' + i,
      team1: { id: String(100 + i), title: 'TEST TEAM ' + i },
      team2: { id: '999', title: 'TEST AWAY' },
      date: `${String(i + 1).padStart(2, '0')}/01/2031`,
      time: '18:00',
      pt_a: [],
      pt_b: [],
    });
  }
  env.FETCH = async () => new Response(JSON.stringify({ matches }));
  const job = await syncScope(env, 'FIPAV:2031-2032:123');
  let result;
  do {
    db.calls = 0;
    result = await syncStep(env, job.job_id);
    assert.ok(db.calls < 45, 'query più margine auth/telemetria: ' + db.calls);
  } while (!result.done);
  assert.equal((await statement(db, 'SELECT count(*) n FROM assignments').first()).n, 40);
  db.close();
});

test('correzione PATTY di una gara assente non riapre le prenotazioni', async () => {
  const db = new LocalD1();
  await game(db);
  await statement(db, 'UPDATE games SET source_missing=1 WHERE game_key=?', GAME.game_key).run();
  await saveGame(
    db,
    { ...GAME, notes: 'TEST correzione' },
    GAME,
    { notes: 'TEST correzione' },
    'PATTY',
  );
  assert.equal(
    (
      await statement(
        db,
        'SELECT source_missing FROM games WHERE game_key=?',
        GAME.game_key,
      ).first()
    ).source_missing,
    1,
  );
  const p = await addPerson(db);
  await assert.rejects(assign(db, GAME.game_key, 'referee', 1, p));
  await saveImport(db, [GAME], 'FIPAV:2026-2027:63945');
  assert.equal(
    (
      await statement(
        db,
        'SELECT source_missing FROM games WHERE game_key=?',
        GAME.game_key,
      ).first()
    ).source_missing,
    0,
  );
  await assign(db, GAME.game_key, 'referee', 1, p);
  db.close();
});

test('annullamento concorrente non rimuove un incarico appena riassegnato a un altro utente', async () => {
  const db = new LocalD1(),
    env = envFor(db);
  await game(db);
  const p = await addPerson(db, 'TEST-original'),
    replacement = await addPerson(db, 'TEST-replacement');
  await assign(db, GAME.game_key, 'referee', 1, p);
  const auth = await userSession(db, p),
    originalBatch = db.batch.bind(db);
  let injected = false;
  db.batch = async (queries) => {
    if (!injected && queries.some((q) => q.sql.includes('INSERT INTO cancellation_guards'))) {
      injected = true;
      db.db.prepare('DELETE FROM assignments WHERE game_key=?').run(GAME.game_key);
      db.db
        .prepare('INSERT INTO assignments VALUES(?,?,?,?,?,?)')
        .run(GAME.game_key, 'referee', 1, replacement, 'patty', new Date().toISOString());
    }
    return originalBatch(queries);
  };
  const response = await call(
    env,
    'cancel',
    { game_key: GAME.game_key, role: 'referee', slot: 1 },
    auth,
  );
  assert.equal(response.status, 409);
  assert.equal(
    (await statement(db, 'SELECT person_id FROM assignments').first()).person_id,
    replacement,
  );
  assert.equal((await statement(db, 'SELECT count(*) n FROM cancellation_guards').first()).n, 0);
  db.close();
});

test('Nome/cognome e codice: univocità e approvazione', async()=>{
 const db=new LocalD1(),env=envFor(db);
 const data={first_name:'SIMONA',last_name:'PROVA',password:'P123',wants_referee:true,wants_scorer:false,staging_consent:true};
 assert.equal((await call(env,'auth/register',data)).status,201);
 assert.equal((await call(env,'auth/register',{...data,first_name:'simona'})).status,409);
 assert.equal((await call(env,'auth/login',{...data,password:'1234'})).status,401);
 const person=await statement(db,"SELECT * FROM people WHERE first_name='SIMONA'").first();
 assert.equal(person.approved,1);
 const admin=await loginAdmin(env);
 assert.equal((await call(env,'admin/person',{id:person.id,approved:true,wants_referee:true,wants_scorer:false,wants_manager:false,wants_coach:false},admin)).status,200);
 assert.equal((await call(env,'auth/login',data)).status,200);
 db.close();
});
test('PATTY: passa al codice corto, vecchia password non utilizzabile',async()=>{
 const db=new LocalD1(),env=envFor(db),admin=await loginAdmin(env);
 assert.equal((await call(env,'admin/pin',{pin:'123',confirm:'123'},admin)).status,400);
 assert.equal((await call(env,'admin/pin',{pin:'A123',confirm:'B123'},admin)).status,400);
 assert.equal((await call(env,'admin/pin',{pin:'A123',confirm:'A123'},admin)).status,200);
 assert.equal((await call(env,'auth/login',{admin:true,password:'TEST-only-password-123'})).status,401);
 assert.equal((await call(env,'auth/login',{admin:true,password:'A123'})).status,200);
 db.close();
});

test('riconoscimento personale permanente, rinnovo vecchio accesso, uscita e PATTY separata', async () => {
  const db = new LocalD1(), env = envFor(db), admin = await loginAdmin(env);
  const data = { first_name:'LUCA', last_name:'PROVA', password:'L123', wants_referee:true, wants_scorer:true, staging_consent:true };
  assert.equal((await call(env, 'auth/register', data)).status, 201);
  const person = await statement(db, "SELECT id FROM people WHERE first_name='LUCA'").first();
  assert.equal((await call(env, 'admin/person', { id:person.id, approved:true, wants_referee:true, wants_scorer:true, wants_manager:false, wants_coach:false }, admin)).status, 200);
  const login = await worker.fetch(post('auth/login', data), env);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Max-Age=34560000/);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await statement(db,'SELECT expires_at FROM sessions WHERE person_id=?',person.id).first()).expires_at,253402300799000);
  await statement(db,'UPDATE sessions SET expires_at=? WHERE person_id=?',Date.now()+60000,person.id).run();
  const me=await worker.fetch(new Request('https://test.invalid/api/me',{headers:{Cookie:cookie}}),env);
  const payload=await me.json();
  assert.equal(payload.user.first_name,'LUCA');
  assert.match(me.headers.get('set-cookie'),/Max-Age=34560000/);
  assert.equal((await statement(db,'SELECT expires_at FROM sessions WHERE person_id=?',person.id).first()).expires_at,253402300799000);
  const second=await worker.fetch(new Request('https://test.invalid/api/me',{headers:{Cookie:cookie}}),env);
  assert.equal((await second.json()).user.last_name,'PROVA');
  const logout=await worker.fetch(post('auth/logout',{},cookie,payload.csrf),env);
  assert.equal(logout.status,200);
  const loggedOut=await worker.fetch(new Request('https://test.invalid/api/me',{headers:{Cookie:cookie}}),env);
  assert.equal((await loggedOut.json()).user,null);
  const patty=await worker.fetch(post('auth/login',{admin:true,password:'TEST-only-password-123'}),env);
  assert.match(patty.headers.get('set-cookie'),/Max-Age=1800/);
  db.close();
});

test('dirigente e allenatore accedono senza approvazione e possono prenotare',async()=>{
 const db=new LocalD1(),env=envFor(db);await game(db);
 for(const [name,flag,role] of [['DIRIGENTE','wants_manager','referee'],['ALLENATORE','wants_coach','scorer']]){
  const p={first_name:'TEST',last_name:name,password:'A123',wants_referee:false,wants_scorer:false,wants_manager:flag==='wants_manager',wants_coach:flag==='wants_coach',staging_consent:true};
  const res=await worker.fetch(post('auth/register',p),env);assert.equal(res.status,200);
  const person=await statement(db,'SELECT * FROM people WHERE last_name=?',name).first();
  assert.equal(person.approved,1);assert.equal(person[flag],1);
  assert.equal(person.wants_referee,0);assert.equal(person.wants_scorer,0);
  const me=await worker.fetch(new Request('https://test.invalid/api/me',{headers:{Cookie:res.headers.get('set-cookie').split(';')[0]}}),env);
  assert.equal((await me.json()).user[flag],true);
  await assign(db,GAME.game_key,role,1,person.id);
 }
 assert.equal((await statement(db,'SELECT count(*) n FROM assignments').first()).n,2);
 db.close();
});
