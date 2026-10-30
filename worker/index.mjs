import { ASSETS } from './assets.mjs';
import {
  clean,
  fail,
  dateISO,
  hour,
  today,
  interval,
  scopeFor,
  normalizeFipav,
  normalizePgs,
  mergeGame,
  validatePatch,
  validateTeam,
  EDITABLE,
} from './domain.mjs';
export const RELEASE = 'cf-staging-2026-10-27.11';
const enc = new TextEncoder();
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
export const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha = async (v) => hex(await crypto.subtle.digest('SHA-256', enc.encode(v)));
async function identityKey(first, last) {
  const norm = (v) => clean(v).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('it');
  return (await sha(JSON.stringify([norm(first), norm(last)]))) + '@example.invalid';
}
const validCode = (v) => typeof v === 'string' && /^[A-Za-z0-9]{4}$/.test(v);
export function equal(a, b) {
  const x = enc.encode(a || ''),
    y = enc.encode(b || '');
  let n = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) n |= (x[i] || 0) ^ (y[i] || 0);
  return n === 0;
}
async function peppered(password, pepper) {
  if (!pepper) fail('Accessi non ancora configurati.', 503);
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(password));
}
// WebCrypto Workers supports at most 100000 PBKDF2 iterations. A separate secret
// pepper protects a stolen D1 export; never store it beside password records.
export async function passwordHash(password, pepper, salt = random().slice(0, 32)) {
  if (typeof password !== 'string' || password.length < 4 || password.length > 256)
    fail('Il codice deve avere almeno 4 caratteri.');
  const k = await crypto.subtle.importKey(
    'raw',
    await peppered(password, pepper),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const digest = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt: fromHex(salt), iterations: 100000 },
    k,
    512,
  );
  return `pbkdf2_sha512_peppered:100000:${salt}:${hex(digest)}`;
}
export async function verifyPassword(password, record, pepper) {
  try {
    const [alg, n, salt] = record.split(':');
    if (alg !== 'pbkdf2_sha512_peppered' || n !== '100000') return false;
    return equal(await passwordHash(password, pepper, salt), record);
  } catch {
    return false;
  }
}
export const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);
async function all(db, sql, ...p) {
  return (await statement(db, sql, ...p).all()).results;
}
async function one(db, sql, ...p) {
  return statement(db, sql, ...p).first();
}
const at = () => new Date().toISOString();
const json = (v, status = 200, headers = {}) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
export const audit = (db, actor, action, key, details) =>
  statement(
    db,
    'INSERT INTO audit(actor,action,game_key,details,changed_at) VALUES(?,?,?,?,?)',
    actor,
    action,
    key,
    JSON.stringify(details),
    at(),
  );
async function body(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    fail('Formato JSON richiesto.', 415);
  if (Number(req.headers.get('content-length') || 0) > 1000000)
    fail('Richiesta troppo grande.', 413);
  const raw = await req.text();
  if (raw.length > 1000000) fail('Richiesta troppo grande.', 413);
  try {
    return JSON.parse(raw);
  } catch {
    fail('JSON non valido.');
  }
}
// Riconoscimento continuo sullo stesso dispositivo, fino a Esci o revoca PATTY.
// I browser possono limitare i cookie a 400 giorni: li rinnoviamo a ogni apertura.
const PERSONAL_COOKIE_SECONDS = 400 * 24 * 60 * 60;
// PATTY: scadenza mobile, rinnovata dall'attività reale nell'app.
const PATTY_SESSION_MS = 30 * 60 * 1000;
const PATTY_RENEW_WINDOW_MS = 15 * 60 * 1000;
const PERSONAL_SESSION_EXPIRES = 253402300799000; // fine anno 9999
const sessionCookie = (token, seconds) =>
  `__Host-vc=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
const sessionToken = (req) =>
  (req.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('__Host-vc='))
    ?.slice(10);
export async function authenticate(req, env) {
  const token = sessionToken(req);
  if (!token) return null;
  const s = await one(
    env.DB,
    'SELECT s.*, p.approved,p.can_access_patty,p.wants_referee,p.wants_scorer,p.wants_manager,p.wants_coach,p.first_name,p.last_name FROM sessions s LEFT JOIN people p ON p.id=s.person_id WHERE token_hash=? AND expires_at>?',
    await sha(token),
    Date.now(),
  );
  if (!s || (!s.admin && !s.approved)) return null;
  if (s.person_id) {
    // L'accesso delegato scade dopo inattività, senza perdere l'accesso personale.
    if (!s.approved) return null;
    if (s.admin && (!s.can_access_patty || s.patty_expires_at <= Date.now())) s.admin = 0;
  }
  return s;
}
function admin(s) {
  if (!s?.admin) fail('Accesso PATTY richiesto.', 403);
}
function pattyOwner(s) {
  admin(s);
  if (s.person_id) fail('Questa impostazione è riservata alla PATTY principale.', 403);
}
function csrf(req, s) {
  if (!s || !equal(req.headers.get('x-csrf-token'), s.csrf))
    fail('Sessione scaduta. Accedi nuovamente.', 403);
}
async function throttle(env, req, label, max = 8) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const key = await sha(label + ':' + ip + ':' + Math.floor(Date.now() / 900000));
  const r = await statement(
    env.DB,
    'INSERT INTO attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    key,
    Date.now() + 900000,
  ).first();
  if (r.count > max) fail('Troppi tentativi. Riprova tra 15 minuti.', 429);
}
async function sessionReply(env, person_id, isAdmin) {
  const token = random(),
    csrfToken = random();
  const expires = isAdmin ? Date.now() + PATTY_SESSION_MS : PERSONAL_SESSION_EXPIRES;
  await env.DB.batch([
    statement(env.DB, 'DELETE FROM sessions WHERE expires_at<?', Date.now()),
    statement(env.DB, 'DELETE FROM attempts WHERE expires_at<?', Date.now()),
    statement(
      env.DB,
      'INSERT INTO sessions(token_hash,person_id,admin,csrf,expires_at) VALUES(?,?,?,?,?)',
      await sha(token),
      person_id,
      isAdmin ? 1 : 0,
      csrfToken,
      expires,
    ),
  ]);
  return json({ ok: true, csrf: csrfToken, admin: isAdmin }, 200, {
    'Set-Cookie': sessionCookie(token, isAdmin ? PATTY_SESSION_MS / 1000 : PERSONAL_COOKIE_SECONDS),
  });
}
export function gameValues(g, scope, official, overrides = {}, sourceMissing = 0) {
  const [start, end] = interval(g);
  return [
    g.game_key,
    g.team_id,
    g.source,
    g.season,
    scope,
    JSON.stringify(official),
    JSON.stringify(overrides),
    JSON.stringify(g),
    g.date || '',
    g.time || '',
    g.is_home ? 1 : 0,
    g.hidden ? 1 : 0,
    start,
    end,
    g.required_referees || 0,
    g.required_scorers || 0,
    at(),
    at(),
    sourceMissing ? 1 : 0,
  ];
}
const UPSERT_GAME = `INSERT INTO games(game_key,team_id,source,season,scope,official_json,overrides_json,effective_json,date,time,is_home,hidden,start_ts,end_ts,required_referees,required_scorers,created_at,updated_at,source_missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(game_key) DO UPDATE SET team_id=excluded.team_id,official_json=excluded.official_json,overrides_json=excluded.overrides_json,effective_json=excluded.effective_json,date=excluded.date,time=excluded.time,is_home=excluded.is_home,hidden=excluded.hidden,start_ts=excluded.start_ts,end_ts=excluded.end_ts,required_referees=excluded.required_referees,required_scorers=excluded.required_scorers,source_missing=excluded.source_missing,updated_at=excluded.updated_at,version=games.version+1 WHERE games.version=?`;
export async function saveGame(
  db,
  g,
  official,
  overrides,
  actor = 'sync',
  reason = '',
  expectedVersion = null,
) {
  const scope = scopeFor({
    source: g.source,
    season: g.season,
    group_id: g.group_id,
    competition: official.competition || g.competition,
  });
  const prior = await one(
    db,
    'SELECT version,source_missing FROM games WHERE game_key=?',
    g.game_key,
  );
  const version = expectedVersion ?? prior?.version ?? -1;
  let results;
  try {
    results = await db.batch([
      statement(
        db,
        'INSERT INTO write_guards(game_key,expected_version) VALUES(?,?)',
        g.game_key,
        version,
      ),
      statement(
        db,
        UPSERT_GAME,
        ...gameValues(g, scope, official, overrides, prior?.source_missing || 0),
        version,
      ),
      audit(db, actor, actor === 'sync' ? 'source_updated' : 'game_modified', g.game_key, {
        overrides,
        reason,
      }),
      statement(db, 'DELETE FROM write_guards WHERE game_key=?', g.game_key),
    ]);
  } catch (e) {
    if (/STALE_WRITE/.test(String(e))) fail(dbMessage(e), 409);
    throw e;
  }
  if (!results[1].meta.changes)
    fail('Gara modificata da un altro aggiornamento. Ricarica e riprova.', 409);
}
export async function saveImport(db, incoming, scope, resultsOnly = false, markMissing = true) {
  const old = await all(db, 'SELECT * FROM games WHERE scope=?', scope);
  const map = new Map(old.map((x) => [x.game_key, x]));
  const counts = { inserted: 0, updated: 0, unchanged: 0, conflicts: 0, missing: 0, errors: [] };
  // One atomic D1 batch per game, in sequential chunks at the HTTP layer. Never
  // depend on a read-before-write to protect booking integrity (SQL triggers do).
  for (const g of incoming) {
    const current = map.get(g.game_key);
    if (resultsOnly && !current) continue;
    const m = mergeGame(current, g, resultsOnly);
    if (
      current &&
      current.official_json === JSON.stringify(m.official) &&
      !current.source_missing
    ) {
      counts.unchanged++;
      continue;
    }
    try {
      const queries = [
        statement(
          db,
          'INSERT INTO write_guards(game_key,expected_version) VALUES(?,?)',
          g.game_key,
          current?.version ?? -1,
        ),
        statement(
          db,
          UPSERT_GAME,
          ...gameValues(m.effective, scope, m.official, m.overrides),
          current?.version ?? -1,
        ),
        statement(db, 'DELETE FROM import_conflicts WHERE game_key=?', g.game_key),
        audit(db, 'sync', 'source_updated', g.game_key, { resultsOnly }),
      ];
      if (m.conflicts.length)
        queries.push(
          statement(
            db,
            `INSERT INTO import_conflicts(game_key,field,incoming,detected_at) SELECT ?,json_extract(value,'$.field'),json_extract(value,'$.incoming'),? FROM json_each(?)`,
            g.game_key,
            at(),
            JSON.stringify(m.conflicts),
          ),
        );
      queries.push(statement(db, 'DELETE FROM write_guards WHERE game_key=?', g.game_key));
      const saved = await db.batch(queries);
      if (!saved[1].meta.changes) {
        counts.errors.push({
          game_key: g.game_key,
          error: 'Modifica contemporanea: aggiornamento rinviato, correzioni conservate.',
        });
        continue;
      }
      counts[current ? 'updated' : 'inserted']++;
      counts.conflicts += m.conflicts.length;
    } catch (e) {
      counts.errors.push({ game_key: g.game_key, error: dbMessage(e) });
      await statement(
        db,
        'INSERT INTO import_conflicts(game_key,field,incoming,detected_at) VALUES(?,?,?,?) ON CONFLICT(game_key,field) DO UPDATE SET incoming=excluded.incoming,detected_at=excluded.detected_at',
        g.game_key,
        'schedule_booking_conflict',
        JSON.stringify(g),
        at(),
      ).run();
    }
  }
  if (markMissing && !resultsOnly && incoming.length) {
    const keys = JSON.stringify(incoming.map((g) => g.game_key));
    const r = await statement(
      db,
      `UPDATE games SET source_missing=1,version=version+1 WHERE scope=? AND source_missing=0 AND game_key NOT IN(SELECT value FROM json_each(?))`,
      scope,
      keys,
    ).run();
    counts.missing = r.meta.changes;
  }
  return counts;
}
export function dbMessage(e) {
  const m = String(e);
  if (/STALE_WRITE/.test(m))
    return 'Gara modificata da un altro aggiornamento. Ricarica e riprova.';
  if (/free tier daily|daily row (read|write) limit/i.test(m))
    return 'Quota gratuita condivisa dell’account raggiunta. Riprova dopo il ripristino giornaliero delle quote (00:00 UTC). Nessun upgrade viene attivato.';
  if (/TIME_CONFLICT|MOVE_BOOKING_CONFLICT/.test(m))
    return 'La persona è già impegnata in una partita con orario sovrapposto.';
  if (/REMOVE_ASSIGNMENTS_FIRST/.test(m))
    return 'Rimuovi prima gli incarichi incompatibili con questa modifica.';
  if (/FEDERAL_SLOT/.test(m)) return 'Posto coperto da un ufficiale federale: prenotazione non consentita.';
  if (/FEDERAL_CONFLICT/.test(m)) return 'Prima di indicare Federale, PATTY deve rimuovere gli incarichi già assegnati per quel ruolo.';
  if (/PERSON_NOT_ELIGIBLE/.test(m)) return 'Persona non approvata o non abilitata al ruolo.';
  if (/GAME_NOT_BOOKABLE/.test(m)) return 'Gara o posto non prenotabile.';
  if (/UNIQUE constraint/.test(m))
    return 'Posto già occupato, persona già incaricata o dato già presente.';
  return 'Operazione non riuscita. I dati precedenti sono conservati.';
}
export async function assign(db, key, role, slot, pid, source = 'self', actor = pid) {
  if (!['referee', 'scorer'].includes(role) || !Number.isInteger(slot))
    fail('Ruolo o posto non valido.');
  const g = await one(db, 'SELECT start_ts,effective_json FROM games WHERE game_key=?', key);
  if (!g || g.start_ts <= Date.now()) fail('Prenotazione consentita soltanto per gare future.');
  if (JSON.parse(g.effective_json || '{}')['federal_' + role])
    fail('Posto coperto da un ufficiale federale: prenotazione non consentita.', 409);
  try {
    await db.batch([
      statement(
        db,
        'INSERT INTO assignments(game_key,role,slot,person_id,source,created_at) VALUES(?,?,?,?,?,?)',
        key,
        role,
        slot,
        pid,
        source,
        at(),
      ),
      audit(db, actor, 'booking_request', key, { role, slot, person_id: pid, source }),
    ]);
  } catch (e) {
    fail(dbMessage(e), 409);
  }
}
export async function applyFixed(db, teamId = null, keys = null) {
  const games = await all(
    db,
    'SELECT game_key,team_id,effective_json FROM games WHERE is_home=1 AND hidden=0 AND source_missing=0 AND start_ts>?' +
      (teamId ? ' AND team_id=?' : ''),
    ...[Date.now(), ...(teamId ? [teamId] : [])],
  );
  const fixed = await all(db, 'SELECT * FROM team_fixed');
  const report = { created: 0, conflicts: [] };
  for (const g of games.filter((g) => !keys || keys.includes(g.game_key))) {
    for (const f of fixed.filter((x) => x.team_id === g.team_id)) {
      if (JSON.parse(g.effective_json || '{}')['federal_' + f.role]) continue;
      if (
        (await one(
          db,
          'SELECT 1 FROM fixed_exceptions WHERE game_key=? AND role=?',
          g.game_key,
          f.role,
        )) ||
        (await one(db, 'SELECT 1 FROM assignments WHERE game_key=? AND role=?', g.game_key, f.role))
      )
        continue;
      try {
        await assign(db, g.game_key, f.role, 1, f.person_id, 'fixed', 'PATTY-AUTO');
        report.created++;
      } catch (e) {
        report.conflicts.push({ game_key: g.game_key, role: f.role, error: e.message });
      }
    }
  }
  return report;
}
async function fetchJSON(url, fetcher = fetch) {
  const r = await fetcher(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'VolleyControl/1.0' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) fail('Fonte non disponibile (HTTP ' + r.status + ').', 502);
  try {
    return await r.json();
  } catch {
    fail('La fonte non ha restituito un calendario valido.', 502);
  }
}

const rosterNameKey = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toUpperCase().replace(/[^A-Z0-9]/g,'');
// Nelle iscrizioni PGS "U21F"/"Under 21 Femminile" sono la
// categoria femminile che nell'archivio utente è indicata "U21".
// "U21M" rimane SEMPRE diversa: mai collegare un campionato maschile.
const rosterCategoryKey = (s) => {
  const v=clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'');
  const category=v.match(/^(?:UNDER|U)(\d{1,2})(F|FEMMINILE|M|MASCHILE)?$/);
  if (!category) return v;
  return 'U'+Number(category[1])+(category[2]&&category[2].startsWith('M')?'M':'F');
};
const rosterMatch = (r,c) => rosterNameKey(r.name)===rosterNameKey(c.name) &&
  rosterCategoryKey(r.category)===rosterCategoryKey(c.category);
export async function syncScope(env, scope, resultsOnly = false) {
  const teams = (await all(env.DB, 'SELECT * FROM teams WHERE active=1')).filter(
    (t) => scopeFor(t) === scope,
  );
  if (!teams.length) fail('Nessuna squadra per questo calendario.');
  const token = random(),
    now = Date.now();
  const lock = await statement(
    env.DB,
    'INSERT INTO sync_locks(scope,token,expires_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at<? RETURNING token',
    scope,
    token,
    now + 600000,
    now,
  ).first();
  if (!lock) fail('Aggiornamento già in corso. Riprova tra poco.', 409);
  try {
    const last = await one(
      env.DB,
      'SELECT at FROM sync_runs WHERE scope=? AND error IS NULL',
      scope,
    );
    if (last && Date.now() - Date.parse(last.at) < 30000)
      fail('Calendario appena aggiornato. Attendi 30 secondi.', 429);
    const t = teams[0],
      fetcher = env.FETCH || fetch;
    let games = [];
    if (t.source === 'FIPAV') {
      const payload = await fetchJSON(
        'https://data.fipavonline.it/api/v2/calendar/0/' + t.group_id,
        fetcher,
      );
      for (const team of teams) games.push(...normalizeFipav(payload, team));
    } else {
      const base = 'https://volley.pgsmilano.org/api/';
      const registrations = await fetchJSON(
        base + 'iscrizioni/campionato/' + t.competition,
        fetcher,
      );
      const matches = await fetchJSON(base + 'calendari/campionato/' + t.competition, fetcher);
      for (const team of teams) games.push(...normalizePgs(matches, registrations, team));
    }
    const unique = new Map();
    for (const g of games) if (!unique.has(g.game_key) || g.is_home) unique.set(g.game_key, g);
    await statement(
      env.DB,
      'INSERT INTO sync_jobs(id,scope,results_only,payload_json,created_at) VALUES(?,?,?,?,?)',
      token,
      scope,
      +resultsOnly,
      JSON.stringify([...unique.values()]),
      at(),
    ).run();
    return { job_id: token, total: unique.size };
  } catch (e) {
    await env.DB.batch([
      statement(env.DB, 'DELETE FROM sync_locks WHERE scope=? AND token=?', scope, token),
      statement(
        env.DB,
        'INSERT INTO sync_runs(scope,at,report,error) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET at=excluded.at,error=excluded.error',
        scope,
        at(),
        '{}',
        e.message || 'Errore fonte',
      ),
    ]);
    throw e;
  }
}
export async function syncStep(env, id) {
  const job = await one(env.DB, 'SELECT * FROM sync_jobs WHERE id=?', id);
  if (!job) fail('Aggiornamento non trovato.', 404);
  const lock = await one(
    env.DB,
    'SELECT token FROM sync_locks WHERE scope=? AND token=? AND expires_at>?',
    job.scope,
    id,
    Date.now(),
  );
  if (!lock) fail('Aggiornamento scaduto. Riavvia da PATTY.', 409);
  const games = JSON.parse(job.payload_json),
    chunk = games.slice(job.offset, job.offset + 2);
  const report = await saveImport(env.DB, chunk, job.scope, !!job.results_only, false);
  if (!job.results_only)
    report.fixed = await applyFixed(
      env.DB,
      null,
      chunk.map((g) => g.game_key),
    );
  const total = JSON.parse(job.report_json);
  for (const k of ['inserted', 'updated', 'unchanged', 'conflicts', 'missing'])
    total[k] = (total[k] || 0) + (report[k] || 0);
  total.errors = [...(total.errors || []), ...report.errors];
  total.fixed_conflicts = [...(total.fixed_conflicts || []), ...(report.fixed?.conflicts || [])];
  const offset = job.offset + chunk.length,
    done = offset >= games.length;
  const q = [];
  if (done) {
    if (!job.results_only)
      q.push(
        statement(
          env.DB,
          'UPDATE games SET source_missing=1,version=version+1 WHERE scope=? AND source_missing=0 AND game_key NOT IN(SELECT value FROM json_each(?))',
          job.scope,
          JSON.stringify(games.map((g) => g.game_key)),
        ),
      );
    q.push(
      statement(
        env.DB,
        'INSERT INTO sync_runs(scope,at,report,error) VALUES(?,?,?,NULL) ON CONFLICT(scope) DO UPDATE SET at=excluded.at,report=excluded.report,error=NULL',
        job.scope,
        at(),
        JSON.stringify(total),
      ),
      statement(env.DB, 'DELETE FROM sync_jobs WHERE id=?', id),
      statement(env.DB, 'DELETE FROM sync_locks WHERE scope=? AND token=?', job.scope, id),
    );
  } else
    q.push(
      statement(
        env.DB,
        'UPDATE sync_jobs SET offset=?,report_json=? WHERE id=? AND offset=?',
        offset,
        JSON.stringify(total),
        id,
        job.offset,
      ),
    );
  await env.DB.batch(q);
  return { done, offset, total: games.length, report: total };
}

async function calendar(db) {
  const [rows, teams, assignments] = await Promise.all([
    all(db, 'SELECT effective_json,source_missing FROM games ORDER BY date,time'),
    all(db, 'SELECT * FROM teams'),
    all(
      db,
      'SELECT a.game_key,a.role,a.slot,a.person_id,a.source,p.first_name,p.last_name FROM assignments a JOIN people p ON p.id=a.person_id',
    ),
  ]);
  return {
    games: rows.map((r) => ({
      ...JSON.parse(r.effective_json),
      source_missing: !!r.source_missing,
    })),
    teams,
    assignments,
  };
}
export const BACKUP_TABLES = [
  'teams',
  'people',
  'games',
  'assignments',
  'team_fixed',
  'fixed_exceptions',
  'import_conflicts',
  'audit',
  'sync_runs',
  'settings',
];
export async function exportBackup(db) {
  const data = {};
  for (const table of BACKUP_TABLES) data[table] = await all(db, `SELECT * FROM ${table}`);
  return { format: 'volley-control-backup', version: 1, created_at: at(), data };
}
export async function restoreBackup(db, b) {
  if (b?.format !== 'volley-control-backup' || b.version !== 1 || !b.data)
    fail('Backup non riconosciuto.');
  const count = await one(db, 'SELECT count(*) AS n FROM games');
  const people = await one(db, 'SELECT count(*) AS n FROM people');
  if (count.n || people.n)
    fail('Ripristino consentito solo in un database di recupero vuoto.', 409);
  const triggerRows = await all(
    db,
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN('booking_guard','game_retime_guard','audit_booking','audit_cancellation')",
  );
  const q = triggerRows.map((t) => statement(db, 'DROP TRIGGER ' + t.name));
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray(b.data[t])) fail('Backup incompleto.');
    for (const row of b.data[t]) {
      const keys = Object.keys(row);
      if (keys.some((k) => !/^[a-z_][a-z_0-9]*$/.test(k))) fail('Colonne non valide.');
      q.push(
        statement(
          db,
          `INSERT ${t === 'teams' ? 'OR REPLACE ' : ''}INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
          ...keys.map((k) => row[k]),
        ),
      );
    }
  }
  for (const t of triggerRows) q.push(statement(db, t.sql));
  if (q.length > 450) fail('Backup grande: usare il ripristino tecnico documentato.');
  await db.batch(q);
  return { ok: true };
}
export async function startRecovery(db, backup) {
  if (backup?.format !== 'volley-control-backup' || backup.version !== 1 || !backup.data)
    fail('Backup non riconosciuto.');
  if (
    (await one(db, 'SELECT count(*) n FROM games')).n ||
    (await one(db, 'SELECT count(*) n FROM people')).n ||
    (await one(db, 'SELECT count(*) n FROM restore_jobs')).n
  )
    fail('Usa un database di recupero nuovo e vuoto.', 409);
  const rows = [];
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.data[table])) fail('Backup incompleto.');
    for (const row of backup.data[table]) {
      if (Object.keys(row).some((k) => !/^[a-z_][a-z_0-9]*$/.test(k))) fail('Colonne non valide.');
      rows.push({ table, row });
    }
  }
  const payload = JSON.stringify(rows);
  if (payload.length > 1500000)
    fail('Backup grande: usare il ripristino tecnico in un database isolato.');
  const triggers = await all(
    db,
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN('booking_guard','game_retime_guard','audit_booking','audit_cancellation')",
  );
  if (triggers.length !== 4) fail('Schema di recupero non valido.');
  const id = random();
  await db.batch([
    ...triggers.map((t) => statement(db, 'DROP TRIGGER ' + t.name)),
    statement(db, 'DELETE FROM teams'),
    statement(
      db,
      'INSERT INTO restore_jobs(id,payload_json,triggers_json,created_at) VALUES(?,?,?,?)',
      id,
      payload,
      JSON.stringify(triggers),
      at(),
    ),
  ]);
  return { job_id: id, total: rows.length };
}
export async function recoveryStep(db, id) {
  const job = await one(db, 'SELECT * FROM restore_jobs WHERE id=?', id);
  if (!job) fail('Ripristino non trovato.', 404);
  const rows = JSON.parse(job.payload_json),
    chunk = rows.slice(job.offset, job.offset + 20),
    q = [];
  for (const { table, row } of chunk) {
    if (!BACKUP_TABLES.includes(table)) fail('Tabella non consentita.');
    const keys = Object.keys(row);
    q.push(
      statement(
        db,
        `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?')})`,
        ...keys.map((k) => row[k]),
      ),
    );
  }
  const offset = job.offset + chunk.length,
    done = offset >= rows.length;
  if (done) {
    for (const trigger of JSON.parse(job.triggers_json)) q.push(statement(db, trigger.sql));
    q.push(statement(db, 'DELETE FROM restore_jobs WHERE id=?', id));
  } else
    q.push(
      statement(
        db,
        'UPDATE restore_jobs SET offset=? WHERE id=? AND offset=?',
        offset,
        id,
        job.offset,
      ),
    );
  await db.batch(q);
  if (done) {
    const broken = await all(db, 'PRAGMA foreign_key_check');
    if (broken.length) fail('Ripristino da verificare: integrità referenziale non valida.', 409);
  }
  return { done, offset, total: rows.length };
}

// WebSocket Hibernation: una stanza condivisa da tutti i dispositivi VOLLEY CONTROL.
 // Il Durable Object inoltra soltanto un segnale, mai dati personali o credenziali.
export class VolleyLiveSync {
  constructor(state, env) { this.state = state; }
  async fetch(req) {
    const pathname = new URL(req.url).pathname;
    if (pathname === '/publish' && req.method === 'POST') {
      for (const socket of this.state.getWebSockets()) {
        try { socket.send('{"type":"calendar-changed"}'); } catch {}
      }
      return new Response(null, { status: 204 });
    }
    if (pathname !== '/api/sync' || req.method !== 'GET' ||
        req.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Not found', { status: 404 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    // Il client non invia modifiche: tutto passa dalle API e dal DB.
    if (message === 'ping') ws.send('pong');
  }
  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
}

async function route(req, env) {
  const url = new URL(req.url),
    path = url.pathname;
  if (!path.startsWith('/api/')) {
    const asset = ASSETS[path];
    if (!asset) return new Response('Pagina non trovata', { status: 404 });
    return new Response(asset.base64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body, {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': 'no-cache',
      },
    });
  }
  if (!env.DB) fail('Database non configurato.', 503);
  if (path === '/api/sync' && req.method === 'GET') {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
        req.headers.get('Origin') !== url.origin)
      fail('Connessione in tempo reale non autorizzata.', 403);
    if (!env.LIVE_SYNC) fail('Sincronizzazione non configurata.', 503);
    return env.LIVE_SYNC.get(env.LIVE_SYNC.idFromName('calendar')).fetch(req);
  }
  if (
    env.RECOVERY_MODE === 'true' &&
    ![
      '/api/auth/login',
      '/api/auth/logout',
      '/api/me',
      '/api/health',
      '/api/admin/restore',
      '/api/admin/restore/step',
    ].includes(path)
  )
    fail('Ambiente di recupero isolato: consultazione e prenotazioni disabilitate.', 503);
  if (req.method !== 'GET') {
    if (req.headers.get('origin') !== url.origin) fail('Origine non autorizzata.', 403);
    if (!['application/json'].some((x) => req.headers.get('content-type')?.startsWith(x)))
      fail('Formato non consentito.', 415);
  }
  const s = await authenticate(req, env);
  const actor = s?.admin ? (s.person_id ? 'PATTY-DELEGATO:' + s.person_id : 'PATTY') : s?.person_id;
  if (path === '/api/health' && req.method === 'GET') {
    const schema = await one(
      env.DB,
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    return json({
      ok: true,
      release: RELEASE,
      schema_version: schema?.version || 0,
      environment: env.ENVIRONMENT || 'staging',
      persistent: true,
    });
  }
  if (path === '/api/me' && req.method === 'GET') {
    const headers = {};
    if (s?.admin && s.person_id) {
      // PATTY delegato: dopo 30 minuti di inattività torna utente personale, senza perdere il login.
      const now = Date.now();
      if (s.patty_expires_at - now <= PATTY_RENEW_WINDOW_MS)
        await statement(env.DB,
          'UPDATE sessions SET patty_expires_at=? WHERE token_hash=? AND person_id=? AND admin=1 AND patty_expires_at>?',
          now + PATTY_SESSION_MS, s.token_hash, s.person_id, now).run();
      headers['Set-Cookie'] = sessionCookie(sessionToken(req), PERSONAL_COOKIE_SECONDS);
    } else if (s?.admin) {
      // Rinnovo durante l'uso: nessuna scadenza fissa dall'ultimo login.
      // Aggiornare D1 soltanto nella seconda metà dei 30 minuti.
      const now = Date.now();
      if (s.expires_at - now <= PATTY_RENEW_WINDOW_MS) {
        await statement(
          env.DB,
          'UPDATE sessions SET expires_at=? WHERE token_hash=? AND admin=1 AND expires_at>? AND expires_at<?',
          now + PATTY_SESSION_MS,
          s.token_hash,
          now,
          now + PATTY_SESSION_MS,
        ).run();
      }
      headers['Set-Cookie'] = sessionCookie(sessionToken(req), PATTY_SESSION_MS / 1000);
    } else if (s) {
      // Converte anche le vecchie sessioni di 8 ore, se non sono scadute.
      if (s.expires_at !== PERSONAL_SESSION_EXPIRES)
        await statement(
          env.DB,
          'UPDATE sessions SET expires_at=? WHERE token_hash=? AND admin=0',
          PERSONAL_SESSION_EXPIRES,
          s.token_hash,
        ).run();
      headers['Set-Cookie'] = sessionCookie(sessionToken(req), PERSONAL_COOKIE_SECONDS);
    }
    return json({
      user: s
        ? {
            id: s.person_id,
            admin: !!s.admin,
            can_access_patty: !!s.can_access_patty,
            first_name: s.first_name,
            last_name: s.last_name,
            wants_referee: !!s.wants_referee,
            wants_scorer: !!s.wants_scorer,
            wants_manager: !!s.wants_manager,
            wants_coach: !!s.wants_coach,
          }
        : null,
      csrf: s?.csrf || null,
      registration_enabled: env.REGISTRATION_ENABLED === 'true',
      patty_pin_set: !!(await one(env.DB, "SELECT value FROM settings WHERE key='patty_pin_hash'")),
      staging: env.ENVIRONMENT !== 'production',
    }, 200, headers);
  }
  if (path === '/api/calendar' && req.method === 'GET') {
    const data = await calendar(env.DB);
    data.games = data.games.filter((g) => !g.hidden);
    return json(data);
  }
  if (path === '/api/auth/register' && req.method === 'POST') {
    if (env.REGISTRATION_ENABLED !== 'true') fail('Registrazioni non ancora aperte.', 403);
    await throttle(env, req, 'register', 5);
    const b = await body(req);
    const first = clean(b.first_name), last = clean(b.last_name);
    if (!first || !last || first.length > 120 || last.length > 120 || (!b.wants_referee && !b.wants_scorer && !b.wants_manager && !b.wants_coach))
      fail('Inserisci nome, cognome e almeno una figura.');
    if (!validCode(b.password)) fail('Codice di 4 caratteri, solo lettere o numeri.');
    const key = await identityKey(first, last);
    const pwd = await passwordHash(b.password, env.PASSWORD_PEPPER);
    try {
      await statement(
        env.DB,
        'INSERT INTO people(id,email,first_name,last_name,password_hash,wants_referee,wants_scorer,wants_manager,wants_coach,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        crypto.randomUUID(), key, first, last, pwd,
        b.wants_referee ? 1 : 0, b.wants_scorer ? 1 : 0,
        b.wants_manager ? 1 : 0, b.wants_coach ? 1 : 0, 1, at(),
      ).run();
    } catch {
      fail('Nome e cognome già registrati: chiedi a PATTY come distinguere due omonimi.', 409);
    }
    return sessionReply(env, (await one(env.DB, 'SELECT id FROM people WHERE email=?', key)).id, false);
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    await throttle(env, req, 'login');
    const b = await body(req);
    if (b.admin) {
      const pin = await one(env.DB, "SELECT value FROM settings WHERE key='patty_pin_hash'");
      if (!pin && !env.PATTY_HASH) fail('Accesso PATTY non ancora configurato.', 503);
      if (!(await verifyPassword(b.password, pin?.value || env.PATTY_HASH, env.PASSWORD_PEPPER)))
        fail('Codice PATTY non corretto.', 401);
      return sessionReply(env, null, true);
    }
    const first = clean(b.first_name), last = clean(b.last_name);
    if (!first || !last) fail('Inserisci nome, cognome e codice.');
    const key = await identityKey(first, last);
    const person = await one(env.DB, 'SELECT * FROM people WHERE email=?', key);
    const valid = await verifyPassword(b.password, person?.password_hash || env.PATTY_HASH || '', env.PASSWORD_PEPPER);
    if (!person || !valid) fail('Nome, cognome o codice non corretti.', 401);
    if (!person.approved) fail('Account disattivato. Contatta PATTY.', 403);
    return sessionReply(env, person.id, false);
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    csrf(req, s);
    await statement(env.DB, 'DELETE FROM sessions WHERE token_hash=?', s.token_hash).run();
    return json({ ok: true }, 200, {
      'Set-Cookie': '__Host-vc=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
    });
  }
  if (req.method !== 'GET') csrf(req, s);
  if (path === '/api/auth/patty-enter' && req.method === 'POST') {
    if (!s?.person_id || !s.approved || !s.can_access_patty)
      fail('Non hai un’autorizzazione PATTY.', 403);
    const now = Date.now();
    await statement(env.DB,
      'UPDATE sessions SET admin=1,patty_expires_at=? WHERE token_hash=? AND person_id=? AND expires_at>?',
      now + PATTY_SESSION_MS, s.token_hash, s.person_id, now).run();
    return json({ ok: true, admin: true });
  }
  if (path === '/api/auth/patty-exit' && req.method === 'POST') {
    if (!s?.person_id || !s.approved) fail('Accesso personale richiesto.', 403);
    await statement(env.DB,
      'UPDATE sessions SET admin=0,patty_expires_at=0 WHERE token_hash=? AND person_id=?',
      s.token_hash, s.person_id).run();
    return json({ ok: true, admin: false });
  }
  if (path === '/api/book' && req.method === 'POST') {
    if (!s || s.admin || !s.person_id) fail('Accedi dall’area personale.', 403);
    const b = await body(req);
    // L'accesso alla partita non concede i ruoli: controllarli sul server.
    if (!((b.role === 'referee' && s.wants_referee) || (b.role === 'scorer' && s.wants_scorer)))
      fail('Non sei registrato per questo ruolo.', 403);
    await assign(env.DB, b.game_key, b.role, b.slot, s.person_id);
    return json({ ok: true }, 201);
  }
  if (path === '/api/cancel' && req.method === 'POST') {
    if (!s) fail('Accesso richiesto.', 403);
    const b = await body(req);
    const a = await one(
      env.DB,
      'SELECT * FROM assignments WHERE game_key=? AND role=? AND slot=?',
      b.game_key,
      b.role,
      b.slot,
    );
    if (!a) fail('Incarico non trovato.', 404);
    if (!s.admin && (a.person_id !== s.person_id || a.source !== 'self'))
      fail('Puoi annullare soltanto una tua prenotazione.', 403);
    const q = [
      statement(
        env.DB,
        'INSERT INTO cancellation_guards(game_key,role,slot,person_id,source,created_at) VALUES(?,?,?,?,?,?)',
        b.game_key,
        b.role,
        b.slot,
        a.person_id,
        a.source,
        a.created_at,
      ),
      statement(
        env.DB,
        'DELETE FROM assignments WHERE game_key=? AND role=? AND slot=?',
        b.game_key,
        b.role,
        b.slot,
      ),
      audit(env.DB, actor, 'cancelled', b.game_key, { role: b.role, slot: b.slot }),
    ];
    if (s.admin)
      q.push(
        statement(
          env.DB,
          'INSERT OR IGNORE INTO fixed_exceptions(game_key,role) VALUES(?,?)',
          b.game_key,
          b.role,
        ),
      );
    q.push(
      statement(
        env.DB,
        'DELETE FROM cancellation_guards WHERE game_key=? AND role=? AND slot=?',
        b.game_key,
        b.role,
        b.slot,
      ),
    );
    try {
      await env.DB.batch(q);
    } catch (e) {
      if (/STALE_ASSIGNMENT/.test(String(e)))
        fail('Il posto è stato modificato da un altro utente. Riapri la scheda.', 409);
      throw e;
    }
    return json({ ok: true });
  }
  admin(s);
  if (path === '/api/admin/pin' && req.method === 'POST') {
    pattyOwner(s);
    const b = await body(req);
    if (!validCode(b.pin) || b.pin !== b.confirm)
      fail('Ripeti lo stesso codice PATTY di 4 caratteri.');
    const hashed = await passwordHash(b.pin, env.PASSWORD_PEPPER);
    await env.DB.batch([
      statement(env.DB, "INSERT INTO settings(key,value) VALUES('patty_pin_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", hashed),
      statement(env.DB, 'DELETE FROM sessions WHERE admin=1 AND token_hash<>?', s.token_hash),
      audit(env.DB, actor, 'patty_pin_changed', null, {}),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/admin/state' && req.method === 'GET')
    return json({
      ...(await calendar(env.DB)),
      people: await all(
        env.DB,
        'SELECT id,first_name,last_name,wants_referee,wants_scorer,wants_manager,wants_coach,approved,can_access_patty,created_at FROM people ORDER BY last_name,first_name',
      ),
      roster: await all(env.DB, 'SELECT r.*,t.name AS official_name,t.group_id AS official_group FROM team_roster r LEFT JOIN teams t ON t.id=r.linked_team_id ORDER BY r.id'),
      fixed: await all(env.DB, 'SELECT * FROM team_fixed'),
      sync: await all(env.DB, 'SELECT * FROM sync_runs'),
      conflicts: await all(env.DB, 'SELECT * FROM import_conflicts'),
    });
  if (path === '/api/admin/roster/staff' && req.method === 'POST') {
    const b=await body(req),id=Number(b.id);
    if(!Number.isInteger(id)||id<1||id>21) fail('Scheda squadra non valida.');
    const r=await one(env.DB,'SELECT * FROM team_roster WHERE id=?',id);
    if(!r) fail('Scheda non trovata.',404);
    for(const k of ['coach1','coach2','managers'])
      if(typeof b[k]!=='string'||b[k].length>1000) fail('Dato staff non valido.');
    const vals=['coach1','coach2','managers'].map(k=>clean(b[k]));
    await env.DB.batch([
      statement(env.DB,'UPDATE team_roster SET coach1=?,coach2=?,managers=? WHERE id=?',...vals,id),
      ...(r.linked_team_id?[statement(env.DB,
        'UPDATE teams SET coach1=?,coach2=?,managers=? WHERE id=?',...vals,r.linked_team_id)]:[]),
      audit(env.DB,actor,'roster_staff_changed',null,{roster_id:id,linked_team_id:r.linked_team_id})
    ]);
    return json({ok:true});
  }
  if (path === '/api/admin/roster/pgs-search' && req.method === 'POST') {
    const roster=await all(env.DB,"SELECT * FROM team_roster WHERE source='PGS' AND linked_team_id IS NULL ORDER BY id");
    if(!roster.length) return json({ok:true,linked:[],pending:[]});
    const official=await fetchJSON('https://volley.pgsmilano.org/api/iscrizioni/campionato/invernale_2026-2027',env.FETCH||fetch);
    if(!Array.isArray(official)) fail('Elenco iscrizioni PGS non valido: nessun dato modificato.',502);
    const seen=new Set(),linked=[],pending=[];
    for(const r of roster) {
      const found=official.filter(o=>rosterMatch(r,{name:o.nomeSquadra,category:o.categoria})&&clean(o.id||o._id));
      if(found.length!==1) {
        const sameName=official.filter(o=>rosterNameKey(o.nomeSquadra)===rosterNameKey(r.name));
        const categories=[...new Set(sameName.map(o=>clean(o.categoria)).filter(Boolean))];
        pending.push({
          id:r.id,name:r.name,category:r.category,
          reason:found.length>1?'Più iscrizioni nella stessa categoria':
            categories.length?'Categorie ufficiali da verificare: '+categories.join(', '):
              'Nome non trovato nelle iscrizioni di questo campionato'
        });
        continue;
      }
      const item=found[0],officialId=clean(item.id||item._id);
      if(seen.has(officialId)||
         await one(env.DB,'SELECT 1 FROM team_roster WHERE linked_team_id=?','PGS:'+officialId)) {
        pending.push({id:r.id,name:r.name,reason:'Identificativo già associato'});continue;
      }
      seen.add(officialId);
      const teamId='PGS:'+officialId;
      try {
        await env.DB.batch([
          statement(env.DB,
            'INSERT OR IGNORE INTO teams(id,source,season,competition,group_id,official_team_id,name,category,short_name,coach1,coach2,managers,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
            teamId,'PGS',r.season,'invernale_2026-2027',clean(item.girone),
            officialId,clean(item.nomeSquadra),clean(item.categoria),r.name.slice(0,40),
            r.coach1,r.coach2,r.managers),
          statement(env.DB,'UPDATE team_roster SET linked_team_id=? WHERE id=? AND linked_team_id IS NULL',
            teamId,r.id),
          audit(env.DB,actor,'roster_linked',null,{roster_id:r.id,team_id:teamId})
        ]);
        linked.push({id:r.id,name:r.name});
      } catch(e) {pending.push({id:r.id,name:r.name,reason:'Conflitto di collegamento'});}
    }
    return json({ok:true,linked,pending});
  }
  if (path === '/api/admin/roster/fipav-link' && req.method === 'POST') {
    const b=await body(req),r=await one(env.DB,'SELECT * FROM team_roster WHERE id=?',Number(b.id));
    if(!r||r.source!=='FIPAV'||r.linked_team_id) fail('Scheda FIPAV non collegabile.',409);
    const group=clean(b.group_id);
    if(!/^\d{1,10}$/.test(group)) fail('Indica il codice numerico del girone FIPAV.');
    const payload=await fetchJSON('https://data.fipavonline.it/api/v2/calendar/0/'+group,env.FETCH||fetch);
    const games=(payload.data||payload).matches;
    if(!Array.isArray(games)) fail('Formato calendario FIPAV non valido.',502);
    const found=new Map();
    for(const g of games) for(const team of [g.team1,g.team2]) {
      if(team?.id&&rosterNameKey(team.title)===rosterNameKey(r.name))
        found.set(String(team.id),clean(team.title));
    }
    if(found.size!==1) fail('Identità non univoca: verifica codice del girone e nome.',409);
    const [officialId,name]=[...found][0],teamId='FIPAV:'+officialId;
    const duplicate=await one(env.DB,'SELECT id FROM team_roster WHERE linked_team_id=?',teamId);
    if(duplicate) fail('Identificativo già assegnato a un’altra squadra.',409);
    const existing=await one(env.DB,'SELECT id,group_id,category FROM teams WHERE id=?',teamId);
    if(existing&&(existing.group_id!==group||rosterCategoryKey(existing.category)!==rosterCategoryKey(r.category)))
      fail('Identificativo collegato a un girone o categoria differente.',409);
    await env.DB.batch([
      statement(env.DB,
        'INSERT OR IGNORE INTO teams(id,source,season,competition,group_id,official_team_id,name,category,short_name,coach1,coach2,managers,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
        teamId,'FIPAV',r.season,'',group,officialId,name,r.category,r.name.slice(0,40),
        r.coach1,r.coach2,r.managers),
      statement(env.DB,'UPDATE team_roster SET linked_team_id=? WHERE id=? AND linked_team_id IS NULL',teamId,r.id),
      audit(env.DB,actor,'roster_linked',null,{roster_id:r.id,team_id:teamId})
    ]);
    return json({ok:true,team_id:teamId});
  }
  if (path === '/api/admin/delegate' && req.method === 'POST') {
    pattyOwner(s);
    const b = await body(req);
    if (!b || Object.keys(b).sort().join(',') !== 'allowed,id' ||
        typeof b.allowed !== 'boolean' || typeof b.id !== 'string' || !b.id)
      fail('Selezione delegato non valida.', 400);
    const p = await one(env.DB, 'SELECT id,approved,can_access_patty FROM people WHERE id=?', b.id);
    if (!p) fail('Persona non trovata.', 404);
    if (b.allowed && !p.approved) fail('Non puoi autorizzare un account disattivato.', 409);
    if (!!p.can_access_patty === b.allowed) return json({ ok: true, allowed: b.allowed });
    if (b.allowed) {
      // UPDATE condizionato atomico: non possono risultare più di due delegati.
      const row = await statement(env.DB,
        'UPDATE people SET can_access_patty=1 WHERE id=? AND approved=1 AND can_access_patty=0 AND (SELECT COUNT(*) FROM people WHERE can_access_patty=1)<2 RETURNING id',
        b.id).first();
      if (!row) fail('Sono già presenti due delegati PATTY. Revocane prima uno.', 409);
      await audit(env.DB, actor, 'patty_delegate_granted', null, { id: b.id });
    } else {
      await env.DB.batch([
        statement(env.DB, 'UPDATE people SET can_access_patty=0 WHERE id=?', b.id),
        statement(env.DB, 'UPDATE sessions SET admin=0,patty_expires_at=0 WHERE person_id=?', b.id),
        audit(env.DB, actor, 'patty_delegate_revoked', null, { id: b.id }),
      ]);
    }
    return json({ ok: true, allowed: b.allowed });
  }
  if (path === '/api/admin/person' && req.method === 'POST') {
    const b = await body(req);
    if (!b || Object.keys(b).sort().join(',') !== 'action,id' ||
        b.action !== 'delete' || typeof b.id !== 'string' || !b.id)
      fail('PATTY può soltanto eliminare un account.', 400);
    const person = await one(env.DB, 'SELECT id,first_name,last_name FROM people WHERE id=?', b.id);
    if (!person) fail('Utente non trovato.', 404);
    await env.DB.batch([
      statement(env.DB, 'DELETE FROM sessions WHERE person_id=?', b.id),
      statement(env.DB, 'DELETE FROM assignments WHERE person_id=?', b.id),
      statement(env.DB, 'DELETE FROM team_fixed WHERE person_id=?', b.id),
      statement(env.DB, 'DELETE FROM cancellation_guards WHERE person_id=?', b.id),
      statement(env.DB, 'DELETE FROM people WHERE id=?', b.id),
      audit(env.DB, actor, 'person_deleted', null, { id: b.id, name: person.first_name + ' ' + person.last_name }),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/admin/team' && req.method === 'POST') {
    const b = await body(req),
      t = validateTeam(b),
      existing = b.id ? await one(env.DB, 'SELECT * FROM teams WHERE id=?', b.id) : null;
    if (b.id && !existing) fail('Squadra non trovata.', 404);
    if (
      existing &&
      ['source', 'season', 'competition', 'group_id', 'official_team_id'].some(
        (k) => existing[k] !== t[k],
      )
    )
      fail(
        'Gli identificativi della squadra non si cambiano: disattiva la precedente e aggiungi la nuova.',
      );
    const id = existing?.id || crypto.randomUUID();
    await env.DB.batch([
      statement(
        env.DB,
        `INSERT INTO teams(id,source,season,competition,group_id,official_team_id,name,category,short_name,coach1,coach2,managers,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,short_name=excluded.short_name,coach1=excluded.coach1,coach2=excluded.coach2,managers=excluded.managers,active=excluded.active`,
        id,
        ...[
          'source',
          'season',
          'competition',
          'group_id',
          'official_team_id',
          'name',
          'category',
          'short_name',
          'coach1',
          'coach2',
          'managers',
          'active',
        ].map((k) => t[k]),
      ),
      statement(env.DB,'UPDATE team_roster SET coach1=?,coach2=?,managers=? WHERE linked_team_id=?',t.coach1,t.coach2,t.managers,id),
      audit(env.DB, actor, 'team_saved', null, { id }),
    ]);
    return json({ ok: true, id });
  }
  if (path === '/api/admin/fixed' && req.method === 'POST') {
    const b = await body(req);
    if (!['referee', 'scorer'].includes(b.role)) fail('Ruolo non valido.');
    const q = [
      statement(env.DB, 'DELETE FROM team_fixed WHERE team_id=? AND role=?', b.team_id, b.role),
      statement(
        env.DB,
        `DELETE FROM assignments WHERE source='fixed' AND role=? AND game_key IN(SELECT game_key FROM games WHERE team_id=? AND start_ts>?)`,
        b.role,
        b.team_id,
        Date.now(),
      ),
    ];
    if (b.person_id) {
      const p = await one(env.DB, 'SELECT * FROM people WHERE id=?', b.person_id);
      if (!p?.approved || !p['wants_' + b.role]) fail('Persona non abilitata.');
      q.push(
        statement(
          env.DB,
          'INSERT INTO team_fixed(team_id,role,person_id) VALUES(?,?,?)',
          b.team_id,
          b.role,
          b.person_id,
        ),
      );
    }
    q.push(audit(env.DB, actor, 'fixed_changed', null, b));
    await env.DB.batch(q);
    return json({
      ok: true,
      pending: await all(
        env.DB,
        'SELECT game_key FROM games WHERE team_id=? AND start_ts>? AND is_home=1',
        b.team_id,
        Date.now(),
      ),
    });
  }
  if (path === '/api/admin/fixed/apply' && req.method === 'POST') {
    const b = await body(req);
    return json({ ok: true, ...(await applyFixed(env.DB, null, [b.game_key])) });
  }
  if (path === '/api/admin/assign' && req.method === 'POST') {
    const b = await body(req);
    await assign(env.DB, b.game_key, b.role, b.slot, b.person_id, 'patty', actor);
    return json({ ok: true });
  }
  if (path === '/api/admin/game/staff' && req.method === 'POST') {
    const b = await body(req);
    if (!b || !['match', 'permanent', 'reset'].includes(b.scope) ||
        typeof b.game_key !== 'string' || !b.game_key)
      fail('Scelta staff non valida.');
    const row = await one(env.DB, 'SELECT * FROM games WHERE game_key=?', b.game_key);
    if (!row) fail('Gara non trovata.', 404);
    const team = await one(env.DB, 'SELECT id FROM teams WHERE id=?', row.team_id);
    if (!team) fail('Squadra non trovata.', 404);
    if (b.scope === 'reset') {
      const overrides = JSON.parse(row.overrides_json);
      if (!Object.prototype.hasOwnProperty.call(overrides, 'staff_override'))
        return json({ ok: true, scope: b.scope });
      delete overrides.staff_override;
      const official = JSON.parse(row.official_json), effective = { ...official, ...overrides };
      await saveGame(env.DB, effective, official, overrides, actor, 'PATTY · Ripristino staff della squadra', row.version);
      return json({ ok: true, scope: b.scope });
    }
    const staff = {};
    for (const field of ['coach1', 'coach2', 'managers']) {
      if (typeof b[field] !== 'string' || b[field].length > 1000)
        fail('Nome allenatore o dirigente non valido.');
      staff[field] = clean(b[field]);
    }
    if (b.scope === 'match') {
      const official = JSON.parse(row.official_json),
        overrides = { ...JSON.parse(row.overrides_json), staff_override: staff },
        effective = { ...official, ...overrides };
      await saveGame(env.DB, effective, official, overrides, actor, 'PATTY · Staff solo questa partita', row.version);
    } else {
      // "Per sempre" aggiorna la squadra e rimuove l'eccezione dalla gara aperta,
      // in un'unica operazione: niente stato parzialmente aggiornato.
      const overrides = JSON.parse(row.overrides_json);
      const hasException = Object.prototype.hasOwnProperty.call(overrides,'staff_override');
      const q = [];
      if (hasException) {
        delete overrides.staff_override;
        const effective = { ...JSON.parse(row.official_json), ...overrides };
        q.push(
          statement(env.DB,'INSERT INTO write_guards(game_key,expected_version) VALUES(?,?)',
            b.game_key,row.version),
          statement(env.DB,'UPDATE games SET overrides_json=?,effective_json=?,updated_at=?,version=version+1 WHERE game_key=? AND version=?',
            JSON.stringify(overrides),JSON.stringify(effective),at(),b.game_key,row.version),
          statement(env.DB,'DELETE FROM write_guards WHERE game_key=?',b.game_key)
        );
      }
      q.push(
        statement(env.DB, 'UPDATE teams SET coach1=?,coach2=?,managers=? WHERE id=?',
          staff.coach1,staff.coach2,staff.managers,row.team_id),
        statement(env.DB, 'UPDATE team_roster SET coach1=?,coach2=?,managers=? WHERE linked_team_id=?',
          staff.coach1,staff.coach2,staff.managers,row.team_id),
        audit(env.DB,actor,'team_staff_permanent',b.game_key,{team_id:row.team_id,staff})
      );
      try { await env.DB.batch(q); }
      catch (e) { fail(dbMessage(e),409); }
    }
    return json({ ok: true, scope: b.scope });
  }
  if (path === '/api/admin/game/flip-home' && req.method === 'POST') {
    const b = await body(req);
    if (!b || typeof b.game_key !== 'string' || !b.game_key ||
        typeof b.expected_is_home !== 'boolean') fail('Richiesta casa/trasferta non valida.');
    const old = await one(env.DB, 'SELECT * FROM games WHERE game_key=?', b.game_key);
    if (!old) fail('Gara non trovata.', 404);
    if (!!old.is_home !== b.expected_is_home)
      fail('La partita è stata modificata. Riapri la scheda e riprova.', 409);
    const current = JSON.parse(old.effective_json);
    if (current.played) fail('La partita risulta già disputata: prima verifica il risultato con PATTY.', 409);
    if (!clean(current.home_team) || !clean(current.away_team))
      fail('Nomi delle squadre incompleti: correggili prima di invertire la partita.');
    const goingHome = !b.expected_is_home;
    if (!goingHome) {
      const seats = await one(env.DB, 'SELECT COUNT(*) AS total FROM assignments WHERE game_key=?', b.game_key);
      if (Number(seats?.total || 0) > 0)
        fail('Sono presenti arbitri o refertisti prenotati (anche FISSI). PATTY deve prima rimuoverli dalla scheda; nessuna prenotazione è stata cancellata.', 409);
    }
    const official = JSON.parse(old.official_json);
    const overrides = { ...JSON.parse(old.overrides_json),
      is_home: goingHome,
      home_team: current.away_team,
      away_team: current.home_team,
      required_referees: goingHome ? Math.max(1, Number(current.required_referees || 0), Number(official.required_referees || 0)) : 0,
      required_scorers: goingHome ? Math.max(1, Number(current.required_scorers || 0), Number(official.required_scorers || 0)) : 0,
    };
    const g = { ...official, ...overrides };
    try {
      await saveGame(env.DB, g, official, overrides, actor, 'PATTY · Inversione casa/trasferta', old.version);
    } catch (e) {
      fail(dbMessage(e), 409);
    }
    const fixed = goingHome ? await applyFixed(env.DB, g.team_id, [g.game_key]) : null;
    return json({ ok: true, game: g, fixed });
  }
  if (path === '/api/admin/game' && req.method === 'POST') {
    const b = await body(req),
      patch = validatePatch(b.patch);
    const old = await one(env.DB, 'SELECT * FROM games WHERE game_key=?', b.game_key);
    if (!old) fail('Gara non trovata.', 404);
    const official = JSON.parse(old.official_json),
      overrides = { ...JSON.parse(old.overrides_json), ...patch };
    const g = { ...official, ...overrides };
    if (!g.date || !g.time) fail('Indica sia data sia ora.');
    try {
      await saveGame(env.DB, g, official, overrides, actor, clean(b.reason), old.version);
    } catch (e) {
      fail(dbMessage(e), 409);
    }
    return json({ ok: true, game: g, fixed: await applyFixed(env.DB, g.team_id, [g.game_key]) });
  }
  if (path === '/api/admin/override/reset' && req.method === 'POST') {
    const b = await body(req),
      old = await one(env.DB, 'SELECT * FROM games WHERE game_key=?', b.game_key);
    if (!old) fail('Gara non trovata.', 404);
    const overrides = JSON.parse(old.overrides_json);
    delete overrides[b.field];
    const official = JSON.parse(old.official_json);
    try {
      await saveGame(
        env.DB,
        { ...official, ...overrides },
        official,
        overrides,
        actor,
        'Ripristino valore ufficiale',
        old.version,
      );
      await statement(
        env.DB,
        'DELETE FROM import_conflicts WHERE game_key=? AND field=?',
        b.game_key,
        b.field,
      ).run();
    } catch (e) {
      fail(dbMessage(e), 409);
    }
    return json({ ok: true });
  }
  if (path === '/api/admin/manual' && req.method === 'POST') {
    const b = await body(req),
      t = await one(env.DB, 'SELECT * FROM teams WHERE id=?', b.team_id);
    if (!t) fail('Squadra non trovata.');
    const patch = validatePatch(b.patch);
    if (!patch.date || !patch.time || !clean(b.opponent)) fail('Indica avversaria, data e ora.');
    const key = 'MANUAL:' + t.season + ':' + crypto.randomUUID();
    const g = {
      game_key: key,
      team_id: t.id,
      source: 'MANUAL',
      season: t.season,
      group_id: '',
      official_id: key,
      our_team_id: t.official_team_id,
      our_team_name: t.name,
      category: t.category,
      home_team: b.is_home ? t.name : clean(b.opponent),
      away_team: b.is_home ? clean(b.opponent) : t.name,
      is_home: !!b.is_home,
      required_referees: b.is_home ? 1 : 0,
      required_scorers: b.is_home ? 1 : 0,
      played: false,
      home_sets: null,
      away_sets: null,
      sets: [],
      hidden: false,
      venue: 'Palestra non indicata',
      address: '',
      game_number: '',
      notes: '',
      ...patch,
    };
    await saveGame(env.DB, g, g, {}, actor, 'Inserimento manuale');
    return json({ ok: true, game: g }, 201);
  }
  if (path === '/api/admin/sync' && req.method === 'POST') {
    const b = await body(req);
    return json(await syncScope(env, clean(b.scope), b.results_only === true));
  }
  if (path === '/api/admin/sync/step' && req.method === 'POST') {
    const b = await body(req);
    return json(await syncStep(env, clean(b.job_id)));
  }
  if (path === '/api/admin/audit' && req.method === 'GET')
    return json({
      audit: await all(
        env.DB,
        'SELECT * FROM audit WHERE game_key=? ORDER BY id DESC LIMIT 100',
        url.searchParams.get('game_key') || '',
      ),
    });
  if (path === '/api/admin/backup' && req.method === 'GET')
    return json(await exportBackup(env.DB), 200, {
      'Content-Disposition': 'attachment; filename="volley-control-backup.json"',
    });
  if (path === '/api/admin/restore' && req.method === 'POST') {
    pattyOwner(s);
    if (env.RECOVERY_MODE !== 'true')
      fail('Ripristino disponibile solo nell’ambiente di recupero isolato.', 403);
    return json(await startRecovery(env.DB, await body(req)));
  }
  if (path === '/api/admin/restore/step' && req.method === 'POST') {
    pattyOwner(s);
    if (env.RECOVERY_MODE !== 'true') fail('Ripristino non abilitato.', 403);
    const b = await body(req);
    return json(await recoveryStep(env.DB, b.job_id));
  }
  if (path === '/api/admin/usage' && req.method === 'GET')
    return json({
      daily: await all(env.DB, 'SELECT * FROM usage_daily ORDER BY day DESC LIMIT 14'),
      quota_scope:
        'Le quote sono condivise con tutte le app dell’account. Questi contatori riguardano solo Volley Control.',
      account_plan_verified: env.FREE_PLAN_VERIFIED === 'true',
      limits: {
        worker_requests: 100000,
        d1_reads: 5000000,
        d1_writes: 100000,
        database_bytes: 500000000,
      },
      sync: await all(env.DB, 'SELECT * FROM sync_runs'),
    });
  fail('Operazione non trovata.', 404);
}
export function instrumentDB(db, meter) {
  const collect = (r) => {
    for (const x of Array.isArray(r) ? r : [r]) {
      meter.reads += x?.meta?.rows_read || 0;
      meter.writes += x?.meta?.rows_written || 0;
    }
    return r;
  };
  return {
    prepare(sql) {
      const raw = db.prepare(sql);
      return {
        bind(...p) {
          const bound = raw.bind(...p);
          return {
            sql,
            p,
            _raw: bound,
            async all() {
              return collect(await bound.all());
            },
            async first() {
              const r = collect(await bound.all());
              return r.results[0] || null;
            },
            async run() {
              return collect(await bound.run());
            },
          };
        },
      };
    },
    async batch(q) {
      return collect(await db.batch(q.map((x) => x._raw || x)));
    },
  };
}
export default {
  async fetch(req, env, ctx) {
    const meter = { reads: 0, writes: 0 },
      rawDB = env.DB;
    if (rawDB) env = { ...env, DB: instrumentDB(rawDB, meter) };
    let res;
    try {
      res = await route(req, env);
    } catch (e) {
      res = json({ error: e.status ? e.message : dbMessage(e) }, e.status || 500);
    }
    // Avvisa gli altri dispositivi soltanto DOPO una modifica riuscita.
    // Se il servizio realtime è momentaneamente indisponibile, la prenotazione resta salvata.
    const path = new URL(req.url).pathname;
    if (
      req.method === 'POST' && res.ok && env.LIVE_SYNC && ctx?.waitUntil &&
      (['/api/book', '/api/cancel', '/api/admin/assign',
        '/api/admin/fixed', '/api/admin/fixed/apply',
        '/api/admin/game', '/api/admin/game/flip-home', '/api/admin/override/reset',
        '/api/admin/manual', '/api/admin/team', '/api/admin/person', '/api/admin/delegate',
        '/api/admin/roster/staff','/api/admin/roster/pgs-search',
        '/api/admin/roster/fipav-link'].includes(path) ||
        path.startsWith('/api/admin/sync/'))
    ) {
      ctx.waitUntil(
        Promise.resolve()
          .then(() => env.LIVE_SYNC.get(env.LIVE_SYNC.idFromName('calendar'))
            .fetch('https://volley-sync.internal/publish', { method: 'POST' }))
          .catch(() => {}),
      );
    }
    if (res.status === 101) return res;
    if (rawDB && path.startsWith('/api/') && ctx?.waitUntil) {
      ctx.waitUntil(
        statement(
          rawDB,
          `INSERT INTO usage_daily(day,reads,writes,requests) VALUES(?,?,?,1) ON CONFLICT(day) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,requests=requests+1`,
          new Date().toISOString().slice(0, 10),
          meter.reads,
          meter.writes,
        )
          .run()
          .catch(() => {}),
      );
    }
    const headers = new Headers(res.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    headers.set('Strict-Transport-Security', 'max-age=31536000');
    headers.set('X-Volley-Release', RELEASE);
    return new Response(res.body, { status: res.status, headers });
  },
};
