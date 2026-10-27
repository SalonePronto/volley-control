const ASSETS = {"/":{"body":"<!doctype html>\n<html lang=\"it\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />\n    <meta name=\"color-scheme\" content=\"light\" />\n    <title>VOLLEY CONTROL · Prova Cloudflare</title>\n    <link rel=\"stylesheet\" href=\"/style.css\" />\n    <script type=\"module\" src=\"/app.js\"></script>\n  </head>\n  <body>\n    <main id=\"app\">\n      <header class=\"hero\">\n        <h1>🏐 VOLLEY CONTROL</h1>\n        <p>Calendario settimanale · FIPAV · PGS</p>\n      </header>\n      <p class=\"staging\">\n        AMBIENTE DI PROVA · Solo calendari pubblici e account fittizi. Streamlit resta attivo.\n      </p>\n      <div id=\"message\" role=\"status\" aria-live=\"polite\"></div>\n      <nav class=\"top\">\n        <button id=\"home\">HOME</button><span id=\"identity\"></span\n        ><button id=\"access\">Area personale</button\n        ><button id=\"patty\">🔒 PATTY <span id=\"pending-dot\"></span></button>\n      </nav>\n      <section id=\"admin\" hidden></section>\n      <nav id=\"weeks\" aria-label=\"Settimane delle gare\"></nav>\n      <h2 id=\"title\">Caricamento…</h2>\n      <div id=\"metrics\" class=\"metrics\"></div>\n      <div id=\"summary\"></div>\n      <div class=\"legend\">\n        <span><i class=\"dot covered\">✓</i> Coperto</span\n        ><span><i class=\"dot missing\">!</i> Mancante</span><span>— Trasferta</span>\n      </div>\n      <div class=\"quick-head\">\n        <span>SQUADRA</span><span>DATA</span><span>ORA</span><span>ARB</span><span>REF</span\n        ><span>SCHEDA</span>\n      </div>\n      <section id=\"games\" aria-label=\"Calendario partite\"></section>\n      <footer>\n        Fonti ufficiali FIPAV e PGS · Aggiornamenti manuali da PATTY · Archivio permanente D1\n      </footer>\n    </main>\n    <dialog id=\"dialog\">\n      <div class=\"dialog-top\">\n        <h2 id=\"dialog-title\"></h2>\n        <button id=\"close-dialog\" aria-label=\"Chiudi finestra\">✕</button>\n      </div>\n      <div id=\"dialog-content\"></div>\n      <p id=\"dialog-message\" role=\"status\" aria-live=\"polite\"></p>\n    </dialog>\n  </body>\n</html>\n","type":"text/html; charset=utf-8"},"/app.js":{"body":"const $ = (s) => document.querySelector(s),\n  esc = (v) =>\n    String(v ?? '').replace(\n      /[&<>\"']/g,\n      (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[x],\n    );\nlet state = {\n    games: [],\n    teams: [],\n    assignments: [],\n    user: null,\n    csrf: null,\n    week: null,\n    admin: null,\n    registration_enabled: false,\n  },\n  currentGame = null;\nconst ROLES = { referee: 'Arbitro', scorer: 'Refertista' };\nconst FIELDS = {\n  date: 'Data',\n  time: 'Ora',\n  category: 'Categoria',\n  home_team: 'Squadra casa',\n  away_team: 'Squadra ospite',\n  game_number: 'Numero gara',\n  venue: 'Palestra',\n  address: 'Indirizzo',\n  notes: 'Note',\n  played: 'Disputata (true/false)',\n  home_sets: 'Set casa',\n  away_sets: 'Set ospite',\n  sets: 'Parziali (JSON)',\n  required_referees: 'Arbitri richiesti',\n  required_scorers: 'Refertisti richiesti',\n  hidden: 'Nascondi / annulla (true/false)',\n};\nconst isoNow = () =>\n  new Intl.DateTimeFormat('en-CA', {\n    timeZone: 'Europe/Rome',\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).format(new Date());\nfunction weekOf(v) {\n  const d = new Date(v + 'T12:00:00Z');\n  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));\n  return d.toISOString().slice(0, 10);\n}\nconst shortDate = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—');\nfunction weekLabel(w) {\n  const e = new Date(w + 'T12:00:00Z');\n  e.setUTCDate(e.getUTCDate() + 6);\n  return 'GARE ' + shortDate(w) + ' – ' + shortDate(e.toISOString().slice(0, 10));\n}\nconst assigned = (g) => state.assignments.filter((a) => a.game_key === g.game_key);\nconst federal = (g, r) => !!g.is_home && !!g['federal_' + r];\nconst missingSeats = (g, r) => federal(g, r) ? 0 :\n  Math.max(0, required(g, r) - assigned(g).filter((a) => a.role === r).length);\nconst required = (g, r) =>\n  g.is_home ? Number(g[r === 'referee' ? 'required_referees' : 'required_scorers'] || 0) : 0;\nfunction roleState(g, r) {\n  if (federal(g, r)) return 'covered';\n  const n = required(g, r);\n  return !n ? 'na' : assigned(g).filter((a) => a.role === r).length >= n ? 'covered' : 'missing';\n}\nfunction dot(g, r) {\n  const s = roleState(g, r),\n    text = s === 'covered' ? 'Coperto' : s === 'missing' ? 'Mancante' : 'Non richiesto';\n  return `<i class=\"dot ${s}\" role=\"img\" aria-label=\"${ROLES[r]}: ${text}\" title=\"${ROLES[r]}: ${text}\">${s === 'covered' ? '✓' : s === 'missing' ? '!' : '—'}</i>`;\n}\nfunction status(g) {\n  if (g.source_missing) return 'Gara assente dalla fonte · verifica PATTY';\n  if (!g.is_home) return 'Trasferta';\n  const r = roleState(g, 'referee') === 'missing',\n    s = roleState(g, 'scorer') === 'missing';\n  return r && s\n    ? 'Arbitro e refertista mancanti'\n    : r\n      ? 'Arbitro mancante'\n      : s\n        ? 'Refertista mancante'\n        : 'Completa';\n}\nconst names = (g, r) =>\n  federal(g, r) ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') :\n  assigned(g)\n    .filter((a) => a.role === r)\n    .map((a) => a.first_name + ' ' + a.last_name)\n    .join(', ');\nfunction notice(message, dialog = false) {\n  $(dialog ? '#dialog-message' : '#message').textContent = message || '';\n}\nasync function api(path, data) {\n  const res = await fetch('/api/' + path, {\n    method: data === undefined ? 'GET' : 'POST',\n    headers:\n      data === undefined\n        ? {}\n        : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' },\n    body: data === undefined ? undefined : JSON.stringify(data),\n    credentials: 'same-origin',\n  });\n  let result;\n  try {\n    result = await res.json();\n  } catch {\n    throw new Error('Servizio non disponibile. Riprova più tardi.');\n  }\n  if (!res.ok) throw new Error(result.error || 'Operazione non riuscita.');\n  return result;\n}\n// Eventi reali: nessun controllo a intervalli del database.\nlet liveSocket = null, liveRetryTimer = null, liveRetryCount = 0;\nlet liveRefreshing = false, livePending = false;\nasync function refreshLiveCalendar() {\n  if (document.hidden) { livePending = true; return; }\n  if (liveRefreshing) { livePending = true; return; }\n  liveRefreshing = true;\n  try {\n    do {\n      livePending = false;\n      const c = await api('calendar');\n      state = { ...state, ...c };\n      if (state.user?.admin) state.admin = await api('admin/state');\n      render();\n      // La scheda di gara resta aggiornata, senza interrompere una conferma in corso.\n      if ($('#dialog').open && currentGame && !$('#action-confirmation') && !state.user?.admin)\n        await showGame(currentGame);\n    } while (livePending && !document.hidden);\n  } catch (error) {\n    // La prossima riapertura o riconnessione recupera lo stato dal database.\n    livePending = true;\n  } finally {\n    liveRefreshing = false;\n  }\n}\nfunction connectLive() {\n  if (document.hidden || typeof WebSocket === 'undefined' ||\n      (liveSocket && liveSocket.readyState <= WebSocket.OPEN)) return;\n  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }\n  const socket = new WebSocket(\n    (location.protocol === 'https:' ? 'wss://' : 'ws://') +\n    location.host + '/api/sync',\n  );\n  liveSocket = socket;\n  socket.onopen = () => {\n    if (socket !== liveSocket) return;\n    liveRetryCount = 0;\n    refreshLiveCalendar();\n  };\n  socket.onmessage = (event) => {\n    if (event.data === '{\"type\":\"calendar-changed\"}') refreshLiveCalendar();\n  };\n  socket.onerror = () => socket.close();\n  socket.onclose = () => {\n    if (liveSocket !== socket) return;\n    liveSocket = null;\n    if (!document.hidden) {\n      const delay = Math.min(30000, 1000 * 2 ** Math.min(liveRetryCount++, 5));\n      liveRetryTimer = setTimeout(connectLive, delay);\n    }\n  };\n}\nfunction suspendLive() {\n  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }\n  if (liveSocket) {\n    const socket = liveSocket;\n    liveSocket = null;\n    socket.close();\n  }\n}\ndocument.addEventListener('visibilitychange', () => {\n  if (document.hidden) suspendLive();\n  else { refreshLiveCalendar(); connectLive(); }\n});\nwindow.addEventListener('focus', () => {\n  if (!document.hidden) refreshLiveCalendar();\n});\nasync function load() {\n  const [me, c] = await Promise.all([api('me'), api('calendar')]);\n  state = { ...state, ...me, ...c };\n  if (state.user?.admin) state.admin = await api('admin/state');\n  else state.admin = null;\n  render();\n}\nfunction render() {\n  const pending = state.games.filter((g) => !g.date || !g.time);\n  $('#patty').textContent = state.user?.admin ? '🔓 Esci da PATTY' : '🔒 PATTY';\n  $('#patty').append(\n    Object.assign(document.createElement('span'), {\n      id: 'pending-dot',\n      textContent: pending.length ? ' ●' : '',\n    }),\n  );\n  $('#identity').textContent =\n    state.user && !state.user.admin ? state.user.first_name + ' ' + state.user.last_name : '';\n  $('#access').textContent =\n    state.user && !state.user.admin ? 'Esci dall’area personale' : 'Area personale';\n  const games = state.games.filter((g) => g.date && g.time && !g.hidden);\n  const weeks = [...new Set(games.map((g) => weekOf(g.date)))].sort();\n  $('#weeks').innerHTML = weeks\n    .map(\n      (w) => `<button data-week=\"${w}\" aria-pressed=\"${state.week === w}\">${weekLabel(w)}</button>`,\n    )\n    .join('');\n  const w = state.week || weekOf(isoNow());\n  $('#title').textContent = state.week ? weekLabel(w) : 'HOME · Gare casalinghe da coprire';\n  let rows = games.filter((g) => weekOf(g.date) === w);\n  if (!state.week)\n    rows = rows.filter(\n      (g) =>\n        g.is_home &&\n        (roleState(g, 'referee') === 'missing' || roleState(g, 'scorer') === 'missing'),\n    );\n  rows.sort((a, b) =>\n    (a.date + a.time + a.game_number).localeCompare(b.date + b.time + b.game_number),\n  );\n  const fullWeek = games.filter((g) => weekOf(g.date) === w);\n  const allMiss = (r) =>\n    fullWeek.reduce(\n      (s, g) => s + missingSeats(g, r),\n      0,\n    );\n  $('#metrics').innerHTML = [\n    ['Partite', fullWeek.length],\n    ['Complete', fullWeek.filter((g) => status(g) === 'Completa').length],\n    ['Da completare', fullWeek.filter((g) => g.is_home && status(g) !== 'Completa').length],\n    ['Arbitri mancanti', allMiss('referee')],\n    ['Refertisti mancanti', allMiss('scorer')],\n  ]\n    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)\n    .join('');\n  const miss = (r) =>\n    rows.reduce(\n      (s, g) => s + missingSeats(g, r),\n      0,\n    );\n  $('#summary').textContent =\n    `${rows.length} gare · da coprire: ARB ${miss('referee')} · REF ${miss('scorer')}`;\n  $('#games').innerHTML =\n    rows.map(rowHTML).join('') ||\n    '<p class=\"notice\">Nessuna gara da mostrare. Scegli una settimana per consultare tutte le partite.</p>';\n  $('#admin').hidden = !state.user?.admin;\n  if (state.user?.admin) renderAdmin();\n}\nfunction rowHTML(g) {\n  const t = state.teams.find((t) => t.id === g.team_id) || {},\n    cat = g.category.match(/\\bU\\s*\\d+/i)?.[0].replace(/\\s/g, '') || g.category,\n    st = status(g),\n    side = g.is_home ? 'CASA' : 'TRASFERTA',\n    weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(\n      new Date(g.date + 'T12:00:00Z'),\n    );\n  return `<article class=\"fixture\" data-game-key=\"${esc(g.game_key)}\"><div class=\"block category\"><strong>${esc(cat)}</strong><span>${esc(g.source)}</span><small>N. ${esc(g.game_number || '—')}</small></div><div class=\"block date\"><span>${esc(weekday)} ${shortDate(g.date)}</span><span>${esc(g.time)}</span><small>${side}</small></div><div class=\"block match\"><span title=\"${esc(g.home_team)}\">${esc(g.home_team)}</span><span title=\"${esc(g.away_team)}\">${esc(g.away_team)}${g.played ? ' · ' + g.home_sets + '–' + g.away_sets : ''}</span><span title=\"${esc(g.venue + ' · ' + g.address)}\">${esc(g.venue)} · ${esc(g.address)}</span></div><div class=\"block staff\"><div><span>ALL. ${esc(t.coach1 || '—')}</span>${t.coach2 ? '<span>' + esc(t.coach2) + '</span>' : ''}</div><div><span class=\"managers\">DIR. ${esc(t.managers?.replace(/\\n/g, ', ') || '—')}</span></div></div><div class=\"block roles\">${\n    g.is_home\n      ? Object.entries(ROLES)\n          .map(\n            ([r, label]) =>\n              `<div><b>${dot(g, r)} ${label}</b><span>${esc(names(g, r))}</span></div>`,\n          )\n          .join('')\n      : ''\n  }</div><div class=\"block\"><div class=\"status ${!g.is_home ? 'away' : st === 'Completa' ? 'ready' : 'open'}\">${esc(st)}</div></div><div class=\"mobile\"><span class=\"identity\"><span class=\"cat\">${esc(cat)}</span><span class=\"source\">${esc(g.source)}</span><span class=\"short\">${esc(t.short_name || g.our_team_name)}</span></span><span>${shortDate(g.date)}</span><span>${esc(g.time)}</span><span>${dot(g, 'referee')}</span><span>${dot(g, 'scorer')}</span></div><button class=\"open-game\" data-open=\"${esc(g.game_key)}\">Vedi scheda</button></article>`;\n}\nfunction modal(title, html) {\n  $('#dialog-title').textContent = title;\n  $('#dialog-content').innerHTML = html;\n  notice('', true);\n  if (!$('#dialog').open) $('#dialog').showModal();\n}\nconst card = (title, main, detail = '') =>\n  `<div class=\"card\"><h3>${esc(title)}</h3><p>${esc(main)}</p><small>${esc(detail)}</small></div>`;\nfunction field(label, name, value = '', type = 'text', required = false) {\n  return `<label class=\"field\">${esc(label)}<input name=\"${esc(name)}\" type=\"${type}\" value=\"${esc(value)}\" ${required ? 'required' : ''} ${type === 'password' ? 'minlength=\"12\" maxlength=\"256\" autocomplete=\"current-password\"' : ''}></label>`;\n}\nconst select = (label, name, options, value = '') =>\n  `<label class=\"field\">${esc(label)}<select name=\"${name}\">${options.map(([v, l]) => `<option value=\"${esc(v)}\" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;\nconst check = (label, name, on = false) =>\n  `<label><input type=\"checkbox\" name=\"${name}\" ${on ? 'checked' : ''}> ${esc(label)}</label>`;\nconst codeField = (label, name) =>\n  `<label class=\"field\">${esc(label)}<input name=\"${esc(name)}\" type=\"password\" minlength=\"4\" maxlength=\"4\" pattern=\"[A-Za-z0-9]{4}\" autocomplete=\"off\" autocapitalize=\"off\" required></label>`;\nfunction access(admin = false) {\n  const names = field('Nome', 'first_name', '', 'text', true) +\n    field('Cognome', 'last_name', '', 'text', true);\n  const credentials = admin\n    ? (state.patty_pin_set ? codeField('Codice PATTY (4 caratteri)', 'password') : field('Password PATTY attuale', 'password', '', 'password', true))\n    : names + codeField('Codice personale (4 caratteri)', 'password');\n  modal(\n    admin ? 'PATTY · Accesso organizzatore' : 'Area personale · Accesso',\n    `<form data-form=\"login\" data-admin=\"${admin}\">${credentials}<button class=\"primary\">Accedi</button></form>${!admin && state.registration_enabled ? `<details><summary>Prima registrazione · Solo collaudo</summary><p class=\"notice\">Usa soltanto nome e cognome inventati. Nessuna email.</p><form data-form=\"register\">${names}${codeField('Codice di 4 caratteri', 'password')}<div class=\"checks\">${check('Arbitro', 'wants_referee')}${check('Refertista', 'wants_scorer')}${check('Dirigente', 'wants_manager')}${check('Allenatore', 'wants_coach')}</div><label>${check('Confermo che sono dati fittizi', 'staging_consent')}</label><div class=\"actions\"><button>Registrati ed entra</button></div></form></details>` : !admin ? '<p class=\"notice\">Registrazioni non ancora aperte in questo ambiente.</p>' : ''}`,\n  );\n}\nasync function showGame(key) {\n  const g =\n    state.games.find((x) => x.game_key === key) ||\n    state.admin?.games.find((x) => x.game_key === key);\n  if (!g) return;\n  currentGame = key;\n  const t = state.teams.find((x) => x.id === g.team_id) || {};\n  let seats = '';\n  if (g.is_home) {\n    for (const [r, label] of Object.entries(ROLES))\n      for (let slot = 1; slot <= Math.max(required(g, r), federal(g, r) ? 1 : 0); slot++) {\n        const a = assigned(g).find((a) => a.role === r && a.slot === slot);\n        const data = `data-game=\"${esc(key)}\" data-role=\"${r}\" data-slot=\"${slot}\"`;\n        const isFederal = federal(g, r);\n        const allowed = state.user && !state.user.admin && !g.source_missing && !isFederal;\n        seats += `<div class=\"seat\"><span>${dot(g, r)} <b>${label}${required(g, r) > 1 ? ' ' + slot : ''}:</b> ${isFederal ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') : a ? esc(a.first_name + ' ' + a.last_name) : 'Posto libero'}</span>${isFederal ? '' : a ? (state.user?.admin || (state.user?.id === a.person_id && a.source === 'self') ? `<button data-cancel ${data}>${state.user?.admin ? 'Rimuovi incarico' : 'Annulla la mia prenotazione'}</button>` : '') : `<button data-book ${data} ${allowed ? '' : 'disabled'} title=\"${allowed ? 'Prenota questo incarico' : 'Accedi dall’area personale per prenotarti'}\">Mi prenoto</button>`}</div>`;\n      }\n  }\n  let html = `<div class=\"sheet-hero\">${esc(g.date ? shortDate(g.date) + '/' + g.date.slice(0, 4) : 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(g.category)} · ${esc(g.source)}<strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></div><div class=\"grid\">${card('Gara', g.game_number || 'Numero non presente', (g.is_home ? 'Casa' : 'Trasferta') + ' · ' + g.source)}${card('Palestra e indirizzo', g.venue, g.address)}${card('Staff squadra', t.coach1 || 'Da inserire', 'Secondo allenatore: ' + (t.coach2 || '—') + ' · Dirigenti: ' + (t.managers?.replace(/\\n/g, ', ') || 'Da inserire'))}${card('Copertura', status(g), 'Arbitro: ' + (names(g, 'referee') || (g.is_home ? 'Da assegnare' : 'Non richiesto')) + ' · Refertista: ' + (names(g, 'scorer') || (g.is_home ? 'Da assegnare' : 'Non richiesto')))}</div>${g.is_home ? '<h3>Prenotazioni · Gare in casa</h3>' + seats : '<p class=\"notice\">Trasferta: non sono richiesti arbitro e refertista interni.</p>'}${card('Risultato', g.played ? g.home_sets + ' – ' + g.away_sets : 'Non ancora disponibile', (g.sets || []).map((s, i) => i + 1 + '° ' + s.home + '–' + s.away).join(' · '))}${g.notes ? card('Note', g.notes) : ''}`;\n  if (state.user?.admin) {\n    if (g.is_home) {\n      html += `<section class=\"card\"><h3>PATTY · Designazione federale</h3><form data-form=\"federal\" data-key=\"${esc(key)}\"><div class=\"actions\">${check('Arbitro federale', 'federal_referee', federal(g, 'referee'))}${check('Refertista federale', 'federal_scorer', federal(g, 'scorer'))}</div><p class=\"notice\">Federale: posto coperto e non prenotabile. Se già occupato, rimuovi prima l’incarico.</p><button class=\"primary\">Salva scelta federali</button></form></section>`;\n    }\n    html += `<details><summary>PATTY · Correggi dato</summary><form data-form=\"game-edit\" data-key=\"${esc(key)}\">${select(\n      'Campo',\n      'field',\n      Object.entries(FIELDS).map(([k, v]) => [k, v]),\n    )}${field('Nuovo valore', 'value')}${field('Motivo / riferimento', 'reason')}<button>Salva modifica</button></form></details>`;\n    if (g.is_home) {\n      const people = state.admin.people.filter((p) => p.approved);\n      html += `<details><summary>PATTY · Assegna un posto libero</summary><form data-form=\"assign\" data-key=\"${esc(key)}\">${select('Ruolo', 'role', Object.entries(ROLES))}${field('Posto', 'slot', '1', 'number', true)}${select(\n        'Persona',\n        'person_id',\n        people.map((p) => [p.id, p.first_name + ' ' + p.last_name]),\n      )}<button>Assegna</button></form></details>`;\n    }\n    const conflicts = state.admin.conflicts.filter((c) => c.game_key === key);\n    html += conflicts.length\n      ? '<details open><summary>Dati ufficiali diversi / conflitti da verificare</summary>' +\n        conflicts\n          .map(\n            (c) =>\n              `<p class=\"notice\">${esc(FIELDS[c.field] || c.field)}: ${esc(c.incoming)}</p>${FIELDS[c.field] ? `<button data-reset=\"${esc(c.field)}\" data-game=\"${esc(key)}\">Usa valore ufficiale</button>` : ''}`,\n          )\n          .join('') +\n        '</details>'\n      : '';\n    html +=\n      '<details><summary>Storico modifiche</summary><div id=\"history\">Caricamento…</div></details>';\n  }\n  modal('Scheda partita', html);\n  if (state.user?.admin) {\n    const history = await api('admin/audit?game_key=' + encodeURIComponent(key));\n    if (currentGame === key && $('#history'))\n      $('#history').innerHTML =\n        history.audit\n          .map(\n            (a) =>\n              `<p class=\"notice\">${esc(a.changed_at)} · ${esc(a.actor)} · ${esc(a.action)} · ${esc(a.details)}</p>`,\n          )\n          .join('') || 'Nessuna modifica manuale.';\n  }\n}\nfunction teamForm(t = {}) {\n  return `<form data-form=\"team\" data-id=\"${esc(t.id || '')}\"><div class=\"grid\">${select(\n    'Comitato',\n    'source',\n    [\n      ['FIPAV', 'FIPAV'],\n      ['PGS', 'PGS'],\n    ],\n    t.source || 'FIPAV',\n  )}${field('Stagione', 'season', t.season || '2026-2027', 'text', true)}${field('ID ufficiale squadra', 'official_team_id', t.official_team_id || '', 'text', true)}${field('Girone FIPAV / PGS', 'group_id', t.group_id || '')}${field('Codice campionato PGS', 'competition', t.competition || '')}${field('Nome ufficiale', 'name', t.name || '', 'text', true)}${field('Categoria', 'category', t.category || '', 'text', true)}${field('Nome breve smartphone', 'short_name', t.short_name || '', 'text', true)}${field('Primo allenatore', 'coach1', t.coach1 || '')}${field('Secondo allenatore', 'coach2', t.coach2 || '')}</div><label class=\"field\">Dirigenti (uno per riga)<textarea name=\"managers\">${esc(t.managers || '')}</textarea></label>${check('Squadra attiva per gli aggiornamenti', 'active', t.active !== 0)}<div class=\"actions\"><button>Salva scheda squadra</button></div></form>`;\n}\nfunction renderAdmin() {\n  const a = state.admin;\n  if (!a) return;\n  const pending = a.games.filter((g) => !g.date || !g.time);\n  let html = `<h2>PATTY · Comandi riservati</h2><div class=\"actions\"><button data-sync=\"calendar\" class=\"primary\">↻ Aggiorna tutti i calendari</button><button data-sync=\"results\">↻ Aggiorna tutti i risultati</button></div><p class=\"notice\">Aggiorna tutte le squadre attive. Le gare non vengono duplicate; le correzioni manuali e le prenotazioni sono conservate.</p>`;\n  html += `<details><summary>Codice PATTY · 4 caratteri ${state.patty_pin_set ? '(attivo)' : '(da impostare)'}</summary><p class=\"notice\">Salva il codice: al prossimo accesso sostituirà la password precedente.</p><form data-form=\"patty-pin\">${codeField('Nuovo codice PATTY', 'pin')}${codeField('Ripeti il codice', 'confirm')}<button>Salva codice PATTY</button></form></details>`;\n  html += `<details ${pending.length ? 'open' : ''}><summary>🔵 Gare con dati primari incompleti (${pending.length})</summary>${pending.map((g) => `<div class=\"card\"><p>${esc(g.category)} · ${esc(g.source)} · Gara ${esc(g.game_number)}</p><small>${esc(g.home_team)} – ${esc(g.away_team)}</small><form data-form=\"pending\" data-key=\"${esc(g.game_key)}\"><div class=\"grid\">${field('Data confermata', 'date', g.date || '', 'date', true)}${field('Ora confermata', 'time', g.time || '', 'time', true)}</div>${field('Motivo / riferimento', 'reason')}<button>Salva e inserisci nel calendario</button></form></div>`).join('') || '<p>Nessuna gara incompleta.</p>'}</details>`;\n  html +=\n    '<details><summary>Persone registrate (' + a.people.length + ')</summary>' +\n    (a.people.map((p) => {\n      const roles = [\n        ['wants_referee', 'Arbitro'], ['wants_scorer', 'Refertista'],\n        ['wants_manager', 'Dirigente'], ['wants_coach', 'Allenatore']\n      ].filter(([key]) => p[key]).map(([, label]) => label).join(', ') || 'Nessun ruolo';\n      return `<div class=\"person\"><b>${esc(p.first_name + ' ' + p.last_name)}</b>\n        <p class=\"notice\">${esc(roles)} · ${p.approved ? 'Attivo' : 'Disattivato'}</p>\n        <button type=\"button\" data-person-access=\"${esc(p.id)}\"\n          data-approved=\"${p.approved ? 'false' : 'true'}\">${p.approved ? 'Disattiva account' : 'Riattiva account'}</button>\n      </div>`;\n    }).join('') || '<p>Nessuna persona registrata.</p>') + '</details>';\n  const roster=a.roster||[];\n  html += '<details><summary>Archivio 21 squadre · ' + roster.filter(x=>x.linked_team_id).length +\n    ' collegate</summary><p class=\"notice\">Solo le squadre collegate a un identificativo ufficiale partecipano agli aggiornamenti. Le modifiche agli allenatori e dirigenti si propagano a tutte le partite della squadra.</p>' +\n    '<p><button type=\"button\" data-roster-pgs>Trova e collega le squadre PGS</button></p>' +\n    roster.map(r=>`<details class=\"card\"><summary>${r.id}. ${esc(r.category)} ${esc(r.source)} · ${esc(r.name)} · ${r.linked_team_id?'Collegata':'Da collegare'}</summary>\n      ${r.linked_team_id?`<p class=\"notice\">Nome ufficiale: ${esc(r.official_name)} · ${esc(r.official_group||'')}</p>`:'<p class=\"notice\">Identificativo ufficiale ancora da verificare.</p>'}\n      <form data-form=\"roster-staff\" data-id=\"${r.id}\">\n        <div class=\"grid\">${field('Allenatore 1','coach1',r.coach1)}${field('Allenatore 2','coach2',r.coach2)}</div>\n        <label class=\"field\">Dirigenti<textarea name=\"managers\">${esc(r.managers)}</textarea></label><button>Salva staff</button>\n      </form>\n      ${!r.linked_team_id&&r.source==='FIPAV'?`<form data-form=\"roster-fipav\" data-id=\"${r.id}\">${field('Codice girone FIPAV','group_id','','text',true)}<button>Verifica e collega il calendario</button></form>`:''}\n    </details>`).join('')+'</details>';\n  html +=\n    '<details><summary>Squadre · Staff · Nomi brevi · Incarichi FISSI</summary>' +\n    a.teams\n      .map(\n        (t) =>\n          `<details><summary>${esc(t.category + ' · ' + t.source + ' · ' + t.name)}</summary>${teamForm(t)}${Object.entries(\n            ROLES,\n          )\n            .map(\n              ([r, label]) =>\n                `<form data-form=\"fixed\" data-team=\"${esc(t.id)}\" data-role=\"${r}\">${select(label + ' FISSO', 'person_id', [['', 'Nessuno'], ...a.people.filter((p) => p.approved && p['wants_' + r]).map((p) => [p.id, p.first_name + ' ' + p.last_name])], a.fixed.find((f) => f.team_id === t.id && f.role === r)?.person_id || '')}<button>Salva incarico fisso</button></form>`,\n            )\n            .join('')}</details>`,\n      )\n      .join('') +\n    '<details><summary>Aggiungi squadra</summary>' +\n    teamForm() +\n    '</details></details>';\n  html += `<details><summary>Inserimento manuale di una gara</summary><form data-form=\"manual\">${select(\n    'Squadra',\n    'team_id',\n    a.teams.map((t) => [t.id, t.category + ' · ' + t.name]),\n  )}${field('Avversaria', 'opponent', '', 'text', true)}${check('Gara in casa', 'is_home', true)}<div class=\"grid\">${field('Data', 'date', '', 'date', true)}${field('Ora', 'time', '', 'time', true)}</div>${field('Palestra', 'venue')}${field('Indirizzo', 'address')}${field('Numero gara', 'game_number')}<button>Salva gara manuale</button></form></details>`;\n  const removed = a.games.filter((g) => g.hidden || g.source_missing);\n  html +=\n    '<details><summary>Gare nascoste / assenti dalla fonte (' +\n    removed.length +\n    ')</summary>' +\n    removed\n      .map(\n        (g) =>\n          `<p>${esc(g.game_number + ' · ' + g.home_team + ' – ' + g.away_team)} <button data-open=\"${esc(g.game_key)}\">Vedi scheda</button></p>`,\n      )\n      .join('') +\n    '</details>';\n  html +=\n    '<details><summary>Stato aggiornamenti · Backup · Utilizzo</summary>' +\n    a.sync\n      .map(\n        (s) => `<p class=\"notice\">${esc(s.scope)} · ${esc(s.at)} · ${esc(s.error || s.report)}</p>`,\n      )\n      .join('') +\n    '<p class=\"notice\">Il backup contiene dati personali e hash delle password: conservarlo in un archivio privato. La chiave segreta delle password deve essere custodita separatamente.</p><div class=\"actions\"><button data-backup>Esporta backup riservato</button><button data-usage>Controlla utilizzo</button></div><div id=\"usage\"></div></details>';\n  $('#admin').innerHTML = html;\n}\nasync function syncAll(resultsOnly) {\n  const scopes = [\n    ...new Set(\n      state.teams\n        .filter((t) => t.active)\n        .map((t) =>\n          [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':'),\n        ),\n    ),\n  ];\n  const reports = [];\n  const buttons = [...document.querySelectorAll('[data-sync]')];\n  buttons.forEach((b) => (b.disabled = true));\n  for (const scope of scopes) {\n    try {\n      notice('Aggiornamento ' + scope + '…');\n      const job = await api('admin/sync', { scope, results_only: resultsOnly });\n      let step;\n      do {\n        step = await api('admin/sync/step', { job_id: job.job_id });\n        notice(`${scope}: ${step.offset}/${step.total} gare elaborate…`);\n      } while (!step.done);\n      reports.push(\n        scope +\n          ': ' +\n          step.report.inserted +\n          ' nuove, ' +\n          step.report.updated +\n          ' aggiornate, ' +\n          step.report.unchanged +\n          ' invariate' +\n          (step.report.errors.length\n            ? ' · ' + step.report.errors.map((x) => x.error).join('; ')\n            : '') +\n          (step.report.fixed_conflicts.length\n            ? ' · ' + step.report.fixed_conflicts.length + ' conflitti incarichi fissi'\n            : ''),\n      );\n    } catch (e) {\n      reports.push(scope + ': ' + e.message);\n    }\n  }\n  await load();\n  notice(reports.join(' | '));\n}\nfunction formData(f) {\n  return Object.fromEntries(new FormData(f));\n}\nasync function submit(f) {\n  const kind = f.dataset.form,\n    b = formData(f);\n  switch (kind) {\n    case 'login':\n      await api('auth/login', { ...b, admin: f.dataset.admin === 'true' });\n      $('#dialog').close();\n      await load();\n      return;\n    case 'register':\n      await api('auth/register', {\n        ...b,\n        wants_referee: !!b.wants_referee,\n        wants_scorer: !!b.wants_scorer,\n        wants_manager: !!b.wants_manager,\n        wants_coach: !!b.wants_coach,\n        staging_consent: !!b.staging_consent,\n      });\n      $('#dialog').close();\n      await load();\n      notice('Registrazione completata. Sei già connesso.');\n      return;\n    case 'patty-pin':\n      await api('admin/pin', { pin: b.pin, confirm: b.confirm });\n      f.reset();\n      await load();\n      notice('Codice PATTY aggiornato. Usalo al prossimo accesso.');\n      return;\n    case 'pending': {\n      const r = await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: { date: b.date, time: b.time },\n        reason: b.reason,\n      });\n      state.week = weekOf(r.game.date);\n      break;\n    }\n    case 'federal': {\n      await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: {\n          federal_referee: !!b.federal_referee,\n          federal_scorer: !!b.federal_scorer,\n        },\n        reason: 'PATTY · Designazione federale',\n      });\n      break;\n    }\n    case 'game-edit': {\n      let value = b.value;\n      if (['home_sets', 'away_sets', 'required_referees', 'required_scorers'].includes(b.field)) {\n        if (!/^\\d+$/.test(value)) throw new Error('Inserisci un numero intero.');\n        value = Number(value);\n      }\n      if (['hidden', 'played'].includes(b.field)) {\n        if (!['true', 'false'].includes(value)) throw new Error('Scrivi true oppure false.');\n        value = value === 'true';\n      }\n      if (b.field === 'sets') {\n        try {\n          value = JSON.parse(value);\n        } catch {\n          throw new Error('Parziali JSON non validi.');\n        }\n      }\n      const r = await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: { [b.field]: value },\n        reason: b.reason,\n      });\n      if (r.game.date) state.week = weekOf(r.game.date);\n      break;\n    }\n    case 'roster-staff':\n      await api('admin/roster/staff',{id:Number(f.dataset.id),coach1:b.coach1,coach2:b.coach2,managers:b.managers});\n      break;\n    case 'roster-fipav':\n      await api('admin/roster/fipav-link',{id:Number(f.dataset.id),group_id:b.group_id});\n      break;\n    case 'team':\n      await api('admin/team', { ...b, id: f.dataset.id || undefined, active: !!b.active });\n      break;\n    case 'fixed': {\n      const r = await api('admin/fixed', {\n        team_id: f.dataset.team,\n        role: f.dataset.role,\n        person_id: b.person_id || null,\n      });\n      const conflicts = [];\n      for (const g of r.pending) {\n        const applied = await api('admin/fixed/apply', { game_key: g.game_key });\n        conflicts.push(...applied.conflicts);\n      }\n      if (conflicts.length) notice(conflicts.map((c) => c.error).join('; '));\n      break;\n    }\n    case 'assign':\n      await api('admin/assign', {\n        game_key: f.dataset.key,\n        role: b.role,\n        slot: Number(b.slot),\n        person_id: b.person_id,\n      });\n      break;\n    case 'manual':\n      await api('admin/manual', {\n        team_id: b.team_id,\n        opponent: b.opponent,\n        is_home: !!b.is_home,\n        patch: {\n          date: b.date,\n          time: b.time,\n          venue: b.venue || 'Palestra non indicata',\n          address: b.address,\n          game_number: b.game_number || 'MANUALE',\n        },\n      });\n      state.week = weekOf(b.date);\n      break;\n    default:\n      return;\n  }\n  const reopen = $('#dialog').open && currentGame;\n  await load();\n  if (reopen) await showGame(currentGame);\n  notice('Salvato.', !!reopen);\n}\ndocument.addEventListener('submit', async (e) => {\n  if (!e.target.matches('form[data-form]')) return;\n  e.preventDefault();\n  const f = e.target,\n    button = f.querySelector('button');\n  if (button) button.disabled = true;\n  try {\n    await submit(f);\n  } catch (error) {\n    notice(error.message, !!f.closest('dialog'));\n  } finally {\n    if (button) button.disabled = false;\n  }\n});\ndocument.addEventListener('click', async (e) => {\n  const b = e.target.closest('button');\n  if (!b) return;\n  try {\n    if (b.id === 'close-dialog') {\n      $('#dialog').close();\n      currentGame = null;\n    } else if (b.id === 'home') {\n      state.week = null;\n      render();\n    } else if (b.dataset.week) {\n      state.week = b.dataset.week;\n      render();\n    } else if (b.id === 'access') {\n      if (state.user && !state.user.admin) {\n        await api('auth/logout', {});\n        await load();\n      } else access(false);\n    } else if (b.id === 'patty') {\n      if (state.user?.admin) {\n        await api('auth/logout', {});\n        await load();\n      } else access(true);\n    } else if (b.dataset.open) await showGame(b.dataset.open);\n    else if (b.hasAttribute('data-book') || b.hasAttribute('data-cancel')) {\n      const booking = b.hasAttribute('data-book');\n      const g =\n        state.games.find((g) => g.game_key === b.dataset.game) ||\n        state.admin?.games.find((g) => g.game_key === b.dataset.game);\n      if (!g) throw new Error('Partita non trovata. Riapri la scheda.');\n      $('#action-confirmation')?.remove();\n      const panel = document.createElement('section');\n      panel.id = 'action-confirmation';\n      panel.className = 'action-confirmation';\n      panel.setAttribute('role', 'alertdialog');\n      panel.setAttribute('aria-labelledby', 'action-confirmation-title');\n      const message = booking\n        ? 'Ti stai prenotando per questa partita'\n        : state.user?.admin\n          ? 'Stai rimuovendo questo incarico da questa partita'\n          : 'Stai annullando la tua prenotazione per questa partita';\n      const attrs = `data-game=\"${esc(b.dataset.game)}\" data-role=\"${esc(b.dataset.role)}\" data-slot=\"${esc(b.dataset.slot)}\"`;\n      panel.innerHTML = `<h3 id=\"action-confirmation-title\">${message}</h3>\n        <p><strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></p>\n        <p>${esc(g.date || 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(ROLES[b.dataset.role] || 'Incarico')}</p>\n        <div class=\"actions\">\n          <button type=\"button\" class=\"primary\" data-confirm-action data-action=\"${booking ? 'book' : 'cancel'}\" ${attrs}>Conferma</button>\n          <button type=\"button\" data-abort-action>Indietro</button>\n        </div>`;\n      $('#dialog-content').prepend(panel);\n      panel.querySelector('[data-confirm-action]').focus();\n    } else if (b.hasAttribute('data-abort-action')) {\n      $('#action-confirmation')?.remove();\n    } else if (b.hasAttribute('data-confirm-action')) {\n      b.disabled = true;\n      await api(b.dataset.action, {\n        game_key: b.dataset.game,\n        role: b.dataset.role,\n        slot: Number(b.dataset.slot),\n      });\n      await load();\n      await showGame(b.dataset.game);\n      notice(b.dataset.action === 'book' ? 'Prenotazione confermata.' : 'Prenotazione annullata.', true);\n    } else if (b.hasAttribute('data-roster-pgs')) {\n      b.disabled=true;\n      const result=await api('admin/roster/pgs-search',{});\n      await load();\n      notice('PGS: ' + result.linked.length + ' collegate; ' +\n        result.pending.length + ' ancora da verificare.');\n    } else if (b.hasAttribute('data-person-access')) {\n      const approved = b.dataset.approved === 'true';\n      if (!confirm('Vuoi ' + (approved ? 'riattivare' : 'disattivare') + ' questo account?')) return;\n      b.disabled = true;\n      await api('admin/person', { id: b.dataset.personAccess, approved });\n      await load();\n      notice(approved ? 'Account riattivato.' : 'Account disattivato.');\n    } else if (b.dataset.sync) await syncAll(b.dataset.sync === 'results');\n    else if (b.dataset.reset) {\n      await api('admin/override/reset', { game_key: b.dataset.game, field: b.dataset.reset });\n      await load();\n      await showGame(b.dataset.game);\n    } else if (b.hasAttribute('data-backup')) {\n      const data = await api('admin/backup');\n      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),\n        u = URL.createObjectURL(blob);\n      const a = document.createElement('a');\n      a.href = u;\n      a.download = 'volley-control-backup-' + isoNow() + '.json';\n      a.click();\n      URL.revokeObjectURL(u);\n    } else if (b.hasAttribute('data-usage')) {\n      const data = await api('admin/usage');\n      const d = data.daily[0];\n      $('#usage').textContent =\n        (d\n          ? `${d.day}: ${d.requests} richieste, ${d.reads} righe lette, ${d.writes} righe scritte. `\n          : 'Nessun conteggio ancora disponibile. ') +\n        data.quota_scope +\n        ' ' +\n        (data.account_plan_verified\n          ? 'Piano Free verificato al momento della configurazione.'\n          : 'Piano dell’account ancora da verificare prima della pubblicazione.');\n    }\n  } catch (error) {\n    notice(error.message, $('#dialog').open);\n    b.disabled = false;\n  }\n});\nload().then(connectLive).catch((e) => notice(e.message));\n","type":"text/javascript; charset=utf-8"},"/style.css":{"body":"* {\n  box-sizing: border-box;\n}\nbody {\n  margin: 0;\n  background: #eff4f9;\n  color: #183657;\n  font:\n    15px system-ui,\n    -apple-system,\n    BlinkMacSystemFont,\n    'Segoe UI',\n    sans-serif;\n}\nmain {\n  max-width: 1300px;\n  margin: auto;\n  padding: 18px 24px 32px;\n}\n.hero {\n  background: linear-gradient(110deg, #102b4c, #166193);\n  color: white;\n  padding: 24px;\n  border-radius: 17px;\n  margin-bottom: 12px;\n}\n.hero h1 {\n  font-size: 2rem;\n  margin: 0;\n}\n.hero p {\n  color: #d5eafa;\n  margin: 8px 0 0;\n}\n.staging {\n  font-size: 12px;\n  border-left: 3px solid #ffad45;\n  padding: 6px 10px;\n  background: #fff8e8;\n}\n.top {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 12px 0;\n}\n.top #identity {\n  flex: 1;\n}\nbutton,\ninput,\nselect,\ntextarea {\n  font: inherit;\n}\nbutton {\n  cursor: pointer;\n  border: 1px solid #cbdbea;\n  background: white;\n  color: #173b5c;\n  border-radius: 7px;\n  padding: 8px 12px;\n  font-weight: 650;\n}\nbutton:hover {\n  background: #e7f1fa;\n}\nbutton:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\nbutton:focus-visible,\na:focus-visible,\ninput:focus-visible {\n  outline: 3px solid #2c91df;\n  outline-offset: 2px;\n}\nbutton.primary,\n#patty {\n  background: #17659d;\n  color: white;\n}\nh2 {\n  font-size: 18px;\n}\n#weeks {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-end;\n  gap: 7px 5px;\n  padding-top: 8px;\n  border-bottom: 3px solid #17659d;\n}\n#weeks button {\n  height: 31px;\n  min-height: 31px;\n  background: #17659d;\n  color: white;\n  border: 1px solid #17659d;\n  border-radius: 12px 12px 0 0;\n  padding: 2px 12px;\n  font-size: 12px;\n  white-space: nowrap;\n  box-shadow: inset 0 2px #ffffff35;\n}\n#weeks button[aria-pressed='true'] {\n  background: #083b68;\n  box-shadow: inset 0 3px #7ac5ff;\n  transform: translateY(-3px);\n}\n#summary {\n  margin: 8px 0 12px;\n  font-size: 13px;\n  color: #4c647b;\n}\n.legend {\n  display: flex;\n  align-items: center;\n  gap: 15px;\n  font-size: 11px;\n  margin: 8px 0;\n}\n.dot {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  font-size: 11px;\n  font-weight: 900;\n  font-style: normal;\n  vertical-align: middle;\n  flex-shrink: 0;\n}\n.covered {\n  background: #00e65f;\n  color: #064020;\n  border: 1px solid #008d39;\n}\n.missing {\n  background: #ff1744;\n  color: white;\n  border: 1px solid #c9002a;\n}\n.na {\n  color: #6b7b8b;\n  font-size: 14px;\n}\n.fixture {\n  height: 87px;\n  display: grid;\n  grid-template-columns: 64px 92px minmax(170px, 1fr) 200px 122px 128px 64px;\n  align-items: center;\n  gap: 7px;\n  background: white;\n  border: 1px solid #dbe6f0;\n  border-radius: 10px;\n  padding: 8px 9px;\n  margin-bottom: 5px;\n  text-align: center;\n  box-shadow: 0 1px 2px #19344e0a;\n  font-size: 12px;\n}\n.block {\n  height: 69px;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  overflow: hidden;\n}\n.block + .block {\n  border-left: 1px solid #e5edf4;\n  padding-left: 7px;\n}\n.category {\n  background: #ffad45;\n  color: #402400;\n  border: 1px solid #ec941f;\n  border-radius: 7px;\n}\n.category strong {\n  font-size: 26px;\n  line-height: 29px;\n}\n.category span {\n  font-size: 12px;\n  line-height: 18px;\n  font-weight: 800;\n}\n.category small {\n  font-size: 10px;\n  line-height: 16px;\n}\n.date {\n  font-weight: 750;\n}\n.date span,\n.match span {\n  height: 23px;\n  line-height: 23px;\n  white-space: nowrap;\n  overflow: auto;\n  scrollbar-width: none;\n  max-width: 100%;\n  flex-shrink: 0;\n}\n.date small {\n  font-size: 11px;\n}\n.match span:nth-child(-n + 2) {\n  font-weight: 800;\n}\n.match span:last-child {\n  font-size: 11px;\n  color: #4c647b;\n}\n.staff > div {\n  height: 34px;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  line-height: 17px;\n  min-width: 0;\n}\n.staff span {\n  display: block;\n  white-space: nowrap;\n  overflow: auto;\n  scrollbar-width: none;\n}\n.staff .managers {\n  white-space: normal;\n  overflow: auto;\n  max-height: 34px;\n  font-size: 11px;\n}\n.roles > div {\n  height: 34px;\n  min-width: 0;\n}\n.roles b {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  gap: 4px;\n  font-size: 11px;\n  line-height: 17px;\n}\n.roles span {\n  display: block;\n  white-space: nowrap;\n  overflow: auto;\n  scrollbar-width: none;\n  font-size: 11px;\n  line-height: 17px;\n}\n.status {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 4px 7px;\n  border-radius: 5px;\n  font-size: 12px;\n  font-weight: 850;\n  line-height: 1.2;\n  height: 58px;\n}\n.status.open {\n  background: #ffe04b;\n  color: #292000;\n  border: 2px solid #c99a00;\n}\n.status.ready {\n  background: #e1f4e8;\n  color: #17633f;\n  border: 1px solid #c6e6d2;\n}\n.status.away {\n  background: #e5f0fa;\n  color: #1b557f;\n  border: 1px solid #d0e3f3;\n}\n.open-game {\n  width: 64px;\n  height: 64px;\n  padding: 5px;\n  border-radius: 5px;\n  font-size: 12px;\n  line-height: 1.35;\n  white-space: normal;\n}\n.mobile,\n.quick-head {\n  display: none;\n}\nfooter {\n  margin-top: 20px;\n  font-size: 11px;\n  color: #61778b;\n}\ndialog {\n  width: min(1000px, calc(100% - 28px));\n  max-height: 90dvh;\n  overflow: auto;\n  border: 1px solid #d5e2ed;\n  border-radius: 14px;\n  padding: 16px;\n  background: #f8fbfe;\n  color: #193b5c;\n}\ndialog::backdrop {\n  background: #0b203b80;\n}\n.dialog-top {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 10px;\n  position: sticky;\n  top: -16px;\n  background: #f8fbfe;\n  z-index: 1;\n}\n.dialog-top h2 {\n  margin: 8px 0 16px;\n}\n.grid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n}\n.card {\n  border: 1px solid #dae5ee;\n  background: white;\n  border-radius: 12px;\n  padding: 9px 11px;\n  margin-bottom: 6px;\n  overflow-wrap: anywhere;\n}\n.card h3 {\n  font-size: 11px;\n  text-transform: uppercase;\n  color: #557188;\n  margin: 0 0 6px;\n}\n.card p {\n  font-size: 14px;\n  font-weight: 750;\n  margin: 0;\n}\n.card small {\n  display: block;\n  font-size: 12px;\n  color: #596e80;\n  line-height: 1.45;\n  margin-top: 4px;\n}\n.sheet-hero {\n  background: linear-gradient(115deg, #e7f1fb, #f8fbff);\n  padding: 12px 14px;\n  border: 1px solid #d6e4f1;\n  border-radius: 14px;\n  margin-bottom: 9px;\n}\n.sheet-hero strong {\n  display: block;\n  font-size: 18px;\n  margin-top: 5px;\n}\n.seat {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  justify-content: space-between;\n  border-bottom: 1px solid #dce6ef;\n  padding: 8px 0;\n}\n.seat button {\n  font-size: 12px;\n  flex-shrink: 0;\n}\n.field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  margin-bottom: 9px;\n}\n.field input,\n.field textarea,\n.field select {\n  width: 100%;\n  padding: 8px;\n  border: 1px solid #b9cbdc;\n  border-radius: 6px;\n  background: white;\n  min-width: 0;\n}\n.field textarea {\n  min-height: 60px;\n}\n.checks {\n  display: flex;\n  gap: 14px;\n  margin-bottom: 12px;\n  font-size: 13px;\n}\ndetails {\n  background: #fff;\n  border: 1px solid #dbe6ef;\n  border-radius: 8px;\n  padding: 10px;\n  margin: 8px 0;\n}\nsummary {\n  cursor: pointer;\n  font-weight: 700;\n  font-size: 14px;\n}\nform {\n  padding-top: 8px;\n}\n#message:not(:empty),\n#dialog-message:not(:empty) {\n  padding: 10px;\n  border-radius: 6px;\n  background: #fff1cf;\n  font-size: 13px;\n}\n.danger {\n  color: #bb1231;\n}\n.notice {\n  font-size: 12px;\n  color: #5b6e80;\n}\n#pending-dot {\n  color: #168bff;\n}\n.person {\n  padding: 8px;\n  border-bottom: 1px solid #dde7ef;\n}\n.actions {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n  margin: 10px 0;\n}\n[hidden] {\n  display: none !important;\n}\n@media (max-width: 1100px) {\n  main {\n    padding: 10px 12px;\n  }\n  .hero {\n    padding: 10px 12px;\n    margin-bottom: 8px;\n  }\n  .hero h1 {\n    font-size: 20px;\n  }\n  .hero p {\n    display: none;\n  }\n  .staging {\n    font-size: 10px;\n    margin: 5px 0;\n  }\n  .top {\n    gap: 5px;\n    flex-wrap: wrap;\n  }\n  .top button {\n    font-size: 11px;\n    padding: 7px 8px;\n  }\n  .top #identity {\n    font-size: 11px;\n  }\n  .fixture {\n    min-height: 36px;\n    height: auto;\n    grid-template-columns: minmax(0, 1fr) 64px;\n    gap: 3px;\n    border-radius: 3px;\n    padding: 1px 4px;\n    margin-bottom: 2px;\n    font-variant-numeric: tabular-nums;\n  }\n  .fixture > .block {\n    display: none;\n  }\n  .mobile {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) 42px 38px 22px 22px;\n    gap: 3px;\n    align-items: center;\n    min-height: 32px;\n    font-size: 12px;\n    min-width: 0;\n  }\n  .mobile .identity {\n    min-width: 0;\n    line-height: 14px;\n  }\n  .mobile .cat {\n    background: #ffad45;\n    color: #402400;\n    border-radius: 3px;\n    padding: 0 3px;\n    font-size: 12px;\n    font-weight: 800;\n  }\n  .mobile .source {\n    font-size: 10px;\n    margin-left: 3px;\n  }\n  .mobile .short {\n    display: block;\n    font-size: 11px;\n    line-height: 14px;\n    font-weight: 750;\n    overflow-wrap: anywhere;\n  }\n  .open-game {\n    height: 32px;\n    font-size: 11px;\n    padding: 1px 3px;\n    line-height: 13px;\n    border-radius: 4px;\n  }\n  .quick-head {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) 42px 38px 22px 22px 64px;\n    gap: 3px;\n    padding: 0 5px;\n    font-size: 10px;\n    font-weight: 750;\n    color: #4c647b;\n    text-align: center;\n    margin-bottom: 3px;\n  }\n  #summary {\n    font-size: 12px;\n    margin: 6px 0;\n  }\n  .legend {\n    justify-content: center;\n  }\n  h2 {\n    font-size: 15px;\n  }\n  #weeks {\n    gap: 6px 4px;\n  }\n  #weeks button {\n    padding: 2px 8px;\n    font-size: 11px;\n  }\n  dialog {\n    padding: 12px;\n  }\n  .dialog-top {\n    top: -12px;\n  }\n  .grid {\n    grid-template-columns: 1fr;\n  }\n  .seat {\n    font-size: 12px;\n  }\n  .card p {\n    font-size: 13px;\n  }\n  .sheet-hero strong {\n    font-size: 16px;\n  }\n}\n\n.metrics {\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  gap: 12px;\n  margin: 12px 0;\n}\n.metrics > div {\n  background: white;\n  border: 1px solid #dae5f0;\n  border-radius: 12px;\n  padding: 13px;\n}\n.metrics span {\n  display: block;\n  font-size: 13px;\n}\n.metrics strong {\n  display: block;\n  font-size: 25px;\n  margin-top: 5px;\n}\n@media (max-width: 1100px) {\n  .metrics {\n    display: none;\n  }\n}\n\n/* Conferma esplicita per prenotazione, annullamento e rimozione incarichi. */\n.action-confirmation {\n  margin: 0 0 16px;\n  padding: 16px;\n  border: 2px solid #e4a63a;\n  border-radius: 12px;\n  background: #fff9e8;\n}\n.action-confirmation h3 { margin: 0 0 8px; }\n.action-confirmation p { margin: 8px 0; }\n.action-confirmation .actions button { min-height: 40px; }\n","type":"text/css; charset=utf-8"}};
const clean = (v) => String(v ?? '').trim();
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function dateISO(v) {
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
function hour(v) {
  v = clean(v).replace('.', ':');
  if (!v) return '';
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) fail('Ora non valida.');
  return v.slice(0, 5);
}
function weekStart(v) {
  const d = new Date(dateISO(v) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function interval(g) {
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
function scopeFor(t) {
  return [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':');
}
const required = (g, r) =>
  !g.is_home ? 0 : Number(g[r === 'referee' ? 'required_referees' : 'required_scorers'] || 0);
function roleState(g, as, r) {
  if (g.is_home && g['federal_' + r]) return 'covered';
  const n = required(g, r);
  return !n ? 'na' : as.filter((x) => x.role === r).length >= n ? 'covered' : 'missing';
}
function coverage(g, a = []) {
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
function normalizeFipav(payload, t) {
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
function normalizePgs(matches, registrations, t) {
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
function mergeGame(old, incoming, resultsOnly = false) {
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
    if (JSON.stringify(official[field]) !== JSON.stringify(value))
      conflicts.push({ field, incoming: JSON.stringify(official[field] ?? null) });
  const effective = { ...official, ...overrides };
  return { official, overrides, effective, conflicts };
}
const EDITABLE = {
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
function validatePatch(p) {
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
function validateTeam(x) {
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

const RELEASE = 'cf-staging-2026-10-27.10';
const enc = new TextEncoder();
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha = async (v) => hex(await crypto.subtle.digest('SHA-256', enc.encode(v)));
async function identityKey(first, last) {
  const norm = (v) => clean(v).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('it');
  return (await sha(JSON.stringify([norm(first), norm(last)]))) + '@example.invalid';
}
const validCode = (v) => typeof v === 'string' && /^[A-Za-z0-9]{4}$/.test(v);
function equal(a, b) {
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
async function passwordHash(password, pepper, salt = random().slice(0, 32)) {
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
async function verifyPassword(password, record, pepper) {
  try {
    const [alg, n, salt] = record.split(':');
    if (alg !== 'pbkdf2_sha512_peppered' || n !== '100000') return false;
    return equal(await passwordHash(password, pepper, salt), record);
  } catch {
    return false;
  }
}
const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);
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
const audit = (db, actor, action, key, details) =>
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
const PERSONAL_SESSION_EXPIRES = 253402300799000; // fine anno 9999
const sessionCookie = (token, seconds) =>
  `__Host-vc=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
const sessionToken = (req) =>
  (req.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('__Host-vc='))
    ?.slice(10);
async function authenticate(req, env) {
  const token = sessionToken(req);
  if (!token) return null;
  const s = await one(
    env.DB,
    'SELECT s.*, p.approved,p.wants_referee,p.wants_scorer,p.wants_manager,p.wants_coach,p.first_name,p.last_name FROM sessions s LEFT JOIN people p ON p.id=s.person_id WHERE token_hash=? AND expires_at>?',
    await sha(token),
    Date.now(),
  );
  if (!s || (!s.admin && !s.approved)) return null;
  return s;
}
function admin(s) {
  if (!s?.admin) fail('Accesso PATTY richiesto.', 403);
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
  const expires = isAdmin ? Date.now() + 1800000 : PERSONAL_SESSION_EXPIRES;
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
    'Set-Cookie': sessionCookie(token, isAdmin ? 1800 : PERSONAL_COOKIE_SECONDS),
  });
}
function gameValues(g, scope, official, overrides = {}, sourceMissing = 0) {
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
async function saveGame(
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
async function saveImport(db, incoming, scope, resultsOnly = false, markMissing = true) {
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
function dbMessage(e) {
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
async function assign(db, key, role, slot, pid, source = 'self', actor = pid) {
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
async function applyFixed(db, teamId = null, keys = null) {
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
const rosterCategoryKey = (s) => {
  const v=clean(s).toUpperCase().replace(/UNDER[\s-]*/g,'U');
  const age=v.match(/\bU\s*(\d+)\b/);
  return age ? 'U'+age[1] : v.replace(/[^A-Z0-9]/g,'');
};
const rosterMatch = (r,c) => rosterNameKey(r.name)===rosterNameKey(c.name) &&
  rosterCategoryKey(r.category)===rosterCategoryKey(c.category);
async function syncScope(env, scope, resultsOnly = false) {
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
async function syncStep(env, id) {
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
const BACKUP_TABLES = [
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
async function exportBackup(db) {
  const data = {};
  for (const table of BACKUP_TABLES) data[table] = await all(db, `SELECT * FROM ${table}`);
  return { format: 'volley-control-backup', version: 1, created_at: at(), data };
}
async function restoreBackup(db, b) {
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
async function startRecovery(db, backup) {
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
async function recoveryStep(db, id) {
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
    return new Response(asset.body, {
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
  const actor = s?.admin ? 'PATTY' : s?.person_id;
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
    if (s && !s.admin) {
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
    if (!b.staging_consent && env.ENVIRONMENT !== 'production')
      fail('Usare solo dati fittizi in questo ambiente di prova.');
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
  if (path === '/api/book' && req.method === 'POST') {
    if (!s || s.admin || !s.person_id) fail('Accedi dall’area personale.', 403);
    const b = await body(req);
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
        'SELECT id,first_name,last_name,wants_referee,wants_scorer,wants_manager,wants_coach,approved,created_at FROM people ORDER BY last_name,first_name',
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
      if(found.length!==1) {pending.push({id:r.id,reason:found.length?'Ambiguità':'Non trovata'});continue;}
      const item=found[0],officialId=clean(item.id||item._id);
      if(seen.has(officialId)||
         await one(env.DB,'SELECT 1 FROM team_roster WHERE linked_team_id=?','PGS:'+officialId)) {
        pending.push({id:r.id,reason:'Identificativo già usato'});continue;
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
      } catch(e) {pending.push({id:r.id,reason:'Conflitto di collegamento'});}
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
  if (path === '/api/admin/person' && req.method === 'POST') {
    const b = await body(req);
    if (!b || Object.keys(b).sort().join(',') !== 'approved,id' ||
        typeof b.approved !== 'boolean' || typeof b.id !== 'string' || !b.id)
      fail('PATTY può soltanto attivare o disattivare un account.', 400);
    const person = await one(env.DB, 'SELECT id,approved FROM people WHERE id=?', b.id);
    if (!person) fail('Utente non trovato.', 404);
    if (!!person.approved === b.approved) return json({ ok: true, approved: b.approved });
    await env.DB.batch([
      statement(env.DB, 'UPDATE people SET approved=? WHERE id=?', +b.approved, b.id),
      ...(b.approved ? [] : [statement(env.DB, 'DELETE FROM sessions WHERE person_id=?', b.id)]),
      audit(env.DB, actor, 'person_access_changed', null, { id: b.id, approved: b.approved }),
    ]);
    return json({ ok: true, approved: b.approved });
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
    if (env.RECOVERY_MODE !== 'true')
      fail('Ripristino disponibile solo nell’ambiente di recupero isolato.', 403);
    return json(await startRecovery(env.DB, await body(req)));
  }
  if (path === '/api/admin/restore/step' && req.method === 'POST') {
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
function instrumentDB(db, meter) {
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
        '/api/admin/game', '/api/admin/override/reset',
        '/api/admin/manual', '/api/admin/team', '/api/admin/person',
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
