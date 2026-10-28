export const clean = (v) => String(v ?? '').trim();
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function dateISO(v) {
  v = clean(v);
  if (!v) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) v = v.slice(6) + '-' + v.slice(3, 5) + '-' + v.slice(0, 2);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail('Data non valida.');
  return v;
}
export function hour(v) {
  v = clean(v).replace('.', ':');
  if (!v) return '';
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) fail('Ora non valida.');
  return v.slice(0, 5);
}
export function weekStart(v) {
  const d = new Date(dateISO(v) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function interval(g) {
  if (!g.date || !g.time) return [null, null];
  const base = Date.parse(g.date + 'T' + g.time + ':00Z');
  let epoch = base;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epoch));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    const diff = represented - base;
    if (diff === 0) break;
    epoch -= diff;
  }
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));
  const localHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epoch));
  if (check !== g.date || localHour !== g.time)
    fail('Data e ora non rappresentabili (verifica il cambio ora legale).');
  return [epoch, epoch + 120 * 60000];
}
export function scopeFor(t) {
  return [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':');
}
export const required = (g, r) =>
  !g.is_home ? 0 : Number(g[r === 'referee' ? 'required_referees' : 'required_scorers'] || 0);
export function roleState(g, as, r) {
  if (g.is_home && g['federal_' + r]) return 'covered';
  const n = required(g, r);
  return !n ? 'na' : as.filter((x) => x.role === r).length >= n ? 'covered' : 'missing';
}
export function coverage(g, a = []) {
  if (!g.is_home) return 'Trasferta';
  const r = roleState(g, a, 'referee'),
    s = roleState(g, a, 'scorer');
  return r === 'missing' && s === 'missing'
    ? 'Arbitro e refertista mancanti'
    : r === 'missing'
      ? 'Arbitro mancante'
      : s === 'missing'
        ? 'Refertista mancante'
        : 'Completa';
}
function numeric(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}
function sets(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
    fail('Parziali incompleti: archivio conservato.');
  return a
    .map((x, i) => ({ home: numeric(Number(x)), away: numeric(Number(b[i])) }))
    .filter((x) => x.home !== null && x.away !== null);
}
function base(t, id, no, home, date, time) {
  return {
    game_key: `${t.source}:${t.season}:${t.source === 'FIPAV' ? t.group_id : t.competition}:${id}`,
    source: t.source,
    season: t.season,
    competition: t.competition || '',
    group_id: t.group_id,
    official_id: clean(id),
    game_number: clean(no),
    our_team_id: t.official_team_id,
    our_team_name: t.name,
    team_id: t.id,
    category: t.category,
    is_home: home,
    date: dateISO(date),
    time: hour(time),
    venue: 'Palestra non indicata',
    address: '',
    notes: '',
    hidden: false,
    required_referees: home ? 1 : 0,
    required_scorers: home ? 1 : 0,
  };
}
function dedup(games) {
  const unique = new Map();
  for (const g of games) {
    if (!g.official_id) fail('Gara senza identificativo.');
    if (unique.has(g.game_key)) fail('Gara duplicata nella fonte.');
    unique.set(g.game_key, g);
  }
  if (!games.length) fail('Nessuna gara della squadra trovata: archivio conservato.');
  return games;
}
export function normalizeFipav(payload, t) {
  const rows = (payload.data || payload).matches;
  if (!Array.isArray(rows)) fail('FIPAV: formato calendario non valido.');
  const out = [];
  for (const x of rows) {
    const h = x.team1 || {},
      a = x.team2 || {};
    if (![String(h.id), String(a.id)].includes(t.official_team_id)) continue;
    const home = String(h.id) === t.official_team_id;
    const g = base(t, x.id, x.ng, home, x.date, x.time);
    const v = clean(x.stadium).split(' - ');
    Object.assign(g, {
      home_team: clean(h.title),
      away_team: clean(a.title),
      venue: v.shift() || g.venue,
      address: v.join(' - '),
      played: !!x.played,
      home_sets: numeric(x['team1-setwin']),
      away_sets: numeric(x['team2-setwin']),
      sets: sets(x.pt_a, x.pt_b),
    });
    out.push(g);
  }
  return dedup(out);
}
export function normalizePgs(matches, registrations, t) {
  if (!Array.isArray(matches) || !Array.isArray(registrations)) fail('PGS: formato non valido.');
  const names = new Map(registrations.map((x) => [clean(x.id || x._id), x]));
  const us = names.get(t.official_team_id);
  if (
    !us ||
    clean(us.nomeSquadra).toUpperCase() !== t.name.toUpperCase() ||
    us.categoria !== t.category
  )
    fail('PGS: identità squadra non confermata.');
  const out = [];
  for (const x of matches) {
    if (![clean(x.squadraCasaID), clean(x.squadraTrasfertaID)].includes(t.official_team_id))
      continue;
    if (x.categoria !== t.category || (x.codiceCampionato && x.codiceCampionato !== t.competition))
      fail('PGS: campionato o categoria diversi.');
    const h = names.get(clean(x.squadraCasaID)),
      a = names.get(clean(x.squadraTrasfertaID));
    if (!h || !a) fail('PGS: squadra avversaria non trovata.');
    const g = base(
      t,
      x.id || x._id,
      x.numeroGara,
      clean(x.squadraCasaID) === t.official_team_id,
      x.data,
      x.ora,
    );
    const v = x.indirizzo && x.citta ? x : h;
    const hs = numeric(x.setVintiCasa),
      as = numeric(x.setVintiTrasferta);
    Object.assign(g, {
      home_team: clean(h.nomeSquadra),
      away_team: clean(a.nomeSquadra),
      venue: clean(v.presso) || g.venue,
      address: [v.indirizzo, v.citta].filter(Boolean).join(' - '),
      played: hs !== null && as !== null,
      home_sets: hs,
      away_sets: as,
      sets: sets(x.parzialiCasa, x.parzialiTrasferta),
    });
    out.push(g);
  }
  return dedup(out);
}
export function mergeGame(old, incoming, resultsOnly = false) {
  const prior = old ? JSON.parse(old.official_json) : {};
  const overrides = old ? JSON.parse(old.overrides_json) : {};
  const official = resultsOnly
    ? {
        ...prior,
        ...Object.fromEntries(
          ['played', 'home_sets', 'away_sets', 'sets'].map((k) => [k, incoming[k]]),
        ),
      }
    : incoming;
  const conflicts = [];
  for (const [field, value] of Object.entries(overrides))
    if (field !== 'staff_override' && JSON.stringify(official[field]) !== JSON.stringify(value))
      conflicts.push({ field, incoming: JSON.stringify(official[field] ?? null) });
  const effective = { ...official, ...overrides };
  return { official, overrides, effective, conflicts };
}
export const EDITABLE = {
  date: 'Data',
  time: 'Ora',
  category: 'Categoria',
  home_team: 'Squadra casa',
  away_team: 'Squadra ospite',
  game_number: 'Numero gara',
  venue: 'Palestra',
  address: 'Indirizzo',
  notes: 'Note',
  played: 'Disputata',
  home_sets: 'Set casa',
  away_sets: 'Set ospite',
  sets: 'Parziali',
  required_referees: 'Arbitri richiesti',
  required_scorers: 'Refertisti richiesti',
  hidden: 'Nascondi / annulla gara',
  federal_referee: 'Arbitro federale',
  federal_scorer: 'Refertista federale',
};
export function validatePatch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Object.keys(p).length)
    fail('Nessun campo da modificare.');
  const out = {};
  for (let [k, v] of Object.entries(p)) {
    if (!(k in EDITABLE)) fail('Campo non modificabile.');
    if (k === 'date') v = dateISO(v);
    else if (k === 'time') v = hour(v);
    else if (['hidden', 'played', 'federal_referee', 'federal_scorer'].includes(k)) {
      if (typeof v !== 'boolean') fail('Valore booleano richiesto.');
    } else if (['home_sets', 'away_sets', 'required_referees', 'required_scorers'].includes(k)) {
      if (!Number.isInteger(v) || v < 0 || v > 10) fail('Numero fuori intervallo 0–10.');
    } else if (k === 'sets') {
      if (
        !Array.isArray(v) ||
        v.length > 10 ||
        v.some(
          (x) =>
            !Number.isInteger(x.home) ||
            !Number.isInteger(x.away) ||
            x.home < 0 ||
            x.away < 0 ||
            x.home > 100 ||
            x.away > 100,
        )
      )
        fail('Parziali non validi.');
    } else {
      v = clean(v);
      if (v.length > 2000 || (!v && !['notes', 'address'].includes(k))) fail('Testo non valido.');
    }
    out[k] = v;
  }
  return out;
}
export function validateTeam(x) {
  const o = {};
  for (const k of [
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
  ]) {
    o[k] = clean(x[k]);
    if (o[k].length > 1000) fail('Campo troppo lungo.');
  }
  if (
    !['FIPAV', 'PGS'].includes(o.source) ||
    !/^\d{4}-\d{4}$/.test(o.season) ||
    !o.name ||
    !o.category ||
    !o.short_name ||
    !/^[-\w]+$/.test(o.official_team_id)
  )
    fail('Dati squadra incompleti.');
  if (o.source === 'FIPAV' && !/^\d+$/.test(o.group_id)) fail('Girone FIPAV numerico richiesto.');
  if (o.source === 'PGS' && !/^[-\w]+$/.test(o.competition))
    fail('Codice campionato PGS richiesto.');
  o.active = x.active === false ? 0 : 1;
  return o;
}
