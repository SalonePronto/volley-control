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
  $('#title').textContent = state.week ? weekLabel(w) : 'Gare casalinghe da coprire';
  $('#title').classList.toggle('sr-only', !!state.week);
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
    mark = (r, label) => `<span class="mark">${dot(g, r)}<small>${label}</small></span>`,
    seats = g.is_home
      ? `<span class="seats">${mark('referee', 'Arb')}${mark('scorer', 'Ref')}</span>`
      : '<span class="seats"><span class="tag-away">Trasferta</span></span>';
  return `<article class="fixture${g.is_home ? '' : ' away'}${newDay ? ' new-day' : ''}" data-game-key="${esc(g.game_key)}"><div class="mobile"><span class="identity"><span class="cat${longCat ? ' cat--long' : ''}">${esc(cat)}</span><span class="source">${esc(g.source)}</span><span class="short">${esc(t.short_name || g.our_team_name)}</span></span><span class="when"><b>${esc(day)} ${shortDate(g.date)}</b><em>${esc(g.time)}</em></span><span class="teams" title="${esc(g.home_team + ' – ' + g.away_team)}"><span class="t${g.is_home ? ' us' : ''}">${esc(g.home_team)}</span> – <span class="t${g.is_home ? '' : ' us'}">${esc(g.away_team)}</span>${score}${whoHtml}</span>${seats}</div><button class="open-game" data-open="${esc(g.game_key)}" aria-label="Apri la scheda: ${esc(g.home_team)} – ${esc(g.away_team)}"></button></article>`;
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
    `<form data-form="login" data-admin="${admin}">${credentials}<button class="primary">Accedi</button></form>${!admin && state.registration_enabled ? `<details><summary>Prima registrazione</summary><p class="notice">Inserisci nome, cognome e un codice personale di 4 caratteri, con lettere o numeri. Conserva il codice per i prossimi accessi.</p><form data-form="register">${names}${codeField('Codice di 4 caratteri', 'password')}<p class="notice">Seleziona almeno un ruolo. Puoi sceglierne più di uno: basta un solo account.</p><div class="checks">${check('Arbitro', 'wants_referee')}${check('Refertista', 'wants_scorer')}${check('Dirigente', 'wants_manager')}${check('Allenatore', 'wants_coach')}</div><div class="actions"><button>Registrati ed entra</button></div></form></details>` : !admin ? '<p class="notice">Registrazioni non ancora aperte in questo ambiente.</p>' : ''}`,
  );
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
        const allowed = state.user && !state.user.admin && !g.source_missing && !isFederal;
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
  const managers = String(t.managers || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const staffBlock = `<div class="staff"><h3>Staff squadra</h3>${staffLine('Allenatore', t.coach1 || 'Da inserire')}${staffLine('Secondo allenatore', t.coach2)}${managers.length ? managers.map((m, i) => staffLine(i ? '' : managers.length > 1 ? 'Dirigenti' : 'Dirigente', m)).join('') : staffLine('Dirigenti', 'Da inserire')}</div>`;
  let html = `<div class="sheet-hero">${esc(g.date ? shortDate(g.date) + '/' + g.date.slice(0, 4) : 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(g.category)} · ${esc(g.source)}<strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></div>${g.is_home ? '<h3>Prenotazioni · Gare in casa</h3>' + seats : '<p class="notice">Trasferta: non sono richiesti arbitro e refertista interni.</p>'}<div class="strip"><span>Gara <b>${esc(g.game_number || 'n. non presente')}</b></span><span class="pill ${g.is_home ? 'home' : 'away'}">${g.is_home ? 'Casa' : 'Trasferta'}</span><span>${esc(g.source)}</span></div>${placeBlock}${staffBlock}${resultCard(g)}${g.notes ? card('Note', g.notes) : ''}`;
  if (state.user?.admin) {
    if (g.is_home) {
      html += `<section class="card"><h3>PATTY · Designazione federale</h3><form data-form="federal" data-key="${esc(key)}"><div class="actions">${check('Arbitro federale', 'federal_referee', federal(g, 'referee'))}${check('Refertista federale', 'federal_scorer', federal(g, 'scorer'))}</div><p class="notice">Federale: posto coperto e non prenotabile. Se già occupato, rimuovi prima l’incarico.</p><button class="primary">Salva scelta federali</button></form></section>`;
    }
    html += `<details><summary>PATTY · Correggi dato</summary><form data-form="game-edit" data-key="${esc(key)}">${select(
      'Campo',
      'field',
      Object.entries(FIELDS).map(([k, v]) => [k, v]),
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
  const wasOpen = !!document.querySelector('#admin .patty-panel[open]');
  const P = {};
  P.sync = `<div class="actions"><button data-sync="calendar" class="primary">↻ Aggiorna tutti i calendari</button><button data-sync="results">↻ Aggiorna tutti i risultati</button></div><p class="notice">Aggiorna tutte le squadre attive. Le gare non vengono duplicate; le correzioni manuali e le prenotazioni sono conservate.</p>`;
  P.pin = `<details><summary>Codice PATTY · 4 caratteri ${state.patty_pin_set ? '(attivo)' : '(da impostare)'}</summary><p class="notice">Salva il codice: al prossimo accesso sostituirà la password precedente.</p><form data-form="patty-pin">${codeField('Nuovo codice PATTY', 'pin')}${codeField('Ripeti il codice', 'confirm')}<button>Salva codice PATTY</button></form></details>`;
  P.pending = `<details ${pending.length ? 'open' : ''}><summary>🔵 Gare con dati primari incompleti (${pending.length})</summary>${pending.map((g) => `<div class="card"><p>${esc(g.category)} · ${esc(g.source)} · Gara ${esc(g.game_number)}</p><small>${esc(g.home_team)} – ${esc(g.away_team)}</small><form data-form="pending" data-key="${esc(g.game_key)}"><div class="grid">${field('Data confermata', 'date', g.date || '', 'date', true)}${field('Ora confermata', 'time', g.time || '', 'time', true)}</div>${field('Motivo / riferimento', 'reason')}<button>Salva e inserisci nel calendario</button></form></div>`).join('') || '<p>Nessuna gara incompleta.</p>'}</details>`;
  P.people =
    '<details><summary>Persone registrate (' + a.people.length + ')</summary><p class="notice">I nuovi iscritti accedono subito. Qui puoi vedere i ruoli scelti e disattivare o riattivare gli account.</p>' +
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
  P.manual = `<details><summary>Inserimento manuale di una gara</summary><form data-form="manual">${select(
    'Squadra',
    'team_id',
    a.teams.map((t) => [t.id, t.category + ' · ' + t.name]),
  )}${field('Avversaria', 'opponent', '', 'text', true)}${check('Gara in casa', 'is_home', true)}<div class="grid">${field('Data', 'date', '', 'date', true)}${field('Ora', 'time', '', 'time', true)}</div>${field('Palestra', 'venue')}${field('Indirizzo', 'address')}${field('Numero gara', 'game_number')}<button>Salva gara manuale</button></form></details>`;
  const removed = a.games.filter((g) => g.hidden || g.source_missing);
  P.removed =
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
  P.system =
    '<details><summary>Stato aggiornamenti · Backup · Utilizzo</summary>' +
    a.sync
      .map(
        (s) => `<p class="notice">${esc(s.scope)} · ${esc(s.at)} · ${esc(s.error || s.report)}</p>`,
      )
      .join('') +
    '<p class="notice">Il backup contiene dati personali e hash delle password: conservarlo in un archivio privato. La chiave segreta delle password deve essere custodita separatamente.</p><div class="actions"><button data-backup>Esporta backup riservato</button><button data-usage>Controlla utilizzo</button></div><div id="usage"></div></details>';
  const badge = pending.length
    ? `<span class="badge warn">${pending.length} ${pending.length === 1 ? 'gara' : 'gare'} da completare</span>`
    : '<span class="badge">Tutto in ordine</span>';
  $('#admin').innerHTML = `<details class="patty-panel" ${wasOpen ? 'open' : ''}><summary><span>Strumenti PATTY</span>${badge}</summary><div class="patty-body"><h2>PATTY · Comandi riservati</h2><section class="pgroup"><h3>Aggiornare</h3>${P.sync}</section><section class="pgroup"><h3>Gare</h3>${P.pending}${P.manual}${P.removed}</section><section class="pgroup"><h3>Squadre e persone</h3>${P.roster}${P.teams}${P.people}</section><section class="pgroup"><h3>Sistema</h3>${P.pin}${P.system}</section></div></details>`;
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
    case 'result': {
      await api('admin/game', {
        game_key: f.dataset.key,
        patch: resultPatch(b),
        reason: 'PATTY · Risultato e parziali',
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
document.addEventListener('change', (e) => {
  if (e.target.id !== 'week-select') return;
  state.week = e.target.value || null;
  render();
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
