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
// NOVAVISION: gestione manuale definitiva, esclusa dai collegamenti automatici.
const manualCalendarOnly = (team) => /\bNOVAVISION\b/i.test(team.name || '');
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
// Evidenzia esclusivamente le partite dell'utente nell'area personale.
// Vale anche per gli incarichi FISSI assegnati da PATTY.
const myBooking = (g) =>
  !!state.user?.id && !state.user.admin &&
  state.assignments.some((a) => a.game_key === g.game_key && a.person_id === state.user.id);
// Colori di riconoscimento dello staff, solo nell'area personale.
// Lo staff delle squadre usa spesso soltanto il nome: confrontiamo il nome
// completo quando presente, altrimenti il nome esatto, mai sottostringhe.
const staffName = (name) => String(name || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
function staffMatches(value, user) {
  if (!user?.first_name || !user?.last_name) return false;
  const first = staffName(user.first_name),
    full = staffName(user.first_name + ' ' + user.last_name);
  return String(value || '').split(/[\n,;/]+/)
    .some((part) => {
      const listed = staffName(part);
      return listed && (listed === first || listed === full);
    });
}
function myStaffColor(g, team) {
  const u = state.user;
  if (!u?.id || u.admin) return '';
  const staff = g.staff_override || team;
  if (u.wants_coach && (staffMatches(staff.coach1, u) || staffMatches(staff.coach2, u)))
    return ' my-coach';
  if (u.wants_manager && staffMatches(staff.managers, u))
    return ' my-manager';
  return '';
}
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
// PATTY: rinnovo discreto solo mentre l'organizzatore usa l'app.
let lastPattyActivity = Date.now();
for (const eventName of ['pointerdown', 'keydown', 'scroll']) {
  document.addEventListener(eventName, () => { lastPattyActivity = Date.now(); }, { passive: true });
}
async function renewActivePattySession() {
  if (!state.user?.admin || document.hidden ||
      Date.now() - lastPattyActivity > 15 * 60 * 1000) return;
  try {
    const me = await api('me');
    if (!me.user?.admin) {
      state.user = null;
      state.csrf = null;
      state.admin = null;
      render();
    }
  } catch {
    // Nessun messaggio invasivo: la prossima operazione verificherà l'accesso.
  }
}
// Controllo leggero ogni cinque minuti; il server scrive solo vicino alla scadenza.
setInterval(renewActivePattySession, 5 * 60 * 1000);
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
  if (!document.hidden) {
    renewActivePattySession();
    refreshLiveCalendar();
  }
});
async function load() {
  const [me, c] = await Promise.all([api('me'), api('calendar')]);
  state = { ...state, ...me, ...c };
  if (state.user && !state.user.admin) rememberRegisteredOnThisDevice();
  if (state.user?.admin) state.admin = await api('admin/state');
  else state.admin = null;
  render();
}
function render() {
  const pending = state.games.filter((g) => !g.date || !g.time);
  $('#patty').textContent = state.user?.admin
    ? (state.user.id ? '🔓 Torna all’area personale' : '🔓 Esci da PATTY')
    : state.user?.can_access_patty ? '🔒 Entra in PATTY' : '🔒 PATTY';
  $('#patty').append(
    Object.assign(document.createElement('span'), {
      id: 'pending-dot',
      textContent: pending.length ? ' ●' : '',
    }),
  );
  $('#identity').textContent =
    state.user?.id ? state.user.first_name + ' ' + state.user.last_name : '';
  $('#access').textContent =
    state.user?.id ? 'Esci dall’area personale' : 'Area personale';
  const games = state.games.filter((g) => g.date && g.time && !g.hidden);
  const weeks = [...new Set(games.map((g) => weekOf(g.date)))].sort();
  const baseWeek = state.week || weekOf(isoNow());
  const prevWeek = [...weeks].reverse().find((x) => x < baseWeek),
    nextWeek = weeks.find((x) => x > baseWeek),
    range = (x) => weekLabel(x).replace('GARE ', '');
  $('#weeks').innerHTML =
    `<button class="step" ${prevWeek ? `data-week="${prevWeek}"` : 'disabled'} aria-label="Settimana precedente">‹</button>` +
    `<label class="week-pick"><span>${state.week ? 'Settimana' : 'Settimana corrente'}</span>` +
    `<select id="week-select" aria-label="Scegli la settimana"><option value="">Home · ${range(baseWeek)}</option>` +
    weeks.map((x) => `<option value="${x}" ${state.week === x ? 'selected' : ''}>${range(x)}</option>`).join('') +
    `</select></label>` +
    `<button class="step" ${nextWeek ? `data-week="${nextWeek}"` : 'disabled'} aria-label="Settimana successiva">›</button>`;
  const w = state.week || weekOf(isoNow());
  $('#title').textContent = state.week ? weekLabel(w) :
    (state.user?.id && !state.user.admin ? 'Gare da coprire e mie prenotazioni' : 'Gare casalinghe da coprire');
  $('#title').classList.toggle('sr-only', !!state.week);
  let rows = games.filter((g) => weekOf(g.date) === w);
  if (!state.week)
    rows = rows.filter(
      (g) =>
        g.is_home &&
        (roleState(g, 'referee') === 'missing' || roleState(g, 'scorer') === 'missing' || myBooking(g)),
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
    rows.map((g, i) => rowHTML(g, i > 0 && rows[i - 1].date !== g.date)).join('') ||
    '<p class="notice">Nessuna gara da mostrare. Scegli una settimana per consultare tutte le partite.</p>';
  $('#admin').hidden = !state.user?.admin;
  if (state.user?.admin) renderAdmin();
}
function rowHTML(g, newDay = false) {
  const t = state.teams.find((t) => t.id === g.team_id) || {},
    cat = (g.category.match(/\bU\s*\d+/i)?.[0].replace(/\s/g, '') || g.category).replace(/DIVISIONE/i, 'DIV.'),
    longCat = cat.length > 5,
    weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(g.date + 'T12:00:00Z'),
    ),
    day = weekday.charAt(0).toUpperCase() + weekday.slice(1),
    score = g.played ? `<span class="score">${esc(g.home_sets + '–' + g.away_sets)}</span>` : '',
    who = [['referee', 'Arb'], ['scorer', 'Ref']]
      .filter(([r]) => names(g, r))
      .map(([r, l]) => l + ': ' + names(g, r))
      .join(' · '),
    whoHtml = who ? '<small class="who">' + esc(who) + '</small>' : '',
    booked = myBooking(g),
    staffColor = booked ? '' : myStaffColor(g, t),
    mark = (r, label) => `<span class="mark">${dot(g, r)}<small>${label}</small></span>`,
    seats = g.is_home
      ? `<span class="seats">${mark('referee', 'Arb')}${mark('scorer', 'Ref')}</span>`
      : '<span class="seats"><span class="tag-away">Trasferta</span></span>';
  return `<article class="fixture${g.is_home ? '' : ' away'}${newDay ? ' new-day' : ''}${booked ? ' my-booking' : staffColor}" data-game-key="${esc(g.game_key)}"><div class="mobile"><span class="identity"><span class="cat${longCat ? ' cat--long' : ''}">${esc(cat)}</span><span class="source">${esc(g.source)}</span><span class="short">${esc(t.short_name || g.our_team_name)}</span></span><span class="when"><b>${esc(day)} ${shortDate(g.date)}</b><em>${esc(g.time)}</em></span><span class="teams" title="${esc(g.home_team + ' – ' + g.away_team)}"><span class="t${g.is_home ? ' us' : ''}">${esc(g.home_team)}</span> – <span class="t${g.is_home ? '' : ' us'}">${esc(g.away_team)}</span>${score}${whoHtml}</span>${seats}</div><button class="open-game" data-open="${esc(g.game_key)}" aria-label="Apri la scheda: ${esc(g.home_team)} – ${esc(g.away_team)}"></button></article>`;
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
// Ricorda solo se questo dispositivo ha già completato un accesso personale.
// Non vengono mai salvati nome, cognome o codice personale.
const personalAccessMarker = 'volley-control-registrato-v1';
let registeredOnThisDevice = false;
function hasRegisteredOnThisDevice() {
  if (registeredOnThisDevice) return true;
  try { return localStorage.getItem(personalAccessMarker) === '1'; } catch { return false; }
}
function rememberRegisteredOnThisDevice() {
  registeredOnThisDevice = true;
  try { localStorage.setItem(personalAccessMarker, '1'); } catch { /* Memoria locale non disponibile. */ }
}
function access(admin = false, view = '') {
  const names = field('Nome', 'first_name', '', 'text', true) +
    field('Cognome', 'last_name', '', 'text', true);
  if (admin) {
    const credentials = state.patty_pin_set
      ? codeField('Codice PATTY (4 caratteri)', 'password')
      : field('Password PATTY attuale', 'password', '', 'password', true);
    modal('PATTY · Accesso organizzatore',
      `<form data-form="login" data-admin="true">${credentials}<button class="primary">Accedi</button></form>`);
    return;
  }
  const showRegister = state.registration_enabled &&
    (view === 'register' || (view !== 'login' && !hasRegisteredOnThisDevice()));
  if (showRegister) {
    modal('Prima registrazione',
      `<p class="notice">Inserisci nome, cognome e un codice personale di 4 caratteri, con lettere o numeri. Conserva il codice per i prossimi accessi.</p>
      <form data-form="register">${names}${codeField('Codice di 4 caratteri', 'password')}
      <p class="notice">Seleziona almeno un ruolo. Puoi sceglierne più di uno: basta un solo account.</p>
      <div class="checks">${check('Arbitro', 'wants_referee')}${check('Refertista', 'wants_scorer')}${check('Dirigente', 'wants_manager')}${check('Allenatore', 'wants_coach')}</div>
      <div class="actions"><button class="primary">Registrati ed entra</button></div></form>
      <p class="access-switch">Sei già registrato? <button type="button" data-access-view="login">Accedi</button></p>`);
    return;
  }
  modal('Area personale · Accesso',
    `<form data-form="login" data-admin="false">${names}${codeField('Codice personale (4 caratteri)', 'password')}
    <button class="primary">Accedi</button></form>${!state.registration_enabled
      ? '<p class="notice">Registrazioni non ancora aperte in questo ambiente.</p>'
      : !hasRegisteredOnThisDevice()
        ? '<p class="access-switch">È la prima volta? <button type="button" data-access-view="register">Registrati</button></p>'
        : ''}`);
}
function resultCard(g) {
  const partials = (g.sets || []).map((s, i) =>
    ((s.number || i + 1) === 6 ? 'Golden set' : (s.number || i + 1) + '° set') +
    ' ' + s.home + '–' + s.away).join(' · ');
  if (!state.user?.admin)
    return card('Risultato', g.played ? g.home_sets + ' – ' + g.away_sets : 'Non ancora disponibile', partials);
  const scoreInput = (name, value, label, max, required = false) =>
    `<input aria-label="${esc(label)}" name="${name}" type="number" min="0" max="${max}" step="1" inputmode="numeric" value="${esc(value ?? '')}" ${required ? 'required' : ''} style="width:100%;min-width:0;box-sizing:border-box">`;
  return `<section class="card"><h3>Risultato</h3><form data-form="result" data-key="${esc(g.game_key)}">
    <table style="width:100%;table-layout:fixed"><thead><tr><th style="width:28%"></th><th scope="col" style="overflow-wrap:anywhere">Casa<br>${esc(g.home_team)}</th><th scope="col" style="overflow-wrap:anywhere">Ospite<br>${esc(g.away_team)}</th></tr></thead><tbody>
    <tr><th scope="row">Finale</th><td>${scoreInput('home_sets', g.home_sets, 'Set vinti casa', 6, true)}</td><td>${scoreInput('away_sets', g.away_sets, 'Set vinti ospite', 6, true)}</td></tr>
    ${Array.from({ length: 6 }, (_, i) => {
      const n = i + 1, s = (g.sets || []).find((s, j) => (s.number || j + 1) === n);
      const label = n === 6 ? 'Golden set' : n + '° set';
      return `<tr><th scope="row">${label}</th><td>${scoreInput('set_' + n + '_home', s?.home, label + ' casa', 100)}</td><td>${scoreInput('set_' + n + '_away', s?.away, label + ' ospite', 100)}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="notice">Finale: set vinti da casa e ospite. Compila i parziali disponibili e lascia vuoti i set non giocati. Il Golden set resta separato dal finale.</p>
    <button class="primary">Salva risultato</button>
  </form></section>`;
}
function resultPatch(values) {
  const integer = (value, max) => {
    if (!/^\d+$/.test(String(value ?? '')) || Number(value) > max)
      throw new Error('Inserisci numeri interi da 0 a ' + max + '.');
    return Number(value);
  };
  const patch = { home_sets: integer(values.home_sets, 6), away_sets: integer(values.away_sets, 6), played: true, sets: [] };
  let gap = false;
  for (let n = 1; n <= 6; n++) {
    const home = values['set_' + n + '_home'] ?? '', away = values['set_' + n + '_away'] ?? '';
    if (home === '' && away === '') { if (n < 6) gap = true; continue; }
    if (home === '' || away === '') throw new Error('Completa entrambi i punteggi del ' + (n === 6 ? 'Golden set' : n + '° set') + '.');
    if (n < 6 && gap) throw new Error('Compila i parziali in ordine, senza saltare set.');
    const s = { home: integer(home, 100), away: integer(away, 100) };
    if (s.home === s.away) throw new Error('Un set concluso non può finire in parità.');
    if (n === 6) s.number = 6;
    patch.sets.push(s);
  }
  return patch;
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
        const allowed = state.user && !state.user.admin && !!state.user['wants_' + r] && !g.source_missing && !isFederal;
        const patty = !!state.user?.admin;
        const eligible = patty
          ? (state.admin?.people || []).filter((p) => p.approved && p['wants_' + r])
          : [];
        const pattyBooking = `<div class="patty-seat-book">${select('Seleziona ' + (r === 'referee' ? 'arbitro' : 'refertista'), 'person_id', [['', 'Scegli una persona'], ...eligible.map((p) => [p.id, p.first_name + ' ' + p.last_name])])}<button type="button" data-admin-book ${data} ${eligible.length && !g.source_missing ? '' : 'disabled'}>${eligible.length ? 'Prenota' : 'Nessuna persona disponibile'}</button></div>`;
        const currentAction = isFederal
          ? (patty ? '<small class="notice">Modifica la designazione federale qui sotto.</small>' : '')
          : a
            ? (patty || (state.user?.id === a.person_id && a.source === 'self')
                ? `<button type="button" data-cancel ${data}>${patty ? 'Togli prenotazione' : 'Annulla la mia prenotazione'}</button>`
                : '')
            : patty
              ? pattyBooking
              : state.user && !state.user.admin && !state.user['wants_' + r]
                ? '<small class="notice">Non abilitato a questo ruolo</small>'
                : `<button type="button" data-book ${data} ${allowed ? '' : 'disabled'} title="${allowed ? 'Prenota questo incarico' : 'Accedi dall’area personale per prenotarti'}">${allowed ? (r === 'referee' ? 'Arbitro io' : 'Referto io') : 'Accedi per prenotarti'}</button>`;
        seats += `<div class="seat"><span>${dot(g, r)} <b>${label}${required(g, r) > 1 ? ' ' + slot : ''}:</b> ${isFederal ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') : a ? esc(a.first_name + ' ' + a.last_name) : 'Posto libero'}</span>${currentAction}</div>`;
      }
  }
  const addrParts = [g.venue, ...String(g.address || '').split(/\s+-\s+/)].map((x) => (x || '').trim()).filter(Boolean).slice(0, 3);
  const mapsLink = addrParts.length
    ? `<a class="maps pin" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((g.venue || '') + ' ' + (g.address || ''))}" target="_blank" rel="noopener" aria-label="Apri in Google Maps" title="Apri in Google Maps"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg></a>`
    : '';
  const placeBlock = `<div class="place"><div class="place-text"><h3>Palestra e indirizzo</h3>${addrParts.map((x, i) => `<p class="${i ? 'addr' : 'venue'}">${esc(x)}</p>`).join('') || '<p class="venue">Da inserire</p>'}</div>${mapsLink}</div>`;
  const staffLine = (label, value) => `<div class="staff-line"><small>${esc(label)}</small><p>${esc(value || '—')}</p></div>`;
  const staff = g.staff_override || t;
  const managers = String(staff.managers || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  // Per PATTY lo staff già presente è direttamente modificabile, senza pannelli extra.
  const staffBlock = state.user?.admin
    ? `<div class="staff"><h3>Staff squadra${g.staff_override ? ' · Solo questa partita' : ''}</h3>
      <form class="staff-inline-form" data-form="game-staff" data-key="${esc(key)}">
        <label class="staff-inline-row"><span>Allenatore</span><input type="text" name="coach1" value="${esc(staff.coach1 || '')}" placeholder="Da inserire" maxlength="1000"></label>
        <label class="staff-inline-row"><span>Secondo allenatore</span><input type="text" name="coach2" value="${esc(staff.coach2 || '')}" placeholder="Da inserire" maxlength="1000"></label>
        <label class="staff-inline-row"><span>Dirigenti</span><textarea name="managers" rows="2" maxlength="1000" placeholder="Da inserire · uno per riga">${esc(staff.managers || '')}</textarea></label>
        <input type="hidden" name="scope" value="match">
        <div class="staff-inline-save">
          <button type="submit" class="primary" data-staff-scope="match">Solo questa volta</button>
          <button type="submit" data-staff-scope="permanent">Per sempre</button>
        </div>
        ${g.staff_override ? `<button type="button" class="staff-reset" data-staff-reset data-game="${esc(key)}">Ripristina lo staff della squadra</button>` : ''}
      </form></div>`
    : `<div class="staff"><h3>Staff squadra</h3>${staffLine('Allenatore', staff.coach1 || 'Da inserire')}${staffLine('Secondo allenatore', staff.coach2)}${managers.length ? managers.map((m, i) => staffLine(i ? '' : managers.length > 1 ? 'Dirigenti' : 'Dirigente', m)).join('') : staffLine('Dirigenti', 'Da inserire')}</div>`;
  let html = `<div class="sheet-hero">${esc(g.date ? shortDate(g.date) + '/' + g.date.slice(0, 4) : 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(g.category)} · ${esc(g.source)}<strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></div>${g.is_home ? '<h3>Prenotazioni · Gare in casa</h3>' + seats : '<p class="notice">Trasferta: non sono richiesti arbitro e refertista interni.</p>'}<div class="strip"><span>Gara <b>${esc(g.game_number || 'n. non presente')}</b></span><span class="pill ${g.is_home ? 'home' : 'away'}">${g.is_home ? 'Casa' : 'Trasferta'}</span><span>${esc(g.source)}</span></div>${placeBlock}${staffBlock}${resultCard(g)}${g.notes ? card('Note', g.notes) : ''}`;
  if (state.user?.admin) {
    // Ogni correzione di una singola partita avviene nella sua scheda.
    // Una gara incompleta deve ricevere data e ora insieme, senza duplicare moduli altrove.
    if (!g.date || !g.time) {
      html += `<section class="card"><h3>PATTY · Completa data e ora</h3>
        <form data-form="pending" data-key="${esc(key)}">
          <div class="grid">${field('Data confermata', 'date', g.date || '', 'date', true)}${field('Ora confermata', 'time', g.time || '', 'time', true)}</div>
          ${field('Motivo / riferimento', 'reason')}
          <button class="primary">Salva data e ora della partita</button>
        </form></section>`;
    }
    if (g.is_home) {
      html += `<section class="card"><h3>PATTY · Designazione federale</h3><form data-form="federal" data-key="${esc(key)}"><div class="actions">${check('Arbitro federale', 'federal_referee', federal(g, 'referee'))}${check('Refertista federale', 'federal_scorer', federal(g, 'scorer'))}</div><p class="notice">Federale: posto coperto e non prenotabile. Se già occupato, rimuovi prima l’incarico.</p><button class="primary">Salva scelta federali</button></form></section>`;
      const fixedPeople = (state.admin?.people || [])
        .filter((p) => p.approved && (p.wants_referee || p.wants_scorer))
        .map((p) => [p.id, p.first_name + ' ' + p.last_name]);
      html += `<details><summary>PATTY · Incarico fisso</summary><form data-form="fixed-sheet" data-key="${esc(key)}" data-team="${esc(g.team_id)}">${select('Ruolo', 'role', [['referee', 'Arbitro'], ['scorer', 'Refertista']])}${select('Persona', 'person_id', [['', 'Scegli una persona'], ...fixedPeople])}<p class="notice">Puoi applicare la scelta solo a questa partita oppure a tutte le prossime partite della squadra.</p>${select('Durata', 'scope', [['match', 'Solo questa partita'], ['future', 'Tutte le prossime partite della squadra']])}<button class="primary">Salva incarico</button></form></details>`;
    }
    html += `<details><summary>PATTY · Cambia casa / trasferta</summary>
      <form data-form="flip-home" data-key="${esc(key)}" data-is-home="${g.is_home ? '1' : '0'}">
        <p class="notice">Stato attuale: <strong>${g.is_home ? 'CASA' : 'TRASFERTA'}</strong>. Il comando invertirà i nomi delle due squadre e aggiornerà il banner della gara nell’elenco. Data, ora e palestra non cambiano.</p>
        <p class="notice">Le prenotazioni esistenti sono protette: passando in trasferta, eventuali arbitri o refertisti già assegnati devono essere rimossi prima.</p>
        <button type="submit" class="primary">Passa a ${g.is_home ? 'TRASFERTA' : 'CASA'}</button>
      </form></details>`;
    html += `<details><summary>PATTY · Correggi dato</summary><form data-form="game-edit" data-key="${esc(key)}">${select(
      'Campo',
      'field',
      Object.entries(FIELDS)
        .filter(([k]) => (g.date && g.time) || !['date', 'time'].includes(k))
        .map(([k, v]) => [k, v]),
    )}${field('Nuovo valore', 'value')}${field('Motivo / riferimento', 'reason')}<button>Salva modifica</button></form></details>`;
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
        history.audit.map(auditCard)
          .join('') || 'Nessuna modifica manuale.';
  }
}
function auditActorName(actor) {
  const value = String(actor || '');
  if (value === 'PATTY') return 'PATTY';
  if (value.startsWith('PATTY-DELEGATO:')) {
    const bar = value.indexOf('|');
    if (bar !== -1) return value.slice(bar + 1);
    const id = value.slice('PATTY-DELEGATO:'.length);
    const user = state.admin?.people?.find((p) => p.id === id);
    return user ? user.first_name + ' ' + user.last_name : 'Collaboratore PATTY';
  }
  const user = state.admin?.people?.find((p) => p.id === value);
  return user ? user.first_name + ' ' + user.last_name : ({
    sync: 'Aggiornamento automatico',
    system: 'Sistema',
    'PATTY-AUTO': 'Assegnazione automatica',
  }[value] || value);
}
function auditDescription(record) {
  let details = {};
  try { details = JSON.parse(record.details || '{}'); } catch {}
  const labels = {
    game_modified: 'Partita modificata',
    booking_request: 'Prenotazione inserita',
    cancelled: 'Prenotazione rimossa',
    team_saved: 'Squadra modificata',
    roster_staff_changed: 'Staff squadra modificato',
    team_staff_permanent: 'Staff aggiornato per tutte le gare',
    roster_linked: 'Calendario squadra collegato',
    fixed_changed: 'Incarico fisso modificato',
    fixed_applied: 'Incarico fisso applicato',
    patty_delegate_granted: 'Accesso PATTY autorizzato',
    patty_delegate_revoked: 'Accesso PATTY revocato',
    person_deleted: 'Account eliminato',
    person_roles_updated: 'Ruoli persona modificati',
    patty_pin_changed: 'Codice PATTY modificato',
    calendar_sync_started: 'Aggiornamento calendari avviato',
    source_updated: 'Dati ufficiali aggiornati',
    assigned: 'Prenotazione registrata',
    assignment_removed: 'Prenotazione cancellata',
  };
  const base = labels[record.action] || record.action;
  let suffix = '';
  if (record.action === 'game_modified' && details.reason) suffix = ' · ' + String(details.reason);
  if ((record.action === 'person_deleted' || record.action === 'person_roles_updated') && details.name) suffix = ' · ' + details.name;
  if (record.action === 'calendar_sync_started' && details.scope)
    suffix = ' · ' + details.scope + (details.results_only ? ' (risultati)' : '');
  if (record.action === 'booking_request' && details.role)
    suffix = ' · ' + (details.role === 'scorer' ? 'Refertista' : 'Arbitro');
  return base + suffix;
}
function auditCard(record) {
  const date = new Date(record.changed_at);
  const time = isNaN(date.valueOf()) ? String(record.changed_at) :
    date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  const game = record.game_key ? ' · Gara ' + String(record.game_key).slice(-32) : '';
  return '<p class="notice"><b>' + esc(time) + '</b> · ' +
    esc(auditActorName(record.actor)) + ' · ' +
    esc(auditDescription(record)) + esc(game) + '</p>';
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
  const wasOpen = !!document.querySelector('#admin .patty-panel[open]');
  const P = {};
  P.sync = `<div class="actions"><button data-sync="calendar" class="primary">↻ Aggiorna tutti i calendari</button><button data-sync="results">↻ Aggiorna tutti i risultati</button></div><p class="notice">Aggiorna tutte le squadre attive. Le gare non vengono duplicate; le correzioni manuali e le prenotazioni sono conservate.</p>`;
  P.pin = !state.user?.id ? `<details><summary>Codice PATTY · 4 caratteri ${state.patty_pin_set ? '(attivo)' : '(da impostare)'}</summary><p class="notice">Salva il codice: al prossimo accesso sostituirà la password precedente.</p><form data-form="patty-pin">${codeField('Nuovo codice PATTY', 'pin')}${codeField('Ripeti il codice', 'confirm')}<button>Salva codice PATTY</button></form></details>` : '';
  P.pending = `<details><summary>🔵 Gare con dati primari incompleti (${pending.length})</summary>${pending.map((g) => `<div class="card"><p>${esc(g.category)} · ${esc(g.source)} · Gara ${esc(g.game_number)}</p><small>${esc(g.home_team)} – ${esc(g.away_team)}</small><button type="button" data-open="${esc(g.game_key)}">Apri scheda partita</button></div>`).join('') || '<p>Nessuna gara incompleta.</p>'}</details>`;
  const delegateCount = a.people.filter((p) => p.can_access_patty).length;
  P.people =
    '<details><summary>Persone registrate (' + a.people.length + ')</summary><p class="notice">Qui puoi aggiornare i ruoli di ogni persona senza cambiare il suo account o le prenotazioni.</p>' +
    (!state.user?.id ? '<p class="notice">Accessi PATTY aggiuntivi: ' + delegateCount + '/2. Solo PATTY può autorizzare o revocare gli accessi, senza comunicare il proprio codice.</p>' : '') +
    ((a.people.map((p) => {
      const roles = [
        ['wants_referee', 'Arbitro'], ['wants_scorer', 'Refertista'],
        ['wants_manager', 'Dirigente'], ['wants_coach', 'Allenatore']
      ].filter(([key]) => p[key]).map(([, label]) => label).join(', ') || 'Nessun ruolo';
      const action = !state.user?.id ?
        '<button type="button" data-patty-delegate="' + esc(p.id) + '" data-allowed="' +
        (p.can_access_patty ? 'false' : 'true') + '"' +
        (!p.can_access_patty && (!p.approved || delegateCount >= 2) ? ' disabled' : '') +
        '>' + (p.can_access_patty ? 'Revoca accesso PATTY' : 'Autorizza accesso PATTY') + '</button>' : '';
      return '<div class="person"><b>' + esc(p.first_name + ' ' + p.last_name) + '</b>' +
        '<p class="notice">' + esc(roles) + (p.can_access_patty ? ' · Accesso PATTY autorizzato' : '') + '</p>' +
        '<button type="button" data-person-roles="' + esc(p.id) + '">Modifica ruoli</button> ' +
        '<button type="button" data-person-delete="' + esc(p.id) + '">Elimina account</button>' +
        action + '</div>';
    }).join('')) || '<p>Nessuna persona registrata.</p>') + '</details>';
  const roster=a.roster||[];
  P.roster = '<details><summary>Archivio 21 squadre · ' + roster.filter(x=>x.linked_team_id).length +
    ' collegate</summary><p class="notice">Solo le squadre collegate a un identificativo ufficiale partecipano agli aggiornamenti. Le modifiche agli allenatori e dirigenti si propagano a tutte le partite della squadra.</p>' +
    '<p><button type="button" data-roster-pgs>Trova e collega le squadre PGS</button></p>' +
    roster.map(r=>`<details class="card"><summary>${r.id}. ${esc(r.category)} ${esc(r.source)} · ${esc(r.name)} · ${manualCalendarOnly(r)?'Gestione manuale':r.linked_team_id?'Collegata':'Da collegare'}</summary>
      ${manualCalendarOnly(r)?'<p class="notice">Calendario e risultati inseriti manualmente da PATTY.</p>':r.linked_team_id?`<p class="notice">Nome ufficiale: ${esc(r.official_name)} · ${esc(r.official_group||'')}</p>`:'<p class="notice">Identificativo ufficiale ancora da verificare.</p>'}
      <form data-form="roster-staff" data-id="${r.id}">
        <div class="grid">${field('Allenatore 1','coach1',r.coach1)}${field('Allenatore 2','coach2',r.coach2)}</div>
        <label class="field">Dirigenti<textarea name="managers">${esc(r.managers)}</textarea></label><button>Salva staff</button>
      </form>
      ${!manualCalendarOnly(r)&&!r.linked_team_id&&r.source==='FIPAV'?`<form data-form="roster-fipav" data-id="${r.id}">${field('Codice girone FIPAV','group_id','','text',true)}<button>Verifica e collega il calendario</button></form>`:''}
    </details>`).join('')+'</details>';
  P.teams =
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
  P.activity = '<details><summary>Registro modifiche · riservato PATTY</summary>' +
    '<p class="notice">Mostra chi ha effettuato le modifiche, con data e ora. Visibile solo a PATTY e ai due collaboratori autorizzati.</p>' +
    '<button type="button" data-activity-load>Mostra ultime modifiche</button>' +
    '<div id="patty-activity"></div></details>';
  P.manual = `<details><summary>Inserimento manuale di una gara</summary><form data-form="manual">${select(
    'Squadra',
    'team_id',
    a.teams.map((t) => [t.id, t.category + ' · ' + t.name]),
  )}${field('Avversaria', 'opponent', '', 'text', true)}${check('Gara in casa', 'is_home', true)}<div class="grid">${field('Data', 'date', '', 'date', true)}${field('Ora', 'time', '', 'time', true)}</div>${field('Palestra', 'venue')}${field('Indirizzo', 'address')}${field('Numero gara', 'game_number')}<button>Salva gara manuale</button></form></details>`;
  const badge = pending.length
    ? `<span class="badge warn">${pending.length} ${pending.length === 1 ? 'gara' : 'gare'} da completare</span>`
    : '<span class="badge">Tutto in ordine</span>';
  $('#admin').innerHTML = `<details class="patty-panel" ${wasOpen ? 'open' : ''}><summary><span>Strumenti PATTY</span>${badge}</summary><div class="patty-body"><h2>PATTY · Comandi riservati</h2><section class="pgroup"><h3>Aggiornare</h3>${P.sync}</section><section class="pgroup"><h3>Gare</h3>${P.pending}${P.manual}</section><section class="pgroup"><h3>Squadre e persone</h3>${P.roster}${P.teams}${P.people}</section><section class="pgroup"><h3>Sistema</h3>${P.pin}${P.activity}</section></div></details>`;
}
async function syncAll(resultsOnly) {
  const scopes = [
    ...new Set(
      state.teams
        .filter((t) => t.active && !manualCalendarOnly(t))
        .map((t) =>
          [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':'),
        ),
    ),
  ];
  let failures = 0;
  const buttons = [...document.querySelectorAll('[data-sync]')];
  buttons.forEach((b) => (b.disabled = true));
  for (const scope of scopes) {
    try {
      // Un solo comando e un solo messaggio: nessun percorso differente
      // o report per squadra è mostrato durante l'aggiornamento.
      notice('Aggiornamento in corso…');
      const job = await api('admin/sync', { scope, results_only: resultsOnly });
      let step;
      do {
        step = await api('admin/sync/step', { job_id: job.job_id });
      } while (!step.done);
      if (step.report.errors.length || step.report.fixed_conflicts.length) failures++;
    } catch (e) {
      failures++;
      console.error('Aggiornamento calendario non riuscito:', scope, e);
    }
  }
  await load();
  notice(failures
    ? 'Aggiornamento parziale: alcuni calendari richiedono una verifica.'
    : 'Aggiornamento completato.');
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
      if (f.dataset.admin !== 'true') rememberRegisteredOnThisDevice();
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
      });
      rememberRegisteredOnThisDevice();
      $('#dialog').close();
      await load();
      notice('Registrazione completata. Sei già connesso.');
      return;
    case 'person-roles': {
      const payload = {
        id: f.dataset.personId,
        wants_referee: !!b.wants_referee,
        wants_scorer: !!b.wants_scorer,
        wants_manager: !!b.wants_manager,
        wants_coach: !!b.wants_coach,
      };
      if (!Object.entries(payload).some(([key, value]) => key !== 'id' && value))
        throw new Error('Seleziona almeno un ruolo.');
      await api('admin/person/roles', payload);
      $('#dialog').close();
      await load();
      notice('Ruoli aggiornati. Account e prenotazioni invariati.');
      return;
    }
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
    case 'result': {
      await api('admin/game', {
        game_key: f.dataset.key,
        patch: resultPatch(b),
        reason: 'PATTY · Risultato e parziali',
      });
      break;
    }
    case 'flip-home': {
      const g = state.games.find((x) => x.game_key === f.dataset.key) ||
        state.admin?.games.find((x) => x.game_key === f.dataset.key);
      if (!g) throw new Error('Partita non trovata. Ricarica la pagina.');
      const wasHome = f.dataset.isHome === '1';
      if (!!g.is_home !== wasHome) throw new Error('La partita è stata aggiornata. Riapri la scheda.');
      if (!window.confirm(`Confermi il passaggio a ${wasHome ? 'TRASFERTA' : 'CASA'}?\n\n${g.away_team} – ${g.home_team}\n\nPalestra, data e ora restano invariati.`)) return;
      const r = await api('admin/game/flip-home', {
        game_key: f.dataset.key,
        expected_is_home: wasHome,
      });
      if (r.game?.date) state.week = weekOf(r.game.date);
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
    case 'game-staff':
      await api('admin/game/staff', {
        game_key: f.dataset.key,
        scope: b.scope,
        coach1: b.coach1 || '',
        coach2: b.coach2 || '',
        managers: b.managers || '',
      });
      break;
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
    case 'fixed-sheet': {
      if (!b.person_id) throw new Error('Seleziona una persona.');
      if (b.scope === 'match') {
        await api('admin/assign', {
          game_key: f.dataset.key,
          role: b.role,
          slot: 1,
          person_id: b.person_id,
        });
      } else {
        const result = await api('admin/fixed', {
          team_id: f.dataset.team,
          role: b.role,
          person_id: b.person_id,
        });
        for (const pending of result.pending || []) await api('admin/fixed/apply', { game_key: pending.game_key });
      }
      break;
    }
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
  const f = e.target;
  if (f.dataset.form === 'game-staff' && e.submitter?.dataset.staffScope)
    f.elements.namedItem('scope').value = e.submitter.dataset.staffScope;
  const button = e.submitter || f.querySelector('button');
  if (button) button.disabled = true;
  try {
    await submit(f);
  } catch (error) {
    notice(error.message, !!f.closest('dialog'));
  } finally {
    if (button) button.disabled = false;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'week-select') return;
  state.week = e.target.value || null;
  render();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.accessView) {
      access(false, b.dataset.accessView);
    } else if (b.id === 'close-dialog') {
      $('#dialog').close();
      currentGame = null;
    } else if (b.id === 'home') {
      state.week = null;
      render();
    } else if (b.dataset.week) {
      state.week = b.dataset.week;
      render();
    } else if (b.id === 'access') {
      if (state.user?.id) {
        await api('auth/logout', {});
        await load();
      } else access(false);
    } else if (b.id === 'patty') {
      if (state.user?.admin) {
        await api(state.user.id ? 'auth/patty-exit' : 'auth/logout', {});
        await load();
      } else if (state.user?.can_access_patty) {
        await api('auth/patty-enter', {});
        await load();
      } else access(true);
    } else if (b.dataset.open) await showGame(b.dataset.open);
    else if (b.hasAttribute('data-book') || b.hasAttribute('data-admin-book') || b.hasAttribute('data-cancel')) {
      const pattyBooking = b.hasAttribute('data-admin-book');
      const booking = b.hasAttribute('data-book') || pattyBooking;
      const selectedPerson = pattyBooking ? b.closest('.patty-seat-book')?.querySelector('select')?.value : '';
      if (pattyBooking && (!state.user?.admin || !state.admin?.people.some((p) => p.id === selectedPerson && p.approved && p['wants_' + b.dataset.role])))
        throw new Error('Seleziona una persona abilitata per questo incarico.');
      const personName = pattyBooking ? state.admin.people.find((p) => p.id === selectedPerson) : null;
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
      const message = pattyBooking
        ? 'PATTY · Conferma prenotazione per ' + personName.first_name + ' ' + personName.last_name
        : booking
          ? 'Ti stai prenotando per questa partita'
          : state.user?.admin
            ? 'PATTY · Conferma rimozione della prenotazione'
            : 'Stai annullando la tua prenotazione per questa partita';
      const attrs = `data-game="${esc(b.dataset.game)}" data-role="${esc(b.dataset.role)}" data-slot="${esc(b.dataset.slot)}" ${pattyBooking ? 'data-person="' + esc(selectedPerson) + '"' : ''}`;
      panel.innerHTML = `<h3 id="action-confirmation-title">${esc(message)}</h3>
        <p><strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></p>
        <p>${esc(g.date || 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(ROLES[b.dataset.role] || 'Incarico')}</p>
        <div class="actions">
          <button type="button" class="primary" data-confirm-action data-action="${pattyBooking ? 'admin/assign' : booking ? 'book' : 'cancel'}" ${attrs}>Conferma</button>
          <button type="button" data-abort-action>Indietro</button>
        </div>`;
      $('#dialog-content').prepend(panel);
      panel.querySelector('[data-confirm-action]').focus();
    } else if (b.hasAttribute('data-abort-action')) {
      $('#action-confirmation')?.remove();
    } else if (b.hasAttribute('data-confirm-action')) {
      b.disabled = true;
      const payload = {
        game_key: b.dataset.game,
        role: b.dataset.role,
        slot: Number(b.dataset.slot),
      };
      if (b.dataset.action === 'admin/assign') payload.person_id = b.dataset.person;
      await api(b.dataset.action, payload);
      await load();
      await showGame(b.dataset.game);
      notice(b.dataset.action === 'cancel' ? 'Prenotazione rimossa.' : 'Prenotazione confermata.', true);
    } else if (b.hasAttribute('data-staff-reset')) {
      if (!confirm('Ripristinare gli allenatori e i dirigenti della squadra per questa partita?')) return;
      await api('admin/game/staff', { game_key: b.dataset.game, scope: 'reset' });
      await load();
      await showGame(b.dataset.game);
      notice('Staff della squadra ripristinato.', true);
    } else if (b.hasAttribute('data-roster-pgs')) {
      b.disabled=true;
      const result=await api('admin/roster/pgs-search',{});
      await load();
      notice('PGS: ' + result.linked.length + ' nuove squadre collegate; ' +
        result.pending.length + ' ancora da verificare.' +
        (result.pending.length ? ' ' + result.pending.map(x =>
          x.name + ' (' + x.reason + ')').join('; ') : ''));
    } else if (b.hasAttribute('data-activity-load')) {
      b.disabled = true;
      try {
        const log = await api('admin/activity');
        const output = $('#patty-activity');
        if (output) output.innerHTML = log.activity.map(auditCard).join('') ||
          '<p class="notice">Nessuna modifica registrata.</p>';
      } finally { b.disabled = false; }
    } else if (b.hasAttribute('data-patty-delegate')) {
      const allowed = b.dataset.allowed === 'true';
      if (!confirm((allowed ? 'Autorizzare' : 'Revocare') + ' l’accesso PATTY a questa persona?')) return;
      b.disabled = true;
      await api('admin/delegate', { id: b.dataset.pattyDelegate, allowed });
      await load();
      notice(allowed ? 'Accesso PATTY autorizzato.' : 'Accesso PATTY revocato.');
    } else if (b.hasAttribute('data-person-roles')) {
      const p = state.admin?.people.find((x) => x.id === b.dataset.personRoles);
      if (!state.user?.admin || !p)
        throw new Error('Persona non trovata. Aggiorna la pagina.');
      modal('Modifica ruoli · ' + p.first_name + ' ' + p.last_name,
        '<form data-form="person-roles" data-person-id="' + esc(p.id) + '">' +
        '<p class="notice">Puoi selezionare più ruoli. Il codice personale e le prenotazioni rimangono invariati.</p>' +
        '<div class="checks">' +
          check('Arbitro', 'wants_referee', !!p.wants_referee) +
          check('Refertista', 'wants_scorer', !!p.wants_scorer) +
          check('Dirigente', 'wants_manager', !!p.wants_manager) +
          check('Allenatore', 'wants_coach', !!p.wants_coach) +
        '</div><div class="actions"><button type="submit" class="primary">Salva ruoli</button></div></form>');
    } else if (b.hasAttribute('data-person-delete')) {
      if (!confirm('Vuoi eliminare definitivamente questo account? Questa operazione non si può annullare.')) return;
      b.disabled = true;
      await api('admin/person', { id: b.dataset.personDelete, action: 'delete' });
      await load();
      notice('Account eliminato.');
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
