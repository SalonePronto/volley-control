const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
    );
let state = {
    games: [],
    teams: [],
    assignments: [],
    user: null,
    csrf: null,
    week: null,
    admin: null,
    registration_enabled: false,
  },
  currentGame = null;
const ROLES = { referee: 'Arbitro', scorer: 'Refertista' };
const FIELDS = {
  date: 'Data',
  time: 'Ora',
  category: 'Categoria',
  home_team: 'Squadra casa',
  away_team: 'Squadra ospite',
  game_number: 'Numero gara',
  venue: 'Palestra',
  address: 'Indirizzo',
  notes: 'Note',
  played: 'Disputata (true/false)',
  home_sets: 'Set casa',
  away_sets: 'Set ospite',
  sets: 'Parziali (JSON)',
  required_referees: 'Arbitri richiesti',
  required_scorers: 'Refertisti richiesti',
  hidden: 'Nascondi / annulla (true/false)',
};
const isoNow = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function weekOf(v) {
  const d = new Date(v + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const shortDate = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—');
function weekLabel(w) {
  const e = new Date(w + 'T12:00:00Z');
  e.setUTCDate(e.getUTCDate() + 6);
  return 'GARE ' + shortDate(w) + ' – ' + shortDate(e.toISOString().slice(0, 10));
}
const assigned = (g) => state.assignments.filter((a) => a.game_key === g.game_key);
const federal = (g, r) => !!g.is_home && !!g['federal_' + r];
const missingSeats = (g, r) => federal(g, r) ? 0 :
  Math.max(0, required(g, r) - assigned(g).filter((a) => a.role === r).length);
const required = (g, r) =>
  g.is_home ? Number(g[r === 'referee' ? 'required_referees' : 'required_scorers'] || 0) : 0;
function roleState(g, r) {
  if (federal(g, r)) return 'covered';
  const n = required(g, r);
  return !n ? 'na' : assigned(g).filter((a) => a.role === r).length >= n ? 'covered' : 'missing';
}
function dot(g, r) {
  const s = roleState(g, r),
    text = s === 'covered' ? 'Coperto' : s === 'missing' ? 'Mancante' : 'Non richiesto';
  return `<i class="dot ${s}" role="img" aria-label="${ROLES[r]}: ${text}" title="${ROLES[r]}: ${text}">${s === 'covered' ? '✓' : s === 'missing' ? '!' : '—'}</i>`;
}
function status(g) {
  if (g.source_missing) return 'Gara assente dalla fonte · verifica PATTY';
  if (!g.is_home) return 'Trasferta';
  const r = roleState(g, 'referee') === 'missing',
    s = roleState(g, 'scorer') === 'missing';
  return r && s
    ? 'Arbitro e refertista mancanti'
    : r
      ? 'Arbitro mancante'
      : s
        ? 'Refertista mancante'
        : 'Completa';
}
const names = (g, r) =>
  federal(g, r) ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') :
  assigned(g)
    .filter((a) => a.role === r)
    .map((a) => a.first_name + ' ' + a.last_name)
    .join(', ');
function notice(message, dialog = false) {
  $(dialog ? '#dialog-message' : '#message').textContent = message || '';
}
async function api(path, data) {
  const res = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers:
      data === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: 'same-origin',
  });
  let result;
  try {
    result = await res.json();
  } catch {
    throw new Error('Servizio non disponibile. Riprova più tardi.');
  }
  if (!res.ok) throw new Error(result.error || 'Operazione non riuscita.');
  return result;
}
// Eventi reali: nessun controllo a intervalli del database.
let liveSocket = null, liveRetryTimer = null, liveRetryCount = 0;
let liveRefreshing = false, livePending = false;
async function refreshLiveCalendar() {
  if (document.hidden) { livePending = true; return; }
  if (liveRefreshing) { livePending = true; return; }
  liveRefreshing = true;
  try {
    do {
      livePending = false;
      const c = await api('calendar');
      state = { ...state, ...c };
      if (state.user?.admin) state.admin = await api('admin/state');
      render();
      // La scheda di gara resta aggiornata, senza interrompere una conferma in corso.
      if ($('#dialog').open && currentGame && !$('#action-confirmation') && !state.user?.admin)
        await showGame(currentGame);
    } while (livePending && !document.hidden);
  } catch (error) {
    // La prossima riapertura o riconnessione recupera lo stato dal database.
    livePending = true;
  } finally {
    liveRefreshing = false;
  }
}
function connectLive() {
  if (document.hidden || typeof WebSocket === 'undefined' ||
      (liveSocket && liveSocket.readyState <= WebSocket.OPEN)) return;
  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }
  const socket = new WebSocket(
    (location.protocol === 'https:' ? 'wss://' : 'ws://') +
    location.host + '/api/sync',
  );
  liveSocket = socket;
  socket.onopen = () => {
    if (socket !== liveSocket) return;
    liveRetryCount = 0;
    refreshLiveCalendar();
  };
  socket.onmessage = (event) => {
    if (event.data === '{"type":"calendar-changed"}') refreshLiveCalendar();
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    if (!document.hidden) {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(liveRetryCount++, 5));
      liveRetryTimer = setTimeout(connectLive, delay);
    }
  };
}
function suspendLive() {
  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }
  if (liveSocket) {
    const socket = liveSocket;
    liveSocket = null;
    socket.close();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendLive();
  else { refreshLiveCalendar(); connectLive(); }
});
window.addEventListener('focus', () => {
  if (!document.hidden) refreshLiveCalendar();
});
async function load() {
  const [me, c] = await Promise.all([api('me'), api('calendar')]);
  state = { ...state, ...me, ...c };
  if (state.user?.admin) state.admin = await api('admin/state');
  else state.admin = null;
  render();
}
function render() {
  const pending = state.games.filter((g) => !g.date || !g.time);
  $('#patty').textContent = state.user?.admin ? '🔓 Esci da PATTY' : '🔒 PATTY';
  $('#patty').append(
    Object.assign(document.createElement('span'), {
      id: 'pending-dot',
      textContent: pending.length ? ' ●' : '',
    }),
  );
  $('#identity').textContent =
    state.user && !state.user.admin ? state.user.first_name + ' ' + state.user.last_name : '';
  $('#access').textContent =
    state.user && !state.user.admin ? 'Esci dall’area personale' : 'Area personale';
  const games = state.games.filter((g) => g.date && g.time && !g.hidden);
  const weeks = [...new Set(games.map((g) => weekOf(g.date)))].sort();
  $('#weeks').innerHTML = weeks
    .map(
      (w) => `<button data-week="${w}" aria-pressed="${state.week === w}">${weekLabel(w)}</button>`,
    )
    .join('');
  const w = state.week || weekOf(isoNow());
  $('#title').textContent = state.week ? weekLabel(w) : 'HOME · Gare casalinghe da coprire';
  let rows = games.filter((g) => weekOf(g.date) === w);
  if (!state.week)
    rows = rows.filter(
      (g) =>
        g.is_home &&
        (roleState(g, 'referee') === 'missing' || roleState(g, 'scorer') === 'missing'),
    );
  rows.sort((a, b) =>
    (a.date + a.time + a.game_number).localeCompare(b.date + b.time + b.game_number),
  );
  const fullWeek = games.filter((g) => weekOf(g.date) === w);
  const allMiss = (r) =>
    fullWeek.reduce(
      (s, g) => s + missingSeats(g, r),
      0,
    );
  $('#metrics').innerHTML = [
    ['Partite', fullWeek.length],
    ['Complete', fullWeek.filter((g) => status(g) === 'Completa').length],
    ['Da completare', fullWeek.filter((g) => g.is_home && status(g) !== 'Completa').length],
    ['Arbitri mancanti', allMiss('referee')],
    ['Refertisti mancanti', allMiss('scorer')],
  ]
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
  const miss = (r) =>
    rows.reduce(
      (s, g) => s + missingSeats(g, r),
      0,
    );
  $('#summary').textContent =
    `${rows.length} gare · da coprire: ARB ${miss('referee')} · REF ${miss('scorer')}`;
  $('#games').innerHTML =
    rows.map(rowHTML).join('') ||
    '<p class="notice">Nessuna gara da mostrare. Scegli una settimana per consultare tutte le partite.</p>';
  $('#admin').hidden = !state.user?.admin;
  if (state.user?.admin) renderAdmin();
}
function rowHTML(g) {
  const t = state.teams.find((t) => t.id === g.team_id) || {},
    cat = g.category.match(/\bU\s*\d+/i)?.[0].replace(/\s/g, '') || g.category,
    st = status(g),
    side = g.is_home ? 'CASA' : 'TRASFERTA',
    weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(g.date + 'T12:00:00Z'),
    );
  return `<article class="fixture" data-game-key="${esc(g.game_key)}"><div class="block category"><strong>${esc(cat)}</strong><span>${esc(g.source)}</span><small>N. ${esc(g.game_number || '—')}</small></div><div class="block date"><span>${esc(weekday)} ${shortDate(g.date)}</span><span>${esc(g.time)}</span><small>${side}</small></div><div class="block match"><span title="${esc(g.home_team)}">${esc(g.home_team)}</span><span title="${esc(g.away_team)}">${esc(g.away_team)}${g.played ? ' · ' + g.home_sets + '–' + g.away_sets : ''}</span><span title="${esc(g.venue + ' · ' + g.address)}">${esc(g.venue)} · ${esc(g.address)}</span></div><div class="block staff"><div><span>ALL. ${esc(t.coach1 || '—')}</span>${t.coach2 ? '<span>' + esc(t.coach2) + '</span>' : ''}</div><div><span class="managers">DIR. ${esc(t.managers?.replace(/\n/g, ', ') || '—')}</span></div></div><div class="block roles">${
    g.is_home
      ? Object.entries(ROLES)
          .map(
            ([r, label]) =>
              `<div><b>${dot(g, r)} ${label}</b><span>${esc(names(g, r))}</span></div>`,
          )
          .join('')
      : ''
  }</div><div class="block"><div class="status ${!g.is_home ? 'away' : st === 'Completa' ? 'ready' : 'open'}">${esc(st)}</div></div><div class="mobile"><span class="identity"><span class="cat">${esc(cat)}</span><span class="source">${esc(g.source)}</span><span class="short">${esc(t.short_name || g.our_team_name)}</span></span><span>${shortDate(g.date)}</span><span>${esc(g.time)}</span><span>${dot(g, 'referee')}</span><span>${dot(g, 'scorer')}</span></div><button class="open-game" data-open="${esc(g.game_key)}">Vedi scheda</button></article>`;
}
function modal(title, html) {
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = html;
  notice('', true);
  if (!$('#dialog').open) $('#dialog').showModal();
}
const card = (title, main, detail = '') =>
  `<div class="card"><h3>${esc(title)}</h3><p>${esc(main)}</p><small>${esc(detail)}</small></div>`;
function field(label, name, value = '', type = 'text', required = false) {
  return `<label class="field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${type === 'password' ? 'minlength="12" maxlength="256" autocomplete="current-password"' : ''}></label>`;
}
const select = (label, name, options, value = '') =>
  `<label class="field">${esc(label)}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const check = (label, name, on = false) =>
  `<label><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
const codeField = (label, name) =>
  `<label class="field">${esc(label)}<input name="${esc(name)}" type="password" minlength="4" maxlength="4" pattern="[A-Za-z0-9]{4}" autocomplete="off" autocapitalize="off" required></label>`;
function access(admin = false) {
  const names = field('Nome', 'first_name', '', 'text', true) +
    field('Cognome', 'last_name', '', 'text', true);
  const credentials = admin
    ? (state.patty_pin_set ? codeField('Codice PATTY (4 caratteri)', 'password') : field('Password PATTY attuale', 'password', '', 'password', true))
    : names + codeField('Codice personale (4 caratteri)', 'password');
  modal(
    admin ? 'PATTY · Accesso organizzatore' : 'Area personale · Accesso',
    `<form data-form="login" data-admin="${admin}">${credentials}<button class="primary">Accedi</button></form>${!admin && state.registration_enabled ? `<details><summary>Prima registrazione · Solo collaudo</summary><p class="notice">Usa soltanto nome e cognome inventati. Nessuna email.</p><form data-form="register">${names}${codeField('Codice di 4 caratteri', 'password')}<div class="checks">${check('Arbitro', 'wants_referee')}${check('Refertista', 'wants_scorer')}${check('Dirigente', 'wants_manager')}${check('Allenatore', 'wants_coach')}</div><label>${check('Confermo che sono dati fittizi', 'staging_consent')}</label><div class="actions"><button>Registrati ed entra</button></div></form></details>` : !admin ? '<p class="notice">Registrazioni non ancora aperte in questo ambiente.</p>' : ''}`,
  );
}
async function showGame(key) {
  const g =
    state.games.find((x) => x.game_key === key) ||
    state.admin?.games.find((x) => x.game_key === key);
  if (!g) return;
  currentGame = key;
  const t = state.teams.find((x) => x.id === g.team_id) || {};
  let seats = '';
  if (g.is_home) {
    for (const [r, label] of Object.entries(ROLES))
      for (let slot = 1; slot <= Math.max(required(g, r), federal(g, r) ? 1 : 0); slot++) {
        const a = assigned(g).find((a) => a.role === r && a.slot === slot);
        const data = `data-game="${esc(key)}" data-role="${r}" data-slot="${slot}"`;
        const isFederal = federal(g, r);
        const allowed = state.user && !state.user.admin && !g.source_missing && !isFederal;
        seats += `<div class="seat"><span>${dot(g, r)} <b>${label}${required(g, r) > 1 ? ' ' + slot : ''}:</b> ${isFederal ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') : a ? esc(a.first_name + ' ' + a.last_name) : 'Posto libero'}</span>${isFederal ? '' : a ? (state.user?.admin || (state.user?.id === a.person_id && a.source === 'self') ? `<button data-cancel ${data}>${state.user?.admin ? 'Rimuovi incarico' : 'Annulla la mia prenotazione'}</button>` : '') : `<button data-book ${data} ${allowed ? '' : 'disabled'} title="${allowed ? 'Prenota questo incarico' : 'Accedi dall’area personale per prenotarti'}">Mi prenoto</button>`}</div>`;
      }
  }
  let html = `<div class="sheet-hero">${esc(g.date ? shortDate(g.date) + '/' + g.date.slice(0, 4) : 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(g.category)} · ${esc(g.source)}<strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></div><div class="grid">${card('Gara', g.game_number || 'Numero non presente', (g.is_home ? 'Casa' : 'Trasferta') + ' · ' + g.source)}${card('Palestra e indirizzo', g.venue, g.address)}${card('Staff squadra', t.coach1 || 'Da inserire', 'Secondo allenatore: ' + (t.coach2 || '—') + ' · Dirigenti: ' + (t.managers?.replace(/\n/g, ', ') || 'Da inserire'))}${card('Copertura', status(g), 'Arbitro: ' + (names(g, 'referee') || (g.is_home ? 'Da assegnare' : 'Non richiesto')) + ' · Refertista: ' + (names(g, 'scorer') || (g.is_home ? 'Da assegnare' : 'Non richiesto')))}</div>${g.is_home ? '<h3>Prenotazioni · Gare in casa</h3>' + seats : '<p class="notice">Trasferta: non sono richiesti arbitro e refertista interni.</p>'}${card('Risultato', g.played ? g.home_sets + ' – ' + g.away_sets : 'Non ancora disponibile', (g.sets || []).map((s, i) => i + 1 + '° ' + s.home + '–' + s.away).join(' · '))}${g.notes ? card('Note', g.notes) : ''}`;
  if (state.user?.admin) {
    if (g.is_home) {
      html += `<section class="card"><h3>PATTY · Designazione federale</h3><form data-form="federal" data-key="${esc(key)}"><div class="actions">${check('Arbitro federale', 'federal_referee', federal(g, 'referee'))}${check('Refertista federale', 'federal_scorer', federal(g, 'scorer'))}</div><p class="notice">Federale: posto coperto e non prenotabile. Se già occupato, rimuovi prima l’incarico.</p><button class="primary">Salva scelta federali</button></form></section>`;
    }
    html += `<details><summary>PATTY · Correggi dato</summary><form data-form="game-edit" data-key="${esc(key)}">${select(
      'Campo',
      'field',
      Object.entries(FIELDS).map(([k, v]) => [k, v]),
    )}${field('Nuovo valore', 'value')}${field('Motivo / riferimento', 'reason')}<button>Salva modifica</button></form></details>`;
    if (g.is_home) {
      const people = state.admin.people.filter((p) => p.approved);
      html += `<details><summary>PATTY · Assegna un posto libero</summary><form data-form="assign" data-key="${esc(key)}">${select('Ruolo', 'role', Object.entries(ROLES))}${field('Posto', 'slot', '1', 'number', true)}${select(
        'Persona',
        'person_id',
        people.map((p) => [p.id, p.first_name + ' ' + p.last_name]),
      )}<button>Assegna</button></form></details>`;
    }
    const conflicts = state.admin.conflicts.filter((c) => c.game_key === key);
    html += conflicts.length
      ? '<details open><summary>Dati ufficiali diversi / conflitti da verificare</summary>' +
        conflicts
          .map(
            (c) =>
              `<p class="notice">${esc(FIELDS[c.field] || c.field)}: ${esc(c.incoming)}</p>${FIELDS[c.field] ? `<button data-reset="${esc(c.field)}" data-game="${esc(key)}">Usa valore ufficiale</button>` : ''}`,
          )
          .join('') +
        '</details>'
      : '';
    html +=
      '<details><summary>Storico modifiche</summary><div id="history">Caricamento…</div></details>';
  }
  modal('Scheda partita', html);
  if (state.user?.admin) {
    const history = await api('admin/audit?game_key=' + encodeURIComponent(key));
    if (currentGame === key && $('#history'))
      $('#history').innerHTML =
        history.audit
          .map(
            (a) =>
              `<p class="notice">${esc(a.changed_at)} · ${esc(a.actor)} · ${esc(a.action)} · ${esc(a.details)}</p>`,
          )
          .join('') || 'Nessuna modifica manuale.';
  }
}
function teamForm(t = {}) {
  return `<form data-form="team" data-id="${esc(t.id || '')}"><div class="grid">${select(
    'Comitato',
    'source',
    [
      ['FIPAV', 'FIPAV'],
      ['PGS', 'PGS'],
    ],
    t.source || 'FIPAV',
  )}${field('Stagione', 'season', t.season || '2026-2027', 'text', true)}${field('ID ufficiale squadra', 'official_team_id', t.official_team_id || '', 'text', true)}${field('Girone FIPAV / PGS', 'group_id', t.group_id || '')}${field('Codice campionato PGS', 'competition', t.competition || '')}${field('Nome ufficiale', 'name', t.name || '', 'text', true)}${field('Categoria', 'category', t.category || '', 'text', true)}${field('Nome breve smartphone', 'short_name', t.short_name || '', 'text', true)}${field('Primo allenatore', 'coach1', t.coach1 || '')}${field('Secondo allenatore', 'coach2', t.coach2 || '')}</div><label class="field">Dirigenti (uno per riga)<textarea name="managers">${esc(t.managers || '')}</textarea></label>${check('Squadra attiva per gli aggiornamenti', 'active', t.active !== 0)}<div class="actions"><button>Salva scheda squadra</button></div></form>`;
}
function renderAdmin() {
  const a = state.admin;
  if (!a) return;
  const pending = a.games.filter((g) => !g.date || !g.time);
  let html = `<h2>PATTY · Comandi riservati</h2><div class="actions"><button data-sync="calendar" class="primary">↻ Aggiorna tutti i calendari</button><button data-sync="results">↻ Aggiorna tutti i risultati</button></div><p class="notice">Aggiorna tutte le squadre attive. Le gare non vengono duplicate; le correzioni manuali e le prenotazioni sono conservate.</p>`;
  html += `<details><summary>Codice PATTY · 4 caratteri ${state.patty_pin_set ? '(attivo)' : '(da impostare)'}</summary><p class="notice">Salva il codice: al prossimo accesso sostituirà la password precedente.</p><form data-form="patty-pin">${codeField('Nuovo codice PATTY', 'pin')}${codeField('Ripeti il codice', 'confirm')}<button>Salva codice PATTY</button></form></details>`;
  html += `<details ${pending.length ? 'open' : ''}><summary>🔵 Gare con dati primari incompleti (${pending.length})</summary>${pending.map((g) => `<div class="card"><p>${esc(g.category)} · ${esc(g.source)} · Gara ${esc(g.game_number)}</p><small>${esc(g.home_team)} – ${esc(g.away_team)}</small><form data-form="pending" data-key="${esc(g.game_key)}"><div class="grid">${field('Data confermata', 'date', g.date || '', 'date', true)}${field('Ora confermata', 'time', g.time || '', 'time', true)}</div>${field('Motivo / riferimento', 'reason')}<button>Salva e inserisci nel calendario</button></form></div>`).join('') || '<p>Nessuna gara incompleta.</p>'}</details>`;
  html +=
    '<details><summary>Persone registrate (' + a.people.length + ')</summary>' +
    (a.people.map((p) => {
      const roles = [
        ['wants_referee', 'Arbitro'], ['wants_scorer', 'Refertista'],
        ['wants_manager', 'Dirigente'], ['wants_coach', 'Allenatore']
      ].filter(([key]) => p[key]).map(([, label]) => label).join(', ') || 'Nessun ruolo';
      return `<div class="person"><b>${esc(p.first_name + ' ' + p.last_name)}</b>
        <p class="notice">${esc(roles)} · ${p.approved ? 'Attivo' : 'Disattivato'}</p>
        <button type="button" data-person-access="${esc(p.id)}"
          data-approved="${p.approved ? 'false' : 'true'}">${p.approved ? 'Disattiva account' : 'Riattiva account'}</button>
      </div>`;
    }).join('') || '<p>Nessuna persona registrata.</p>') + '</details>';
  const roster=a.roster||[];
  html += '<details><summary>Archivio 21 squadre · ' + roster.filter(x=>x.linked_team_id).length +
    ' collegate</summary><p class="notice">Solo le squadre collegate a un identificativo ufficiale partecipano agli aggiornamenti. Le modifiche agli allenatori e dirigenti si propagano a tutte le partite della squadra.</p>' +
    '<p><button type="button" data-roster-pgs>Trova e collega le squadre PGS</button></p>' +
    roster.map(r=>`<details class="card"><summary>${r.id}. ${esc(r.category)} ${esc(r.source)} · ${esc(r.name)} · ${r.linked_team_id?'Collegata':'Da collegare'}</summary>
      ${r.linked_team_id?`<p class="notice">Nome ufficiale: ${esc(r.official_name)} · ${esc(r.official_group||'')}</p>`:'<p class="notice">Identificativo ufficiale ancora da verificare.</p>'}
      <form data-form="roster-staff" data-id="${r.id}">
        <div class="grid">${field('Allenatore 1','coach1',r.coach1)}${field('Allenatore 2','coach2',r.coach2)}</div>
        <label class="field">Dirigenti<textarea name="managers">${esc(r.managers)}</textarea></label><button>Salva staff</button>
      </form>
      ${!r.linked_team_id&&r.source==='FIPAV'?`<form data-form="roster-fipav" data-id="${r.id}">${field('Codice girone FIPAV','group_id','','text',true)}<button>Verifica e collega il calendario</button></form>`:''}
    </details>`).join('')+'</details>';
  html +=
    '<details><summary>Squadre · Staff · Nomi brevi · Incarichi FISSI</summary>' +
    a.teams
      .map(
        (t) =>
          `<details><summary>${esc(t.category + ' · ' + t.source + ' · ' + t.name)}</summary>${teamForm(t)}${Object.entries(
            ROLES,
          )
            .map(
              ([r, label]) =>
                `<form data-form="fixed" data-team="${esc(t.id)}" data-role="${r}">${select(label + ' FISSO', 'person_id', [['', 'Nessuno'], ...a.people.filter((p) => p.approved && p['wants_' + r]).map((p) => [p.id, p.first_name + ' ' + p.last_name])], a.fixed.find((f) => f.team_id === t.id && f.role === r)?.person_id || '')}<button>Salva incarico fisso</button></form>`,
            )
            .join('')}</details>`,
      )
      .join('') +
    '<details><summary>Aggiungi squadra</summary>' +
    teamForm() +
    '</details></details>';
  html += `<details><summary>Inserimento manuale di una gara</summary><form data-form="manual">${select(
    'Squadra',
    'team_id',
    a.teams.map((t) => [t.id, t.category + ' · ' + t.name]),
  )}${field('Avversaria', 'opponent', '', 'text', true)}${check('Gara in casa', 'is_home', true)}<div class="grid">${field('Data', 'date', '', 'date', true)}${field('Ora', 'time', '', 'time', true)}</div>${field('Palestra', 'venue')}${field('Indirizzo', 'address')}${field('Numero gara', 'game_number')}<button>Salva gara manuale</button></form></details>`;
  const removed = a.games.filter((g) => g.hidden || g.source_missing);
  html +=
    '<details><summary>Gare nascoste / assenti dalla fonte (' +
    removed.length +
    ')</summary>' +
    removed
      .map(
        (g) =>
          `<p>${esc(g.game_number + ' · ' + g.home_team + ' – ' + g.away_team)} <button data-open="${esc(g.game_key)}">Vedi scheda</button></p>`,
      )
      .join('') +
    '</details>';
  html +=
    '<details><summary>Stato aggiornamenti · Backup · Utilizzo</summary>' +
    a.sync
      .map(
        (s) => `<p class="notice">${esc(s.scope)} · ${esc(s.at)} · ${esc(s.error || s.report)}</p>`,
      )
      .join('') +
    '<p class="notice">Il backup contiene dati personali e hash delle password: conservarlo in un archivio privato. La chiave segreta delle password deve essere custodita separatamente.</p><div class="actions"><button data-backup>Esporta backup riservato</button><button data-usage>Controlla utilizzo</button></div><div id="usage"></div></details>';
  $('#admin').innerHTML = html;
}
async function syncAll(resultsOnly) {
  const scopes = [
    ...new Set(
      state.teams
        .filter((t) => t.active)
        .map((t) =>
          [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':'),
        ),
    ),
  ];
  const reports = [];
  const buttons = [...document.querySelectorAll('[data-sync]')];
  buttons.forEach((b) => (b.disabled = true));
  for (const scope of scopes) {
    try {
      notice('Aggiornamento ' + scope + '…');
      const job = await api('admin/sync', { scope, results_only: resultsOnly });
      let step;
      do {
        step = await api('admin/sync/step', { job_id: job.job_id });
        notice(`${scope}: ${step.offset}/${step.total} gare elaborate…`);
      } while (!step.done);
      reports.push(
        scope +
          ': ' +
          step.report.inserted +
          ' nuove, ' +
          step.report.updated +
          ' aggiornate, ' +
          step.report.unchanged +
          ' invariate' +
          (step.report.errors.length
            ? ' · ' + step.report.errors.map((x) => x.error).join('; ')
            : '') +
          (step.report.fixed_conflicts.length
            ? ' · ' + step.report.fixed_conflicts.length + ' conflitti incarichi fissi'
            : ''),
      );
    } catch (e) {
      reports.push(scope + ': ' + e.message);
    }
  }
  await load();
  notice(reports.join(' | '));
}
function formData(f) {
  return Object.fromEntries(new FormData(f));
}
async function submit(f) {
  const kind = f.dataset.form,
    b = formData(f);
  switch (kind) {
    case 'login':
      await api('auth/login', { ...b, admin: f.dataset.admin === 'true' });
      $('#dialog').close();
      await load();
      return;
    case 'register':
      await api('auth/register', {
        ...b,
        wants_referee: !!b.wants_referee,
        wants_scorer: !!b.wants_scorer,
        wants_manager: !!b.wants_manager,
        wants_coach: !!b.wants_coach,
        staging_consent: !!b.staging_consent,
      });
      $('#dialog').close();
      await load();
      notice('Registrazione completata. Sei già connesso.');
      return;
    case 'patty-pin':
      await api('admin/pin', { pin: b.pin, confirm: b.confirm });
      f.reset();
      await load();
      notice('Codice PATTY aggiornato. Usalo al prossimo accesso.');
      return;
    case 'pending': {
      const r = await api('admin/game', {
        game_key: f.dataset.key,
        patch: { date: b.date, time: b.time },
        reason: b.reason,
      });
      state.week = weekOf(r.game.date);
      break;
    }
    case 'federal': {
      await api('admin/game', {
        game_key: f.dataset.key,
        patch: {
          federal_referee: !!b.federal_referee,
          federal_scorer: !!b.federal_scorer,
        },
        reason: 'PATTY · Designazione federale',
      });
      break;
    }
    case 'game-edit': {
      let value = b.value;
      if (['home_sets', 'away_sets', 'required_referees', 'required_scorers'].includes(b.field)) {
        if (!/^\d+$/.test(value)) throw new Error('Inserisci un numero intero.');
        value = Number(value);
      }
      if (['hidden', 'played'].includes(b.field)) {
        if (!['true', 'false'].includes(value)) throw new Error('Scrivi true oppure false.');
        value = value === 'true';
      }
      if (b.field === 'sets') {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error('Parziali JSON non validi.');
        }
      }
      const r = await api('admin/game', {
        game_key: f.dataset.key,
        patch: { [b.field]: value },
        reason: b.reason,
      });
      if (r.game.date) state.week = weekOf(r.game.date);
      break;
    }
    case 'roster-staff':
      await api('admin/roster/staff',{id:Number(f.dataset.id),coach1:b.coach1,coach2:b.coach2,managers:b.managers});
      break;
    case 'roster-fipav':
      await api('admin/roster/fipav-link',{id:Number(f.dataset.id),group_id:b.group_id});
      break;
    case 'team':
      await api('admin/team', { ...b, id: f.dataset.id || undefined, active: !!b.active });
      break;
    case 'fixed': {
      const r = await api('admin/fixed', {
        team_id: f.dataset.team,
        role: f.dataset.role,
        person_id: b.person_id || null,
      });
      const conflicts = [];
      for (const g of r.pending) {
        const applied = await api('admin/fixed/apply', { game_key: g.game_key });
        conflicts.push(...applied.conflicts);
      }
      if (conflicts.length) notice(conflicts.map((c) => c.error).join('; '));
      break;
    }
    case 'assign':
      await api('admin/assign', {
        game_key: f.dataset.key,
        role: b.role,
        slot: Number(b.slot),
        person_id: b.person_id,
      });
      break;
    case 'manual':
      await api('admin/manual', {
        team_id: b.team_id,
        opponent: b.opponent,
        is_home: !!b.is_home,
        patch: {
          date: b.date,
          time: b.time,
          venue: b.venue || 'Palestra non indicata',
          address: b.address,
          game_number: b.game_number || 'MANUALE',
        },
      });
      state.week = weekOf(b.date);
      break;
    default:
      return;
  }
  const reopen = $('#dialog').open && currentGame;
  await load();
  if (reopen) await showGame(currentGame);
  notice('Salvato.', !!reopen);
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches('form[data-form]')) return;
  e.preventDefault();
  const f = e.target,
    button = f.querySelector('button');
  if (button) button.disabled = true;
  try {
    await submit(f);
  } catch (error) {
    notice(error.message, !!f.closest('dialog'));
  } finally {
    if (button) button.disabled = false;
  }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.id === 'close-dialog') {
      $('#dialog').close();
      currentGame = null;
    } else if (b.id === 'home') {
      state.week = null;
      render();
    } else if (b.dataset.week) {
      state.week = b.dataset.week;
      render();
    } else if (b.id === 'access') {
      if (state.user && !state.user.admin) {
        await api('auth/logout', {});
        await load();
      } else access(false);
    } else if (b.id === 'patty') {
      if (state.user?.admin) {
        await api('auth/logout', {});
        await load();
      } else access(true);
    } else if (b.dataset.open) await showGame(b.dataset.open);
    else if (b.hasAttribute('data-book') || b.hasAttribute('data-cancel')) {
      const booking = b.hasAttribute('data-book');
      const g =
        state.games.find((g) => g.game_key === b.dataset.game) ||
        state.admin?.games.find((g) => g.game_key === b.dataset.game);
      if (!g) throw new Error('Partita non trovata. Riapri la scheda.');
      $('#action-confirmation')?.remove();
      const panel = document.createElement('section');
      panel.id = 'action-confirmation';
      panel.className = 'action-confirmation';
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-labelledby', 'action-confirmation-title');
      const message = booking
        ? 'Ti stai prenotando per questa partita'
        : state.user?.admin
          ? 'Stai rimuovendo questo incarico da questa partita'
          : 'Stai annullando la tua prenotazione per questa partita';
      const attrs = `data-game="${esc(b.dataset.game)}" data-role="${esc(b.dataset.role)}" data-slot="${esc(b.dataset.slot)}"`;
      panel.innerHTML = `<h3 id="action-confirmation-title">${message}</h3>
        <p><strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></p>
        <p>${esc(g.date || 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(ROLES[b.dataset.role] || 'Incarico')}</p>
        <div class="actions">
          <button type="button" class="primary" data-confirm-action data-action="${booking ? 'book' : 'cancel'}" ${attrs}>Conferma</button>
          <button type="button" data-abort-action>Indietro</button>
        </div>`;
      $('#dialog-content').prepend(panel);
      panel.querySelector('[data-confirm-action]').focus();
    } else if (b.hasAttribute('data-abort-action')) {
      $('#action-confirmation')?.remove();
    } else if (b.hasAttribute('data-confirm-action')) {
      b.disabled = true;
      await api(b.dataset.action, {
        game_key: b.dataset.game,
        role: b.dataset.role,
        slot: Number(b.dataset.slot),
      });
      await load();
      await showGame(b.dataset.game);
      notice(b.dataset.action === 'book' ? 'Prenotazione confermata.' : 'Prenotazione annullata.', true);
    } else if (b.hasAttribute('data-roster-pgs')) {
      b.disabled=true;
      const result=await api('admin/roster/pgs-search',{});
      await load();
      notice('PGS: ' + result.linked.length + ' nuove squadre collegate; ' +
        result.pending.length + ' ancora da verificare.' +
        (result.pending.length ? ' ' + result.pending.map(x =>
          x.name + ' (' + x.reason + ')').join('; ') : ''));
    } else if (b.hasAttribute('data-person-access')) {
      const approved = b.dataset.approved === 'true';
      if (!confirm('Vuoi ' + (approved ? 'riattivare' : 'disattivare') + ' questo account?')) return;
      b.disabled = true;
      await api('admin/person', { id: b.dataset.personAccess, approved });
      await load();
      notice(approved ? 'Account riattivato.' : 'Account disattivato.');
    } else if (b.dataset.sync) await syncAll(b.dataset.sync === 'results');
    else if (b.dataset.reset) {
      await api('admin/override/reset', { game_key: b.dataset.game, field: b.dataset.reset });
      await load();
      await showGame(b.dataset.game);
    } else if (b.hasAttribute('data-backup')) {
      const data = await api('admin/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = 'volley-control-backup-' + isoNow() + '.json';
      a.click();
      URL.revokeObjectURL(u);
    } else if (b.hasAttribute('data-usage')) {
      const data = await api('admin/usage');
      const d = data.daily[0];
      $('#usage').textContent =
        (d
          ? `${d.day}: ${d.requests} richieste, ${d.reads} righe lette, ${d.writes} righe scritte. `
          : 'Nessun conteggio ancora disponibile. ') +
        data.quota_scope +
        ' ' +
        (data.account_plan_verified
          ? 'Piano Free verificato al momento della configurazione.'
          : 'Piano dell’account ancora da verificare prima della pubblicazione.');
    }
  } catch (error) {
    notice(error.message, $('#dialog').open);
    b.disabled = false;
  }
});
load().then(connectLive).catch((e) => notice(e.message));
