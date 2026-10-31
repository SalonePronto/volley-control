const ASSETS = {"/":{"body":"<!doctype html>\n<html lang=\"it\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />\n    <meta name=\"color-scheme\" content=\"light\" />\n    <title>VOLLEY CONTROL</title>\n    <link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/icons/pvi-volley-control-v4-180.png\" />\n    <link rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"/icons/pvi-volley-control-v4-192.png\" />\n    <link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n    <meta name=\"theme-color\" content=\"#10233d\" />\n    <meta name=\"apple-mobile-web-app-title\" content=\"Volley Control\" />\n    <link rel=\"stylesheet\" href=\"/style.css\" />\n    <script type=\"module\" src=\"/app.js\"></script>\n  </head>\n  <body>\n    <header class=\"hero\"><div class=\"hero-in\">\n        <div class=\"brand\">\n          <span class=\"logo\" aria-hidden=\"true\">\n            <img src=\"/icons/pvi-volley-control-v4-180.png\" width=\"32\" height=\"32\" alt=\"\" />\n          </span>\n          <h1>VOLLEY CONTROL</h1>\n          <p>Calendario settimanale · FIPAV · PGS</p>\n        </div>\n        <nav class=\"top\">\n          <button id=\"home\">Home</button><span id=\"identity\"></span\n          ><button id=\"access\">Area personale</button\n          ><button id=\"patty\">🔒 PATTY <span id=\"pending-dot\"></span></button>\n        </nav>\n      </div></header>\n    <main id=\"app\">\n      <div id=\"message\" role=\"status\" aria-live=\"polite\"></div>\n      <section id=\"admin\" hidden></section>\n      <div class=\"layout\">\n        <aside class=\"side\">\n          <nav id=\"weeks\" aria-label=\"Settimane delle gare\"></nav>\n          <label class=\"team-filter\"><span>Filtra tutte le gare per squadra</span><select id=\"team-select\" aria-label=\"Filtra tutte le gare per squadra\"><option value=\"\">Caricamento squadre…</option></select></label>\n          <button id=\"download-team-pdf\" class=\"team-pdf-button\" hidden>Scarica calendario completo in PDF</button>\n          <h2 id=\"title\">Caricamento…</h2>          <h2 id=\"title\">Caricamento…</h2>\n          <div id=\"metrics\" class=\"metrics\"></div>\n          <div id=\"summary\"></div>\n          <div class=\"legend\">\n            <span><i class=\"dot covered\">✓</i> Coperto</span\n            ><span><i class=\"dot missing\">!</i> Mancante</span><span>Trasferta: nessun posto da coprire</span>\n          </div>\n        </aside>\n        <section id=\"games\" aria-label=\"Calendario partite\"></section>\n      </div>\n    </main>\n    <dialog id=\"dialog\">\n      <div class=\"dialog-top\">\n        <h2 id=\"dialog-title\"></h2>\n        <button id=\"close-dialog\" aria-label=\"Chiudi finestra\">✕</button>\n      </div>\n      <div id=\"dialog-content\"></div>\n      <p id=\"dialog-message\" role=\"status\" aria-live=\"polite\"></p>\n    </dialog>\n  </body>\n</html>\n","type":"text/html; charset=utf-8"},"/app.js":{"body":"const $ = (s) => document.querySelector(s),\n  esc = (v) =>\n    String(v ?? '').replace(\n      /[&<>\"']/g,\n      (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[x],\n    );\nlet state = {\n    games: [],\n    teams: [],\n    assignments: [],\n    user: null,\n    csrf: null,\n    week: null,\n    admin: null,\n    registration_enabled: false,\n  },\n  currentGame = null;\nlet selectedTeamId = '';\nconst ROLES = { referee: 'Arbitro', scorer: 'Refertista' };\n// NOVAVISION: gestione manuale definitiva, esclusa dai collegamenti automatici.\nconst manualCalendarOnly = (team) => /\\bNOVAVISION\\b/i.test(team.name || '');\nconst FIELDS = {\n  date: 'Data',\n  time: 'Ora',\n  category: 'Categoria',\n  home_team: 'Squadra casa',\n  away_team: 'Squadra ospite',\n  game_number: 'Numero gara',\n  venue: 'Palestra',\n  address: 'Indirizzo',\n  notes: 'Note',\n  played: 'Disputata (true/false)',\n  home_sets: 'Set casa',\n  away_sets: 'Set ospite',\n  sets: 'Parziali (JSON)',\n  required_referees: 'Arbitri richiesti',\n  required_scorers: 'Refertisti richiesti',\n  hidden: 'Nascondi / annulla (true/false)',\n};\nconst isoNow = () =>\n  new Intl.DateTimeFormat('en-CA', {\n    timeZone: 'Europe/Rome',\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).format(new Date());\nfunction weekOf(v) {\n  const d = new Date(v + 'T12:00:00Z');\n  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));\n  return d.toISOString().slice(0, 10);\n}\nconst shortDate = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—');\nfunction weekLabel(w) {\n  const e = new Date(w + 'T12:00:00Z');\n  e.setUTCDate(e.getUTCDate() + 6);\n  return 'GARE ' + shortDate(w) + ' – ' + shortDate(e.toISOString().slice(0, 10));\n}\nconst assigned = (g) => state.assignments.filter((a) => a.game_key === g.game_key);\n// Evidenzia esclusivamente le partite dell'utente nell'area personale.\n// Vale anche per gli incarichi FISSI assegnati da PATTY.\nconst myBooking = (g) =>\n  !!state.user?.id && !state.user.admin &&\n  state.assignments.some((a) => a.game_key === g.game_key && a.person_id === state.user.id);\n// Colori di riconoscimento dello staff, solo nell'area personale.\n// Lo staff delle squadre usa spesso soltanto il nome: confrontiamo il nome\n// completo quando presente, altrimenti il nome esatto, mai sottostringhe.\nconst staffName = (name) => String(name || '')\n  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')\n  .trim().replace(/\\s+/g, ' ').toLocaleLowerCase('it');\nfunction staffMatches(value, user) {\n  if (!user?.first_name || !user?.last_name) return false;\n  const first = staffName(user.first_name),\n    full = staffName(user.first_name + ' ' + user.last_name);\n  return String(value || '').split(/[\\n,;/]+/)\n    .some((part) => {\n      const listed = staffName(part);\n      return listed && (listed === first || listed === full);\n    });\n}\nfunction myStaffColor(g, team) {\n  const u = state.user;\n  if (!u?.id || u.admin) return '';\n  const staff = g.staff_override || team;\n  if (u.wants_coach && (staffMatches(staff.coach1, u) || staffMatches(staff.coach2, u)))\n    return ' my-coach';\n  if (u.wants_manager && staffMatches(staff.managers, u))\n    return ' my-manager';\n  return '';\n}\nconst federal = (g, r) => !!g.is_home && !!g['federal_' + r];\nconst missingSeats = (g, r) => federal(g, r) ? 0 :\n  Math.max(0, required(g, r) - assigned(g).filter((a) => a.role === r).length);\nconst required = (g, r) =>\n  g.is_home ? Number(g[r === 'referee' ? 'required_referees' : 'required_scorers'] || 0) : 0;\nfunction roleState(g, r) {\n  if (federal(g, r)) return 'covered';\n  const n = required(g, r);\n  return !n ? 'na' : assigned(g).filter((a) => a.role === r).length >= n ? 'covered' : 'missing';\n}\nfunction dot(g, r) {\n  const s = roleState(g, r),\n    text = s === 'covered' ? 'Coperto' : s === 'missing' ? 'Mancante' : 'Non richiesto';\n  return `<i class=\"dot ${s}\" role=\"img\" aria-label=\"${ROLES[r]}: ${text}\" title=\"${ROLES[r]}: ${text}\">${s === 'covered' ? '✓' : s === 'missing' ? '!' : '—'}</i>`;\n}\nfunction status(g) {\n  if (g.source_missing) return 'Gara assente dalla fonte · verifica PATTY';\n  if (!g.is_home) return 'Trasferta';\n  const r = roleState(g, 'referee') === 'missing',\n    s = roleState(g, 'scorer') === 'missing';\n  return r && s\n    ? 'Arbitro e refertista mancanti'\n    : r\n      ? 'Arbitro mancante'\n      : s\n        ? 'Refertista mancante'\n        : 'Completa';\n}\nconst names = (g, r) =>\n  federal(g, r) ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') :\n  assigned(g)\n    .filter((a) => a.role === r)\n    .map((a) => a.first_name + ' ' + a.last_name)\n    .join(', ');\nfunction notice(message, dialog = false) {\n  $(dialog ? '#dialog-message' : '#message').textContent = message || '';\n}\nasync function api(path, data) {\n  const res = await fetch('/api/' + path, {\n    method: data === undefined ? 'GET' : 'POST',\n    headers:\n      data === undefined\n        ? {}\n        : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' },\n    body: data === undefined ? undefined : JSON.stringify(data),\n    credentials: 'same-origin',\n  });\n  let result;\n  try {\n    result = await res.json();\n  } catch {\n    throw new Error('Servizio non disponibile. Riprova più tardi.');\n  }\n  if (!res.ok) throw new Error(result.error || 'Operazione non riuscita.');\n  return result;\n}\n// PATTY: rinnovo discreto solo mentre l'organizzatore usa l'app.\nlet lastPattyActivity = Date.now();\nfor (const eventName of ['pointerdown', 'keydown', 'scroll']) {\n  document.addEventListener(eventName, () => { lastPattyActivity = Date.now(); }, { passive: true });\n}\nasync function renewActivePattySession() {\n  if (!state.user?.admin || document.hidden ||\n      Date.now() - lastPattyActivity > 15 * 60 * 1000) return;\n  try {\n    const me = await api('me');\n    if (!me.user?.admin) {\n      state.user = null;\n      state.csrf = null;\n      state.admin = null;\n      render();\n    }\n  } catch {\n    // Nessun messaggio invasivo: la prossima operazione verificherà l'accesso.\n  }\n}\n// Controllo leggero ogni cinque minuti; il server scrive solo vicino alla scadenza.\nsetInterval(renewActivePattySession, 5 * 60 * 1000);\n// Eventi reali: nessun controllo a intervalli del database.\nlet liveSocket = null, liveRetryTimer = null, liveRetryCount = 0;\nlet liveRefreshing = false, livePending = false;\nasync function refreshLiveCalendar() {\n  if (document.hidden) { livePending = true; return; }\n  if (liveRefreshing) { livePending = true; return; }\n  liveRefreshing = true;\n  try {\n    do {\n      livePending = false;\n      const c = await api('calendar');\n      state = { ...state, ...c };\n      if (state.user?.admin) state.admin = await api('admin/state');\n      render();\n      // La scheda di gara resta aggiornata, senza interrompere una conferma in corso.\n      if ($('#dialog').open && currentGame && !$('#action-confirmation') && !state.user?.admin)\n        await showGame(currentGame);\n    } while (livePending && !document.hidden);\n  } catch (error) {\n    // La prossima riapertura o riconnessione recupera lo stato dal database.\n    livePending = true;\n  } finally {\n    liveRefreshing = false;\n  }\n}\nfunction connectLive() {\n  if (document.hidden || typeof WebSocket === 'undefined' ||\n      (liveSocket && liveSocket.readyState <= WebSocket.OPEN)) return;\n  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }\n  const socket = new WebSocket(\n    (location.protocol === 'https:' ? 'wss://' : 'ws://') +\n    location.host + '/api/sync',\n  );\n  liveSocket = socket;\n  socket.onopen = () => {\n    if (socket !== liveSocket) return;\n    liveRetryCount = 0;\n    refreshLiveCalendar();\n  };\n  socket.onmessage = (event) => {\n    if (event.data === '{\"type\":\"calendar-changed\"}') refreshLiveCalendar();\n  };\n  socket.onerror = () => socket.close();\n  socket.onclose = () => {\n    if (liveSocket !== socket) return;\n    liveSocket = null;\n    if (!document.hidden) {\n      const delay = Math.min(30000, 1000 * 2 ** Math.min(liveRetryCount++, 5));\n      liveRetryTimer = setTimeout(connectLive, delay);\n    }\n  };\n}\nfunction suspendLive() {\n  if (liveRetryTimer) { clearTimeout(liveRetryTimer); liveRetryTimer = null; }\n  if (liveSocket) {\n    const socket = liveSocket;\n    liveSocket = null;\n    socket.close();\n  }\n}\ndocument.addEventListener('visibilitychange', () => {\n  if (document.hidden) suspendLive();\n  else { refreshLiveCalendar(); connectLive(); }\n});\nwindow.addEventListener('focus', () => {\n  if (!document.hidden) {\n    renewActivePattySession();\n    refreshLiveCalendar();\n  }\n});\nasync function load() {\n  const [me, c] = await Promise.all([api('me'), api('calendar')]);\n  state = { ...state, ...me, ...c };\n  if (state.user && !state.user.admin) rememberRegisteredOnThisDevice();\n  if (state.user?.admin) state.admin = await api('admin/state');\n  else state.admin = null;\n  render();\n}\nfunction render() {\n  const pending = state.games.filter((g) => !g.date || !g.time);\n  $('#patty').textContent = state.user?.admin\n    ? (state.user.id ? '🔓 Torna all’area personale' : '🔓 Esci da PATTY')\n    : state.user?.can_access_patty ? '🔒 Entra in PATTY' : '🔒 PATTY';\n  $('#patty').append(\n    Object.assign(document.createElement('span'), {\n      id: 'pending-dot',\n      textContent: pending.length ? ' ●' : '',\n    }),\n  );\n  $('#identity').textContent =\n    state.user?.id ? state.user.first_name + ' ' + state.user.last_name : '';\n  $('#access').textContent =\n    state.user?.id ? 'Esci dall’area personale' : 'Area personale';\n  const visibleGames = state.games.filter((g) => !g.hidden);\n  const games = visibleGames.filter((g) => g.date && g.time);\n  const teamsWithGames = new Set(visibleGames.map((g) => g.team_id).filter(Boolean));\n  const teamById = new Map(state.teams.map((t) => [String(t.id), t]));\n  const teamLabel = (team) => {\n    const scope = team.source === 'FIPAV' ? team.group_id : team.competition;\n    return [\n      team.category,\n      team.name,\n      team.source,\n      team.season,\n      scope ? (team.source === 'FIPAV' ? 'Girone ' : 'Campionato ') + scope : '',\n    ].filter(Boolean).join(' · ');\n  };\n  const teamOptions = [...teamsWithGames]\n    .map((id) => teamById.get(String(id)))\n    .filter(Boolean)\n    .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b), 'it'));\n  if (selectedTeamId && !teamOptions.some((team) => String(team.id) === selectedTeamId))\n    selectedTeamId = '';\n  $('#team-select').innerHTML =\n    '<option value=\"\">Tutte le squadre · vista attuale</option>' +\n    teamOptions.map((team) =>\n      `<option value=\"${esc(team.id)}\" ${String(team.id) === selectedTeamId ? 'selected' : ''}>${esc(teamLabel(team))}</option>`,\n    ).join('');\n  $('#weeks').hidden = !!selectedTeamId;\n  $('#download-team-pdf').hidden = !selectedTeamId;\n  const weeks = [...new Set(games.map((g) => weekOf(g.date)))].sort();\n  const baseWeek = state.week || weekOf(isoNow());\n  const prevWeek = [...weeks].reverse().find((x) => x < baseWeek),\n    nextWeek = weeks.find((x) => x > baseWeek),\n    range = (x) => weekLabel(x).replace('GARE ', '');\n  $('#weeks').innerHTML =\n    `<button class=\"step\" ${prevWeek ? `data-week=\"${prevWeek}\"` : 'disabled'} aria-label=\"Settimana precedente\">‹</button>` +\n    `<label class=\"week-pick\"><span>${state.week ? 'Settimana' : 'Settimana corrente'}</span>` +\n    `<select id=\"week-select\" aria-label=\"Scegli la settimana\"><option value=\"\">Home · ${range(baseWeek)}</option>` +\n    weeks.map((x) => `<option value=\"${x}\" ${state.week === x ? 'selected' : ''}>${range(x)}</option>`).join('') +\n    `</select></label>` +\n    `<button class=\"step\" ${nextWeek ? `data-week=\"${nextWeek}\"` : 'disabled'} aria-label=\"Settimana successiva\">›</button>`;\n  const selectedTeam = teamOptions.find((team) => String(team.id) === selectedTeamId);\n  const w = state.week || weekOf(isoNow());\n  $('#title').textContent = selectedTeam\n    ? 'Tutte le gare · ' + selectedTeam.name\n    : state.week ? weekLabel(w)\n      : (state.user?.id && !state.user.admin ? 'Gare da coprire e mie prenotazioni' : 'Gare casalinghe da coprire');\n  $('#title').classList.toggle('sr-only', !selectedTeamId && !state.week);\n  let rows;\n  let fullWeek;\n  if (selectedTeam) {\n    rows = visibleGames.filter((g) => String(g.team_id) === selectedTeamId);\n    rows.sort((a, b) =>\n      (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') ||\n      (a.time || '99:99').localeCompare(b.time || '99:99') ||\n      String(a.game_number || '').localeCompare(String(b.game_number || '')),\n    );\n    fullWeek = rows;\n  } else {\n    rows = games.filter((g) => weekOf(g.date) === w);\n    if (!state.week)\n      rows = rows.filter(\n        (g) =>\n          g.is_home &&\n          (roleState(g, 'referee') === 'missing' || roleState(g, 'scorer') === 'missing' || myBooking(g)),\n      );\n    rows.sort((a, b) =>\n      (a.date + a.time + a.game_number).localeCompare(b.date + b.time + b.game_number),\n    );\n    fullWeek = games.filter((g) => weekOf(g.date) === w);\n  }\n  const allMiss = (r) =>\n    fullWeek.reduce(\n      (s, g) => s + missingSeats(g, r),\n      0,\n    );\n  $('#metrics').innerHTML = [\n    ['Partite', fullWeek.length],\n    ['Complete', fullWeek.filter((g) => status(g) === 'Completa').length],\n    ['Da completare', fullWeek.filter((g) => g.is_home && status(g) !== 'Completa').length],\n    ['Arbitri mancanti', allMiss('referee')],\n    ['Refertisti mancanti', allMiss('scorer')],\n  ]\n    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)\n    .join('');\n  const miss = (r) =>\n    rows.reduce(\n      (s, g) => s + missingSeats(g, r),\n      0,\n    );\n  $('#summary').textContent = selectedTeam\n    ? `${rows.length} gare della squadra · da coprire: ARB ${miss('referee')} · REF ${miss('scorer')}`\n    : `${rows.length} gare · da coprire: ARB ${miss('referee')} · REF ${miss('scorer')}`;\n  if (selectedTeam) {\n    const dated = rows.filter((g) => g.date);\n    const undated = rows.filter((g) => !g.date);\n    let lastWeek = null;\n    const parts = [];\n    for (const [i, game] of dated.entries()) {\n      const week = weekOf(game.date);\n      if (week !== lastWeek) {\n        parts.push(`<h3 class=\"team-week-heading\">${esc(weekLabel(week))}</h3>`);\n        lastWeek = week;\n      }\n      parts.push(rowHTML(game, i > 0 && dated[i - 1].date !== game.date));\n    }\n    if (undated.length) {\n      parts.push('<h3 class=\"team-week-heading\">Gare senza data</h3>');\n      parts.push(undated.map((g) => rowHTML(g)).join(''));\n    }\n    $('#games').innerHTML = parts.join('') ||\n      '<p class=\"notice\">Nessuna gara registrata per questa squadra.</p>';\n  } else {\n    $('#games').innerHTML =\n      rows.map((g, i) => rowHTML(g, i > 0 && rows[i - 1].date !== g.date)).join('') ||\n      '<p class=\"notice\">Nessuna gara da mostrare. Scegli una settimana per consultare tutte le partite.</p>';\n  }\n  $('#admin').hidden = !state.user?.admin;\n  if (state.user?.admin) renderAdmin();\n}\nfunction downloadTeamCalendarPdf() {\n  const team = state.teams.find((t) => String(t.id) === selectedTeamId);\n  if (!team) return;\n  const games = state.games\n    .filter((g) => !g.hidden && String(g.team_id) === selectedTeamId)\n    .sort((a, b) =>\n      (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') ||\n      (a.time || '99:99').localeCompare(b.time || '99:99') ||\n      String(a.game_number || '').localeCompare(String(b.game_number || '')),\n    );\n  const winAnsi = (value) => {\n    const special = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };\n    let out = '';\n    for (const char of String(value ?? '')) {\n      const point = char.codePointAt(0);\n      out += String.fromCharCode(special[char] ?? (point >= 32 && point <= 255 ? point : 63));\n    }\n    return out;\n  };\n  const pdfEscape = (value) => winAnsi(value).replace(/[\\\\()]/g, (char) => '\\\\' + char);\n  const wrap = (value, width, size = 8) => {\n    const limit = Math.max(8, Math.floor(width / (size * 0.52)));\n    const lines = [];\n    for (const paragraph of String(value || '').split(/\\r?\\n/)) {\n      let line = '';\n      for (const word of paragraph.split(/\\s+/).filter(Boolean)) {\n        if (line && (line + ' ' + word).length <= limit) line += ' ' + word;\n        else if (!line && word.length <= limit) line = word;\n        else {\n          if (line) lines.push(line);\n          let part = word;\n          while (part.length > limit) {\n            lines.push(part.slice(0, limit));\n            part = part.slice(limit);\n          }\n          line = part;\n        }\n      }\n      if (line) lines.push(line);\n    }\n    return lines.length ? lines : [''];\n  };\n  const color = (rgb, stroke = false) => rgb.map((n) => (n / 255).toFixed(3)).join(' ') + (stroke ? ' RG' : ' rg');\n  const widths = [34, 72, 175, 175, 250, 56];\n  const left = 40;\n  const xs = [left];\n  widths.forEach((width) => xs.push(xs[xs.length - 1] + width));\n  const items = [];\n  let lastGroup = '';\n  games.forEach((game, index) => {\n    const group = game.date ? weekOf(game.date) : 'undated';\n    if (group !== lastGroup) {\n      items.push({ kind: 'group', label: group === 'undated' ? 'GARE SENZA DATA' : weekLabel(group), height: 22 });\n      lastGroup = group;\n    }\n    const dateLines = game.date ? [shortDate(game.date) + '/' + game.date.slice(0, 4), game.time || 'Ora da definire'] : ['Data da definire', game.time || 'Ora da definire'];\n    const home = wrap(game.home_team || 'Squadra da definire', widths[2] - 10);\n    const away = wrap(game.away_team || 'Squadra da definire', widths[3] - 10);\n    const place = wrap([game.venue, game.address, game.notes].filter(Boolean).join(' · ') || 'Palestra da definire', widths[4] - 10);\n    const lines = Math.max(dateLines.length, home.length, away.length, place.length, 1);\n    items.push({ kind: 'game', game, index, dateLines, home, away, place, height: Math.max(30, lines * 10 + 10) });\n  });\n  if (!items.length) items.push({ kind: 'empty', label: 'Nessuna gara registrata per questa squadra.', height: 32 });\n  const pages = [];\n  let page = [], cursor = 468;\n  for (const item of items) {\n    if (cursor - item.height < 42 && page.length) {\n      pages.push(page);\n      page = [];\n      cursor = 468;\n    }\n    page.push(item);\n    cursor -= item.height;\n  }\n  if (page.length) pages.push(page);\n  const pageStreams = pages.map((pageItems, pageIndex) => {\n    const ops = [];\n    const rect = (x, y, w, h, rgb) => ops.push(color(rgb) + ' ' + x + ' ' + y + ' ' + w + ' ' + h + ' re f');\n    const line = (x1, y1, x2, y2, rgb = [214, 222, 234]) => ops.push(color(rgb, true) + ' 0.5 w ' + x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S');\n    const text = (x, y, value, size = 8, font = 'F1', rgb = [28, 42, 61]) =>\n      ops.push(color(rgb) + ' BT /' + font + ' ' + size + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + pdfEscape(value) + ') Tj ET');\n    rect(0, 513, 842, 82, [20, 42, 76]);\n    text(40, 565, 'CALENDARIO COMPLETO', 18, 'F2', [255, 255, 255]);\n    const teamTitle = wrap(String(team.name || 'Squadra'), 748, 11).slice(0, 2);\n    teamTitle.forEach((part, i) => text(40, 546 - i * 13, part, 11, 'F2', [255, 255, 255]));\n    const scope = team.source === 'FIPAV' ? team.group_id : team.competition;\n    const details = [team.category, team.source, team.season, scope ? (team.source === 'FIPAV' ? 'Girone ' : 'Campionato ') + scope : '', games.length + ' gare'].filter(Boolean).join(' · ');\n    text(40, teamTitle.length > 1 ? 520 : 529, details, 8, 'F1', [222, 231, 244]);\n    rect(left, 476, 762, 20, [47, 91, 234]);\n    ['N.', 'DATA / ORA', 'SQUADRA CASA', 'SQUADRA OSPITE', 'PALESTRA / INDIRIZZO', 'RIS.'].forEach((label, i) =>\n      text(xs[i] + 4, 483, label, 7, 'F2', [255, 255, 255]),\n    );\n    let y = 468, rowNumber = 0;\n    for (const item of pageItems) {\n      if (item.kind === 'group') {\n        rect(left, y - item.height + 2, 762, 20, [232, 238, 249]);\n        text(left + 7, y - 12, item.label, 8, 'F2', [35, 73, 158]);\n        y -= item.height;\n        continue;\n      }\n      if (item.kind === 'empty') {\n        text(left + 5, y - 18, item.label, 9, 'F1');\n        y -= item.height;\n        continue;\n      }\n      const top = y, bottom = y - item.height, game = item.game;\n      rect(left, bottom, 762, item.height, rowNumber++ % 2 ? [255, 255, 255] : [248, 250, 253]);\n      line(left, bottom, xs[xs.length - 1], bottom);\n      for (const x of xs.slice(1, -1)) line(x, bottom, x, top);\n      const writeLines = (x, values, width) => {\n        values.forEach((value, i) => {\n          const baseline = top - 12 - i * 10;\n          const maximum = Math.floor((width - 10) / (8 * 0.52));\n          text(x + 5, baseline, value.length > maximum ? value.slice(0, maximum - 1) + '…' : value, 8);\n        });\n      };\n      text(xs[0] + 5, top - 17, String(game.game_number || item.index + 1), 8);\n      writeLines(xs[1], item.dateLines, widths[1]);\n      writeLines(xs[2], item.home, widths[2]);\n      writeLines(xs[3], item.away, widths[3]);\n      writeLines(xs[4], item.place, widths[4]);\n      const result = game.played ? String(game.home_sets ?? '') + '-' + String(game.away_sets ?? '') : '—';\n      text(xs[5] + 7, top - 17, result, 8, game.played ? 'F2' : 'F1');\n      y = bottom;\n    }\n    line(left, 34, 802, 34, [194, 204, 219]);\n    text(left, 21, 'VOLLEY CONTROL · Calendario squadra', 7, 'F1', [103, 116, 135]);\n    text(742, 21, String(pageIndex + 1) + ' / ' + pages.length, 7, 'F2', [103, 116, 135]);\n    return ops.join('\\n');\n  });\n  const objects = [\n    '<< /Type /Catalog /Pages 2 0 R >>',\n    '<< /Type /Pages /Kids [' + pageStreams.map((_, i) => (5 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pageStreams.length + ' >>',\n    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',\n    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',\n  ];\n  pageStreams.forEach((stream, i) => {\n    const pageId = 5 + i * 2, streamId = pageId + 1;\n    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + streamId + ' 0 R >>');\n    objects.push('<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream');\n  });\n  let pdf = '%PDF-1.4\\n';\n  const offsets = [0];\n  objects.forEach((object, i) => {\n    offsets.push(pdf.length);\n    pdf += (i + 1) + ' 0 obj\\n' + object + '\\nendobj\\n';\n  });\n  const xref = pdf.length;\n  pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n';\n  offsets.slice(1).forEach((offset) => { pdf += String(offset).padStart(10, '0') + ' 00000 n \\n'; });\n  pdf += 'trailer\\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF';\n  const bytes = Uint8Array.from(pdf, (char) => char.charCodeAt(0));\n  const blob = new Blob([bytes], { type: 'application/pdf' });\n  const url = URL.createObjectURL(blob);\n  const anchor = document.createElement('a');\n  const slug = String(team.name || 'squadra').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'squadra';\n  anchor.href = url;\n  anchor.download = 'calendario-' + slug + '.pdf';\n  document.body.append(anchor);\n  anchor.click();\n  anchor.remove();\n  setTimeout(() => URL.revokeObjectURL(url), 1000);\n}\n\nfunction rowHTML(g, newDay = false) {\n  const t = state.teams.find((t) => t.id === g.team_id) || {},\n    cat = ((g.category || t.category || '').match(/\\bU\\s*\\d+/i)?.[0].replace(/\\s/g, '') || g.category || t.category || '').replace(/DIVISIONE/i, 'DIV.'),\n    longCat = cat.length > 5,\n    hasDate = !!g.date,\n    weekday = hasDate ? new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(\n      new Date(g.date + 'T12:00:00Z'),\n    ) : '',\n    day = weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : '',\n    dateLabel = hasDate ? day + ' ' + shortDate(g.date) : 'Data da definire',\n    timeLabel = g.time || 'Orario da definire',\n    score = g.played ? `<span class=\"score\">${esc(g.home_sets + '–' + g.away_sets)}</span>` : '',\n    who = [['referee', 'Arb'], ['scorer', 'Ref']]\n      .filter(([r]) => names(g, r))\n      .map(([r, l]) => l + ': ' + names(g, r))\n      .join(' · '),\n    whoHtml = who ? '<small class=\"who\">' + esc(who) + '</small>' : '',\n    booked = myBooking(g),\n    staffColor = booked ? '' : myStaffColor(g, t),\n    mark = (r, label) => `<span class=\"mark\">${dot(g, r)}<small>${label}</small></span>`,\n    seats = g.is_home\n      ? `<span class=\"seats\">${mark('referee', 'Arb')}${mark('scorer', 'Ref')}</span>`\n      : '<span class=\"seats\"><span class=\"tag-away\">Trasferta</span></span>';\n  return `<article class=\"fixture${g.is_home ? '' : ' away'}${newDay ? ' new-day' : ''}${booked ? ' my-booking' : staffColor}\" data-game-key=\"${esc(g.game_key)}\"><div class=\"mobile\"><span class=\"identity\"><span class=\"cat${longCat ? ' cat--long' : ''}\">${esc(cat)}</span><span class=\"source\">${esc(g.source)}</span><span class=\"short\">${esc(t.short_name || g.our_team_name)}</span></span><span class=\"when\"><b>${esc(dateLabel)}</b><em>${esc(timeLabel)}</em></span><span class=\"teams\" title=\"${esc(g.home_team + ' – ' + g.away_team)}\"><span class=\"t${g.is_home ? ' us' : ''}\">${esc(g.home_team)}</span> – <span class=\"t${g.is_home ? '' : ' us'}\">${esc(g.away_team)}</span>${score}${whoHtml}</span>${seats}</div><button class=\"open-game\" data-open=\"${esc(g.game_key)}\" aria-label=\"Apri la scheda: ${esc(g.home_team)} – ${esc(g.away_team)}\"></button></article>`;\n}\nfunction modal(title, html) {\n  $('#dialog-title').textContent = title;\n  $('#dialog-content').innerHTML = html;\n  notice('', true);\n  if (!$('#dialog').open) $('#dialog').showModal();\n}\nconst card = (title, main, detail = '') =>\n  `<div class=\"card\"><h3>${esc(title)}</h3><p>${esc(main)}</p><small>${esc(detail)}</small></div>`;\nfunction field(label, name, value = '', type = 'text', required = false) {\n  return `<label class=\"field\">${esc(label)}<input name=\"${esc(name)}\" type=\"${type}\" value=\"${esc(value)}\" ${required ? 'required' : ''} ${type === 'password' ? 'minlength=\"12\" maxlength=\"256\" autocomplete=\"current-password\"' : ''}></label>`;\n}\nconst select = (label, name, options, value = '') =>\n  `<label class=\"field\">${esc(label)}<select name=\"${name}\">${options.map(([v, l]) => `<option value=\"${esc(v)}\" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;\nconst check = (label, name, on = false) =>\n  `<label><input type=\"checkbox\" name=\"${name}\" ${on ? 'checked' : ''}> ${esc(label)}</label>`;\nconst codeField = (label, name) =>\n  `<label class=\"field\">${esc(label)}<input name=\"${esc(name)}\" type=\"password\" minlength=\"4\" maxlength=\"4\" pattern=\"[A-Za-z0-9]{4}\" autocomplete=\"off\" autocapitalize=\"off\" required></label>`;\n// Ricorda solo se questo dispositivo ha già completato un accesso personale.\n// Non vengono mai salvati nome, cognome o codice personale.\nconst personalAccessMarker = 'volley-control-registrato-v1';\nlet registeredOnThisDevice = false;\nfunction hasRegisteredOnThisDevice() {\n  if (registeredOnThisDevice) return true;\n  try { return localStorage.getItem(personalAccessMarker) === '1'; } catch { return false; }\n}\nfunction rememberRegisteredOnThisDevice() {\n  registeredOnThisDevice = true;\n  try { localStorage.setItem(personalAccessMarker, '1'); } catch { /* Memoria locale non disponibile. */ }\n}\nfunction access(admin = false, view = '') {\n  const names = field('Nome', 'first_name', '', 'text', true) +\n    field('Cognome', 'last_name', '', 'text', true);\n  if (admin) {\n    const credentials = state.patty_pin_set\n      ? codeField('Codice PATTY (4 caratteri)', 'password')\n      : field('Password PATTY attuale', 'password', '', 'password', true);\n    modal('PATTY · Accesso organizzatore',\n      `<form data-form=\"login\" data-admin=\"true\">${credentials}<button class=\"primary\">Accedi</button></form>`);\n    return;\n  }\n  const showRegister = state.registration_enabled &&\n    (view === 'register' || (view !== 'login' && !hasRegisteredOnThisDevice()));\n  if (showRegister) {\n    modal('Prima registrazione',\n      `<p class=\"notice\">Inserisci nome, cognome e un codice personale di 4 caratteri, con lettere o numeri. Conserva il codice per i prossimi accessi.</p>\n      <form data-form=\"register\">${names}${codeField('Codice di 4 caratteri', 'password')}\n      <p class=\"notice\">Seleziona almeno un ruolo. Puoi sceglierne più di uno: basta un solo account.</p>\n      <div class=\"checks\">${check('Arbitro', 'wants_referee')}${check('Refertista', 'wants_scorer')}${check('Dirigente', 'wants_manager')}${check('Allenatore', 'wants_coach')}</div>\n      <div class=\"actions\"><button class=\"primary\">Registrati ed entra</button></div></form>\n      <p class=\"access-switch\">Sei già registrato? <button type=\"button\" data-access-view=\"login\">Accedi</button></p>`);\n    return;\n  }\n  modal('Area personale · Accesso',\n    `<form data-form=\"login\" data-admin=\"false\">${names}${codeField('Codice personale (4 caratteri)', 'password')}\n    <button class=\"primary\">Accedi</button></form>${!state.registration_enabled\n      ? '<p class=\"notice\">Registrazioni non ancora aperte in questo ambiente.</p>'\n      : !hasRegisteredOnThisDevice()\n        ? '<p class=\"access-switch\">È la prima volta? <button type=\"button\" data-access-view=\"register\">Registrati</button></p>'\n        : ''}`);\n}\nfunction resultCard(g) {\n  const partials = (g.sets || []).map((s, i) =>\n    ((s.number || i + 1) === 6 ? 'Golden set' : (s.number || i + 1) + '° set') +\n    ' ' + s.home + '–' + s.away).join(' · ');\n  if (!state.user?.admin)\n    return card('Risultato', g.played ? g.home_sets + ' – ' + g.away_sets : 'Non ancora disponibile', partials);\n  const scoreInput = (name, value, label, max, required = false) =>\n    `<input aria-label=\"${esc(label)}\" name=\"${name}\" type=\"number\" min=\"0\" max=\"${max}\" step=\"1\" inputmode=\"numeric\" value=\"${esc(value ?? '')}\" ${required ? 'required' : ''} style=\"width:100%;min-width:0;box-sizing:border-box\">`;\n  return `<section class=\"card\"><h3>Risultato</h3><form data-form=\"result\" data-key=\"${esc(g.game_key)}\">\n    <table style=\"width:100%;table-layout:fixed\"><thead><tr><th style=\"width:28%\"></th><th scope=\"col\" style=\"overflow-wrap:anywhere\">Casa<br>${esc(g.home_team)}</th><th scope=\"col\" style=\"overflow-wrap:anywhere\">Ospite<br>${esc(g.away_team)}</th></tr></thead><tbody>\n    <tr><th scope=\"row\">Finale</th><td>${scoreInput('home_sets', g.home_sets, 'Set vinti casa', 6, true)}</td><td>${scoreInput('away_sets', g.away_sets, 'Set vinti ospite', 6, true)}</td></tr>\n    ${Array.from({ length: 6 }, (_, i) => {\n      const n = i + 1, s = (g.sets || []).find((s, j) => (s.number || j + 1) === n);\n      const label = n === 6 ? 'Golden set' : n + '° set';\n      return `<tr><th scope=\"row\">${label}</th><td>${scoreInput('set_' + n + '_home', s?.home, label + ' casa', 100)}</td><td>${scoreInput('set_' + n + '_away', s?.away, label + ' ospite', 100)}</td></tr>`;\n    }).join('')}</tbody></table>\n    <p class=\"notice\">Finale: set vinti da casa e ospite. Compila i parziali disponibili e lascia vuoti i set non giocati. Il Golden set resta separato dal finale.</p>\n    <button class=\"primary\">Salva risultato</button>\n  </form></section>`;\n}\nfunction resultPatch(values) {\n  const integer = (value, max) => {\n    if (!/^\\d+$/.test(String(value ?? '')) || Number(value) > max)\n      throw new Error('Inserisci numeri interi da 0 a ' + max + '.');\n    return Number(value);\n  };\n  const patch = { home_sets: integer(values.home_sets, 6), away_sets: integer(values.away_sets, 6), played: true, sets: [] };\n  let gap = false;\n  for (let n = 1; n <= 6; n++) {\n    const home = values['set_' + n + '_home'] ?? '', away = values['set_' + n + '_away'] ?? '';\n    if (home === '' && away === '') { if (n < 6) gap = true; continue; }\n    if (home === '' || away === '') throw new Error('Completa entrambi i punteggi del ' + (n === 6 ? 'Golden set' : n + '° set') + '.');\n    if (n < 6 && gap) throw new Error('Compila i parziali in ordine, senza saltare set.');\n    const s = { home: integer(home, 100), away: integer(away, 100) };\n    if (s.home === s.away) throw new Error('Un set concluso non può finire in parità.');\n    if (n === 6) s.number = 6;\n    patch.sets.push(s);\n  }\n  return patch;\n}\nasync function showGame(key) {\n  const g =\n    state.games.find((x) => x.game_key === key) ||\n    state.admin?.games.find((x) => x.game_key === key);\n  if (!g) return;\n  currentGame = key;\n  const t = state.teams.find((x) => x.id === g.team_id) || {};\n  let seats = '';\n  if (g.is_home) {\n    for (const [r, label] of Object.entries(ROLES))\n      for (let slot = 1; slot <= Math.max(required(g, r), federal(g, r) ? 1 : 0); slot++) {\n        const a = assigned(g).find((a) => a.role === r && a.slot === slot);\n        const data = `data-game=\"${esc(key)}\" data-role=\"${r}\" data-slot=\"${slot}\"`;\n        const isFederal = federal(g, r);\n        const allowed = state.user && !state.user.admin && !!state.user['wants_' + r] && !g.source_missing && !isFederal;\n        const patty = !!state.user?.admin;\n        const eligible = patty\n          ? (state.admin?.people || []).filter((p) => p.approved && p['wants_' + r])\n          : [];\n        const pattyBooking = `<div class=\"patty-seat-book\">${select('Seleziona ' + (r === 'referee' ? 'arbitro' : 'refertista'), 'person_id', [['', 'Scegli una persona'], ...eligible.map((p) => [p.id, p.first_name + ' ' + p.last_name])])}<button type=\"button\" data-admin-book ${data} ${eligible.length && !g.source_missing ? '' : 'disabled'}>${eligible.length ? 'Prenota' : 'Nessuna persona disponibile'}</button></div>`;\n        const currentAction = isFederal\n          ? (patty ? '<small class=\"notice\">Modifica la designazione federale qui sotto.</small>' : '')\n          : a\n            ? (patty || (state.user?.id === a.person_id && a.source === 'self')\n                ? `<button type=\"button\" data-cancel ${data}>${patty ? 'Togli prenotazione' : 'Annulla la mia prenotazione'}</button>`\n                : '')\n            : patty\n              ? pattyBooking\n              : state.user && !state.user.admin && !state.user['wants_' + r]\n                ? '<small class=\"notice\">Non abilitato a questo ruolo</small>'\n                : `<button type=\"button\" data-book ${data} ${allowed ? '' : 'disabled'} title=\"${allowed ? 'Prenota questo incarico' : 'Accedi dall’area personale per prenotarti'}\">${allowed ? (r === 'referee' ? 'Arbitro io' : 'Referto io') : 'Accedi per prenotarti'}</button>`;\n        seats += `<div class=\"seat\"><span>${dot(g, r)} <b>${label}${required(g, r) > 1 ? ' ' + slot : ''}:</b> ${isFederal ? (r === 'referee' ? 'Arbitro federale' : 'Refertista federale') : a ? esc(a.first_name + ' ' + a.last_name) : 'Posto libero'}</span>${currentAction}</div>`;\n      }\n  }\n  const addrParts = [g.venue, ...String(g.address || '').split(/\\s+-\\s+/)].map((x) => (x || '').trim()).filter(Boolean).slice(0, 3);\n  const mapsLink = addrParts.length\n    ? `<a class=\"maps pin\" href=\"https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((g.venue || '') + ' ' + (g.address || ''))}\" target=\"_blank\" rel=\"noopener\" aria-label=\"Apri in Google Maps\" title=\"Apri in Google Maps\"><svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.5\"/></svg></a>`\n    : '';\n  const placeBlock = `<div class=\"place\"><div class=\"place-text\"><h3>Palestra e indirizzo</h3>${addrParts.map((x, i) => `<p class=\"${i ? 'addr' : 'venue'}\">${esc(x)}</p>`).join('') || '<p class=\"venue\">Da inserire</p>'}</div>${mapsLink}</div>`;\n  const staffLine = (label, value) => `<div class=\"staff-line\"><small>${esc(label)}</small><p>${esc(value || '—')}</p></div>`;\n  const staff = g.staff_override || t;\n  const managers = String(staff.managers || '').split(/\\n+/).map((x) => x.trim()).filter(Boolean);\n  // Per PATTY lo staff già presente è direttamente modificabile, senza pannelli extra.\n  const staffBlock = state.user?.admin\n    ? `<div class=\"staff\"><h3>Staff squadra${g.staff_override ? ' · Solo questa partita' : ''}</h3>\n      <form class=\"staff-inline-form\" data-form=\"game-staff\" data-key=\"${esc(key)}\">\n        <label class=\"staff-inline-row\"><span>Allenatore</span><input type=\"text\" name=\"coach1\" value=\"${esc(staff.coach1 || '')}\" placeholder=\"Da inserire\" maxlength=\"1000\"></label>\n        <label class=\"staff-inline-row\"><span>Secondo allenatore</span><input type=\"text\" name=\"coach2\" value=\"${esc(staff.coach2 || '')}\" placeholder=\"Da inserire\" maxlength=\"1000\"></label>\n        <label class=\"staff-inline-row\"><span>Dirigenti</span><textarea name=\"managers\" rows=\"2\" maxlength=\"1000\" placeholder=\"Da inserire · uno per riga\">${esc(staff.managers || '')}</textarea></label>\n        <input type=\"hidden\" name=\"scope\" value=\"match\">\n        <div class=\"staff-inline-save\">\n          <button type=\"submit\" class=\"primary\" data-staff-scope=\"match\">Solo questa volta</button>\n          <button type=\"submit\" data-staff-scope=\"permanent\">Per sempre</button>\n        </div>\n        ${g.staff_override ? `<button type=\"button\" class=\"staff-reset\" data-staff-reset data-game=\"${esc(key)}\">Ripristina lo staff della squadra</button>` : ''}\n      </form></div>`\n    : `<div class=\"staff\"><h3>Staff squadra</h3>${staffLine('Allenatore', staff.coach1 || 'Da inserire')}${staffLine('Secondo allenatore', staff.coach2)}${managers.length ? managers.map((m, i) => staffLine(i ? '' : managers.length > 1 ? 'Dirigenti' : 'Dirigente', m)).join('') : staffLine('Dirigenti', 'Da inserire')}</div>`;\n  let html = `<div class=\"sheet-hero\">${esc(g.date ? shortDate(g.date) + '/' + g.date.slice(0, 4) : 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(g.category)} · ${esc(g.source)}<strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></div>${g.is_home ? '<h3>Prenotazioni · Gare in casa</h3>' + seats : '<p class=\"notice\">Trasferta: non sono richiesti arbitro e refertista interni.</p>'}<div class=\"strip\"><span>Gara <b>${esc(g.game_number || 'n. non presente')}</b></span><span class=\"pill ${g.is_home ? 'home' : 'away'}\">${g.is_home ? 'Casa' : 'Trasferta'}</span><span>${esc(g.source)}</span></div>${placeBlock}${staffBlock}${resultCard(g)}${g.notes ? card('Note', g.notes) : ''}`;\n  if (state.user?.admin) {\n    // Ogni correzione di una singola partita avviene nella sua scheda.\n    // Una gara incompleta deve ricevere data e ora insieme, senza duplicare moduli altrove.\n    if (!g.date || !g.time) {\n      html += `<section class=\"card\"><h3>PATTY · Completa data e ora</h3>\n        <form data-form=\"pending\" data-key=\"${esc(key)}\">\n          <div class=\"grid\">${field('Data confermata', 'date', g.date || '', 'date', true)}${field('Ora confermata', 'time', g.time || '', 'time', true)}</div>\n          ${field('Motivo / riferimento', 'reason')}\n          <button class=\"primary\">Salva data e ora della partita</button>\n        </form></section>`;\n    }\n    if (g.is_home) {\n      html += `<section class=\"card\"><h3>PATTY · Designazione federale</h3><form data-form=\"federal\" data-key=\"${esc(key)}\"><div class=\"actions\">${check('Arbitro federale', 'federal_referee', federal(g, 'referee'))}${check('Refertista federale', 'federal_scorer', federal(g, 'scorer'))}</div><p class=\"notice\">Federale: posto coperto e non prenotabile. Se già occupato, rimuovi prima l’incarico.</p><button class=\"primary\">Salva scelta federali</button></form></section>`;\n      const fixedPeople = (state.admin?.people || [])\n        .filter((p) => p.approved && (p.wants_referee || p.wants_scorer))\n        .map((p) => [p.id, p.first_name + ' ' + p.last_name]);\n      html += `<details><summary>PATTY · Incarico fisso</summary><form data-form=\"fixed-sheet\" data-key=\"${esc(key)}\" data-team=\"${esc(g.team_id)}\">${select('Ruolo', 'role', [['referee', 'Arbitro'], ['scorer', 'Refertista']])}${select('Persona', 'person_id', [['', 'Scegli una persona'], ...fixedPeople])}<p class=\"notice\">Puoi applicare la scelta solo a questa partita oppure a tutte le prossime partite della squadra.</p>${select('Durata', 'scope', [['match', 'Solo questa partita'], ['future', 'Tutte le prossime partite della squadra']])}<button class=\"primary\">Salva incarico</button></form></details>`;\n    }\n    html += `<details><summary>PATTY · Cambia casa / trasferta</summary>\n      <form data-form=\"flip-home\" data-key=\"${esc(key)}\" data-is-home=\"${g.is_home ? '1' : '0'}\">\n        <p class=\"notice\">Stato attuale: <strong>${g.is_home ? 'CASA' : 'TRASFERTA'}</strong>. Il comando invertirà i nomi delle due squadre e aggiornerà il banner della gara nell’elenco. Data, ora e palestra non cambiano.</p>\n        <p class=\"notice\">Le prenotazioni esistenti sono protette: passando in trasferta, eventuali arbitri o refertisti già assegnati devono essere rimossi prima.</p>\n        <button type=\"submit\" class=\"primary\">Passa a ${g.is_home ? 'TRASFERTA' : 'CASA'}</button>\n      </form></details>`;\n    html += `<details><summary>PATTY · Correggi dato</summary><form data-form=\"game-edit\" data-key=\"${esc(key)}\">${select(\n      'Campo',\n      'field',\n      Object.entries(FIELDS)\n        .filter(([k]) => (g.date && g.time) || !['date', 'time'].includes(k))\n        .map(([k, v]) => [k, v]),\n    )}${field('Nuovo valore', 'value')}${field('Motivo / riferimento', 'reason')}<button>Salva modifica</button></form></details>`;\n    const conflicts = state.admin.conflicts.filter((c) => c.game_key === key);\n    html += conflicts.length\n      ? '<details open><summary>Dati ufficiali diversi / conflitti da verificare</summary>' +\n        conflicts\n          .map(\n            (c) =>\n              `<p class=\"notice\">${esc(FIELDS[c.field] || c.field)}: ${esc(c.incoming)}</p>${FIELDS[c.field] ? `<button data-reset=\"${esc(c.field)}\" data-game=\"${esc(key)}\">Usa valore ufficiale</button>` : ''}`,\n          )\n          .join('') +\n        '</details>'\n      : '';\n    html +=\n      '<details><summary>Storico modifiche</summary><div id=\"history\">Caricamento…</div></details>';\n  }\n  modal('Scheda partita', html);\n  if (state.user?.admin) {\n    const history = await api('admin/audit?game_key=' + encodeURIComponent(key));\n    if (currentGame === key && $('#history'))\n      $('#history').innerHTML =\n        history.audit.map(auditCard)\n          .join('') || 'Nessuna modifica manuale.';\n  }\n}\nfunction auditActorName(actor) {\n  const value = String(actor || '');\n  if (value === 'PATTY') return 'PATTY';\n  if (value.startsWith('PATTY-DELEGATO:')) {\n    const bar = value.indexOf('|');\n    if (bar !== -1) return value.slice(bar + 1);\n    const id = value.slice('PATTY-DELEGATO:'.length);\n    const user = state.admin?.people?.find((p) => p.id === id);\n    return user ? user.first_name + ' ' + user.last_name : 'Collaboratore PATTY';\n  }\n  const user = state.admin?.people?.find((p) => p.id === value);\n  return user ? user.first_name + ' ' + user.last_name : ({\n    sync: 'Aggiornamento automatico',\n    system: 'Sistema',\n    'PATTY-AUTO': 'Assegnazione automatica',\n  }[value] || value);\n}\nfunction auditDescription(record) {\n  let details = {};\n  try { details = JSON.parse(record.details || '{}'); } catch {}\n  const labels = {\n    game_modified: 'Partita modificata',\n    booking_request: 'Prenotazione inserita',\n    cancelled: 'Prenotazione rimossa',\n    team_saved: 'Squadra modificata',\n    roster_staff_changed: 'Staff squadra modificato',\n    team_staff_permanent: 'Staff aggiornato per tutte le gare',\n    roster_linked: 'Calendario squadra collegato',\n    fixed_changed: 'Incarico fisso modificato',\n    fixed_applied: 'Incarico fisso applicato',\n    patty_delegate_granted: 'Accesso PATTY autorizzato',\n    patty_delegate_revoked: 'Accesso PATTY revocato',\n    person_deleted: 'Account eliminato',\n    person_roles_updated: 'Ruoli persona modificati',\n    patty_pin_changed: 'Codice PATTY modificato',\n    calendar_sync_started: 'Aggiornamento calendari avviato',\n    source_updated: 'Dati ufficiali aggiornati',\n    assigned: 'Prenotazione registrata',\n    assignment_removed: 'Prenotazione cancellata',\n  };\n  const base = labels[record.action] || record.action;\n  let suffix = '';\n  if (record.action === 'game_modified' && details.reason) suffix = ' · ' + String(details.reason);\n  if ((record.action === 'person_deleted' || record.action === 'person_roles_updated') && details.name) suffix = ' · ' + details.name;\n  if (record.action === 'calendar_sync_started' && details.scope)\n    suffix = ' · ' + details.scope + (details.results_only ? ' (risultati)' : '');\n  if (record.action === 'booking_request' && details.role)\n    suffix = ' · ' + (details.role === 'scorer' ? 'Refertista' : 'Arbitro');\n  return base + suffix;\n}\nfunction auditCard(record) {\n  const date = new Date(record.changed_at);\n  const time = isNaN(date.valueOf()) ? String(record.changed_at) :\n    date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });\n  const game = record.game_key ? ' · Gara ' + String(record.game_key).slice(-32) : '';\n  return '<p class=\"notice\"><b>' + esc(time) + '</b> · ' +\n    esc(auditActorName(record.actor)) + ' · ' +\n    esc(auditDescription(record)) + esc(game) + '</p>';\n}\n\nfunction teamForm(t = {}) {\n  return `<form data-form=\"team\" data-id=\"${esc(t.id || '')}\"><div class=\"grid\">${select(\n    'Comitato',\n    'source',\n    [\n      ['FIPAV', 'FIPAV'],\n      ['PGS', 'PGS'],\n    ],\n    t.source || 'FIPAV',\n  )}${field('Stagione', 'season', t.season || '2026-2027', 'text', true)}${field('ID ufficiale squadra', 'official_team_id', t.official_team_id || '', 'text', true)}${field('Girone FIPAV / PGS', 'group_id', t.group_id || '')}${field('Codice campionato PGS', 'competition', t.competition || '')}${field('Nome ufficiale', 'name', t.name || '', 'text', true)}${field('Categoria', 'category', t.category || '', 'text', true)}${field('Nome breve smartphone', 'short_name', t.short_name || '', 'text', true)}${field('Primo allenatore', 'coach1', t.coach1 || '')}${field('Secondo allenatore', 'coach2', t.coach2 || '')}</div><label class=\"field\">Dirigenti (uno per riga)<textarea name=\"managers\">${esc(t.managers || '')}</textarea></label>${check('Squadra attiva per gli aggiornamenti', 'active', t.active !== 0)}<div class=\"actions\"><button>Salva scheda squadra</button></div></form>`;\n}\n\nfunction renderAdmin() {\n  const a = state.admin;\n  if (!a) return;\n  const pending = a.games.filter((g) => !g.date || !g.time);\n  const wasOpen = !!document.querySelector('#admin .patty-panel[open]');\n  const P = {};\n  P.sync = `<div class=\"actions\"><button data-sync=\"calendar\" class=\"primary\">↻ Aggiorna tutti i calendari</button><button data-sync=\"results\">↻ Aggiorna tutti i risultati</button></div><p class=\"notice\">Aggiorna tutte le squadre attive. Le gare non vengono duplicate; le correzioni manuali e le prenotazioni sono conservate.</p>`;\n  P.pin = !state.user?.id ? `<details><summary>Codice PATTY · 4 caratteri ${state.patty_pin_set ? '(attivo)' : '(da impostare)'}</summary><p class=\"notice\">Salva il codice: al prossimo accesso sostituirà la password precedente.</p><form data-form=\"patty-pin\">${codeField('Nuovo codice PATTY', 'pin')}${codeField('Ripeti il codice', 'confirm')}<button>Salva codice PATTY</button></form></details>` : '';\n  P.pending = `<details><summary>🔵 Gare con dati primari incompleti (${pending.length})</summary>${pending.map((g) => `<div class=\"card\"><p>${esc(g.category)} · ${esc(g.source)} · Gara ${esc(g.game_number)}</p><small>${esc(g.home_team)} – ${esc(g.away_team)}</small><button type=\"button\" data-open=\"${esc(g.game_key)}\">Apri scheda partita</button></div>`).join('') || '<p>Nessuna gara incompleta.</p>'}</details>`;\n  const delegateCount = a.people.filter((p) => p.can_access_patty).length;\n  P.people =\n    '<details><summary>Persone registrate (' + a.people.length + ')</summary><p class=\"notice\">Qui puoi aggiornare i ruoli di ogni persona senza cambiare il suo account o le prenotazioni.</p>' +\n    (!state.user?.id ? '<p class=\"notice\">Accessi PATTY aggiuntivi: ' + delegateCount + '/2. Solo PATTY può autorizzare o revocare gli accessi, senza comunicare il proprio codice.</p>' : '') +\n    ((a.people.map((p) => {\n      const roles = [\n        ['wants_referee', 'Arbitro'], ['wants_scorer', 'Refertista'],\n        ['wants_manager', 'Dirigente'], ['wants_coach', 'Allenatore']\n      ].filter(([key]) => p[key]).map(([, label]) => label).join(', ') || 'Nessun ruolo';\n      const action = !state.user?.id ?\n        '<button type=\"button\" data-patty-delegate=\"' + esc(p.id) + '\" data-allowed=\"' +\n        (p.can_access_patty ? 'false' : 'true') + '\"' +\n        (!p.can_access_patty && (!p.approved || delegateCount >= 2) ? ' disabled' : '') +\n        '>' + (p.can_access_patty ? 'Revoca accesso PATTY' : 'Autorizza accesso PATTY') + '</button>' : '';\n      return '<div class=\"person\"><b>' + esc(p.first_name + ' ' + p.last_name) + '</b>' +\n        '<p class=\"notice\">' + esc(roles) + (p.can_access_patty ? ' · Accesso PATTY autorizzato' : '') + '</p>' +\n        '<button type=\"button\" data-person-roles=\"' + esc(p.id) + '\">Modifica ruoli</button> ' +\n        '<button type=\"button\" data-person-delete=\"' + esc(p.id) + '\">Elimina account</button>' +\n        action + '</div>';\n    }).join('')) || '<p>Nessuna persona registrata.</p>') + '</details>';\n  const roster=a.roster||[];\n  P.roster = '<details><summary>Archivio 21 squadre · ' + roster.filter(x=>x.linked_team_id).length +\n    ' collegate</summary><p class=\"notice\">Solo le squadre collegate a un identificativo ufficiale partecipano agli aggiornamenti. Le modifiche agli allenatori e dirigenti si propagano a tutte le partite della squadra.</p>' +\n    '<p><button type=\"button\" data-roster-pgs>Trova e collega le squadre PGS</button></p>' +\n    roster.map(r=>`<details class=\"card\"><summary>${r.id}. ${esc(r.category)} ${esc(r.source)} · ${esc(r.name)} · ${manualCalendarOnly(r)?'Gestione manuale':r.linked_team_id?'Collegata':'Da collegare'}</summary>\n      ${manualCalendarOnly(r)?'<p class=\"notice\">Calendario e risultati inseriti manualmente da PATTY.</p>':r.linked_team_id?`<p class=\"notice\">Nome ufficiale: ${esc(r.official_name)} · ${esc(r.official_group||'')}</p>`:'<p class=\"notice\">Identificativo ufficiale ancora da verificare.</p>'}\n      <form data-form=\"roster-staff\" data-id=\"${r.id}\">\n        <div class=\"grid\">${field('Allenatore 1','coach1',r.coach1)}${field('Allenatore 2','coach2',r.coach2)}</div>\n        <label class=\"field\">Dirigenti<textarea name=\"managers\">${esc(r.managers)}</textarea></label><button>Salva staff</button>\n      </form>\n      ${!manualCalendarOnly(r)&&!r.linked_team_id&&r.source==='FIPAV'?`<form data-form=\"roster-fipav\" data-id=\"${r.id}\">${field('Codice girone FIPAV','group_id','','text',true)}<button>Verifica e collega il calendario</button></form>`:''}\n    </details>`).join('')+'</details>';\n  P.teams =\n    '<details><summary>Squadre · Staff · Nomi brevi · Incarichi FISSI</summary>' +\n    a.teams\n      .map(\n        (t) =>\n          `<details><summary>${esc(t.category + ' · ' + t.source + ' · ' + t.name)}</summary>${teamForm(t)}${Object.entries(\n            ROLES,\n          )\n            .map(\n              ([r, label]) =>\n                `<form data-form=\"fixed\" data-team=\"${esc(t.id)}\" data-role=\"${r}\">${select(label + ' FISSO', 'person_id', [['', 'Nessuno'], ...a.people.filter((p) => p.approved && p['wants_' + r]).map((p) => [p.id, p.first_name + ' ' + p.last_name])], a.fixed.find((f) => f.team_id === t.id && f.role === r)?.person_id || '')}<button>Salva incarico fisso</button></form>`,\n            )\n            .join('')}</details>`,\n      )\n      .join('') +\n    '<details><summary>Aggiungi squadra</summary>' +\n    teamForm() +\n    '</details></details>';\n  P.activity = '<details><summary>Registro modifiche · riservato PATTY</summary>' +\n    '<p class=\"notice\">Mostra chi ha effettuato le modifiche, con data e ora. Visibile solo a PATTY e ai due collaboratori autorizzati.</p>' +\n    '<button type=\"button\" data-activity-load>Mostra ultime modifiche</button>' +\n    '<div id=\"patty-activity\"></div></details>';\n  P.manual = `<details><summary>Inserimento manuale di una gara</summary><form data-form=\"manual\">${select(\n    'Squadra',\n    'team_id',\n    a.teams.map((t) => [t.id, t.category + ' · ' + t.name]),\n  )}${field('Avversaria', 'opponent', '', 'text', true)}${check('Gara in casa', 'is_home', true)}<div class=\"grid\">${field('Data', 'date', '', 'date', true)}${field('Ora', 'time', '', 'time', true)}</div>${field('Palestra', 'venue')}${field('Indirizzo', 'address')}${field('Numero gara', 'game_number')}<button>Salva gara manuale</button></form></details>`;\n  const badge = pending.length\n    ? `<span class=\"badge warn\">${pending.length} ${pending.length === 1 ? 'gara' : 'gare'} da completare</span>`\n    : '<span class=\"badge\">Tutto in ordine</span>';\n  $('#admin').innerHTML = `<details class=\"patty-panel\" ${wasOpen ? 'open' : ''}><summary><span>Strumenti PATTY</span>${badge}</summary><div class=\"patty-body\"><h2>PATTY · Comandi riservati</h2><section class=\"pgroup\"><h3>Aggiornare</h3>${P.sync}</section><section class=\"pgroup\"><h3>Gare</h3>${P.pending}${P.manual}</section><section class=\"pgroup\"><h3>Squadre e persone</h3>${P.roster}${P.teams}${P.people}</section><section class=\"pgroup\"><h3>Sistema</h3>${P.pin}${P.activity}</section></div></details>`;\n}\nasync function syncAll(resultsOnly) {\n  const scopes = [\n    ...new Set(\n      state.teams\n        .filter((t) => t.active && !manualCalendarOnly(t))\n        .map((t) =>\n          [t.source, t.season, t.source === 'FIPAV' ? t.group_id : t.competition].join(':'),\n        ),\n    ),\n  ];\n  let failures = 0;\n  const buttons = [...document.querySelectorAll('[data-sync]')];\n  buttons.forEach((b) => (b.disabled = true));\n  for (const scope of scopes) {\n    try {\n      // Un solo comando e un solo messaggio: nessun percorso differente\n      // o report per squadra è mostrato durante l'aggiornamento.\n      notice('Aggiornamento in corso…');\n      const job = await api('admin/sync', { scope, results_only: resultsOnly });\n      let step;\n      do {\n        step = await api('admin/sync/step', { job_id: job.job_id });\n      } while (!step.done);\n      if (step.report.errors.length || step.report.fixed_conflicts.length) failures++;\n    } catch (e) {\n      failures++;\n      console.error('Aggiornamento calendario non riuscito:', scope, e);\n    }\n  }\n  await load();\n  notice(failures\n    ? 'Aggiornamento parziale: alcuni calendari richiedono una verifica.'\n    : 'Aggiornamento completato.');\n}\nfunction formData(f) {\n  return Object.fromEntries(new FormData(f));\n}\nasync function submit(f) {\n  const kind = f.dataset.form,\n    b = formData(f);\n  switch (kind) {\n    case 'login':\n      await api('auth/login', { ...b, admin: f.dataset.admin === 'true' });\n      if (f.dataset.admin !== 'true') rememberRegisteredOnThisDevice();\n      $('#dialog').close();\n      await load();\n      return;\n    case 'register':\n      await api('auth/register', {\n        ...b,\n        wants_referee: !!b.wants_referee,\n        wants_scorer: !!b.wants_scorer,\n        wants_manager: !!b.wants_manager,\n        wants_coach: !!b.wants_coach,\n      });\n      rememberRegisteredOnThisDevice();\n      $('#dialog').close();\n      await load();\n      notice('Registrazione completata. Sei già connesso.');\n      return;\n    case 'person-roles': {\n      const payload = {\n        id: f.dataset.personId,\n        wants_referee: !!b.wants_referee,\n        wants_scorer: !!b.wants_scorer,\n        wants_manager: !!b.wants_manager,\n        wants_coach: !!b.wants_coach,\n      };\n      if (!Object.entries(payload).some(([key, value]) => key !== 'id' && value))\n        throw new Error('Seleziona almeno un ruolo.');\n      await api('admin/person/roles', payload);\n      $('#dialog').close();\n      await load();\n      notice('Ruoli aggiornati. Account e prenotazioni invariati.');\n      return;\n    }\n    case 'patty-pin':\n      await api('admin/pin', { pin: b.pin, confirm: b.confirm });\n      f.reset();\n      await load();\n      notice('Codice PATTY aggiornato. Usalo al prossimo accesso.');\n      return;\n    case 'pending': {\n      const r = await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: { date: b.date, time: b.time },\n        reason: b.reason,\n      });\n      state.week = weekOf(r.game.date);\n      break;\n    }\n    case 'federal': {\n      await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: {\n          federal_referee: !!b.federal_referee,\n          federal_scorer: !!b.federal_scorer,\n        },\n        reason: 'PATTY · Designazione federale',\n      });\n      break;\n    }\n    case 'result': {\n      await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: resultPatch(b),\n        reason: 'PATTY · Risultato e parziali',\n      });\n      break;\n    }\n    case 'flip-home': {\n      const g = state.games.find((x) => x.game_key === f.dataset.key) ||\n        state.admin?.games.find((x) => x.game_key === f.dataset.key);\n      if (!g) throw new Error('Partita non trovata. Ricarica la pagina.');\n      const wasHome = f.dataset.isHome === '1';\n      if (!!g.is_home !== wasHome) throw new Error('La partita è stata aggiornata. Riapri la scheda.');\n      if (!window.confirm(`Confermi il passaggio a ${wasHome ? 'TRASFERTA' : 'CASA'}?\\n\\n${g.away_team} – ${g.home_team}\\n\\nPalestra, data e ora restano invariati.`)) return;\n      const r = await api('admin/game/flip-home', {\n        game_key: f.dataset.key,\n        expected_is_home: wasHome,\n      });\n      if (r.game?.date) state.week = weekOf(r.game.date);\n      break;\n    }\n    case 'game-edit': {\n      let value = b.value;\n      if (['home_sets', 'away_sets', 'required_referees', 'required_scorers'].includes(b.field)) {\n        if (!/^\\d+$/.test(value)) throw new Error('Inserisci un numero intero.');\n        value = Number(value);\n      }\n      if (['hidden', 'played'].includes(b.field)) {\n        if (!['true', 'false'].includes(value)) throw new Error('Scrivi true oppure false.');\n        value = value === 'true';\n      }\n      if (b.field === 'sets') {\n        try {\n          value = JSON.parse(value);\n        } catch {\n          throw new Error('Parziali JSON non validi.');\n        }\n      }\n      const r = await api('admin/game', {\n        game_key: f.dataset.key,\n        patch: { [b.field]: value },\n        reason: b.reason,\n      });\n      if (r.game.date) state.week = weekOf(r.game.date);\n      break;\n    }\n    case 'game-staff':\n      await api('admin/game/staff', {\n        game_key: f.dataset.key,\n        scope: b.scope,\n        coach1: b.coach1 || '',\n        coach2: b.coach2 || '',\n        managers: b.managers || '',\n      });\n      break;\n    case 'roster-staff':\n      await api('admin/roster/staff',{id:Number(f.dataset.id),coach1:b.coach1,coach2:b.coach2,managers:b.managers});\n      break;\n    case 'roster-fipav':\n      await api('admin/roster/fipav-link',{id:Number(f.dataset.id),group_id:b.group_id});\n      break;\n    case 'team':\n      await api('admin/team', { ...b, id: f.dataset.id || undefined, active: !!b.active });\n      break;\n    case 'fixed': {\n      const r = await api('admin/fixed', {\n        team_id: f.dataset.team,\n        role: f.dataset.role,\n        person_id: b.person_id || null,\n      });\n      const conflicts = [];\n      for (const g of r.pending) {\n        const applied = await api('admin/fixed/apply', { game_key: g.game_key });\n        conflicts.push(...applied.conflicts);\n      }\n      if (conflicts.length) notice(conflicts.map((c) => c.error).join('; '));\n      break;\n    }\n    case 'assign':\n      await api('admin/assign', {\n        game_key: f.dataset.key,\n        role: b.role,\n        slot: Number(b.slot),\n        person_id: b.person_id,\n      });\n      break;\n    case 'fixed-sheet': {\n      if (!b.person_id) throw new Error('Seleziona una persona.');\n      if (b.scope === 'match') {\n        await api('admin/assign', {\n          game_key: f.dataset.key,\n          role: b.role,\n          slot: 1,\n          person_id: b.person_id,\n        });\n      } else {\n        const result = await api('admin/fixed', {\n          team_id: f.dataset.team,\n          role: b.role,\n          person_id: b.person_id,\n        });\n        for (const pending of result.pending || []) await api('admin/fixed/apply', { game_key: pending.game_key });\n      }\n      break;\n    }\n    case 'manual':\n      await api('admin/manual', {\n        team_id: b.team_id,\n        opponent: b.opponent,\n        is_home: !!b.is_home,\n        patch: {\n          date: b.date,\n          time: b.time,\n          venue: b.venue || 'Palestra non indicata',\n          address: b.address,\n          game_number: b.game_number || 'MANUALE',\n        },\n      });\n      state.week = weekOf(b.date);\n      break;\n    default:\n      return;\n  }\n  const reopen = $('#dialog').open && currentGame;\n  await load();\n  if (reopen) await showGame(currentGame);\n  notice('Salvato.', !!reopen);\n}\ndocument.addEventListener('submit', async (e) => {\n  if (!e.target.matches('form[data-form]')) return;\n  e.preventDefault();\n  const f = e.target;\n  if (f.dataset.form === 'game-staff' && e.submitter?.dataset.staffScope)\n    f.elements.namedItem('scope').value = e.submitter.dataset.staffScope;\n  const button = e.submitter || f.querySelector('button');\n  if (button) button.disabled = true;\n  try {\n    await submit(f);\n  } catch (error) {\n    notice(error.message, !!f.closest('dialog'));\n  } finally {\n    if (button) button.disabled = false;\n  }\n});\ndocument.addEventListener('change', (e) => {\n  if (e.target.id === 'team-select') {\n    selectedTeamId = e.target.value || '';\n    state.week = null;\n    render();\n    return;\n  }\n  if (e.target.id !== 'week-select') return;\n  selectedTeamId = '';\n  state.week = e.target.value || null;\n  render();\n});\ndocument.addEventListener('click', async (e) => {\n  const b = e.target.closest('button');\n  if (!b) return;\n  try {\n    if (b.dataset.accessView) {\n      access(false, b.dataset.accessView);\n    } else if (b.id === 'close-dialog') {\n      $('#dialog').close();\n      currentGame = null;\n    } else if (b.id === 'download-team-pdf') {\n      downloadTeamCalendarPdf();\n    } else if (b.id === 'home') {\n      selectedTeamId = '';\n      state.week = null;\n      render();\n    } else if (b.dataset.week) {\n      selectedTeamId = '';\n      state.week = b.dataset.week;\n      render();\n    } else if (b.id === 'access') {\n      if (state.user?.id) {\n        await api('auth/logout', {});\n        await load();\n      } else access(false);\n    } else if (b.id === 'patty') {\n      if (state.user?.admin) {\n        await api(state.user.id ? 'auth/patty-exit' : 'auth/logout', {});\n        await load();\n      } else if (state.user?.can_access_patty) {\n        await api('auth/patty-enter', {});\n        await load();\n      } else access(true);\n    } else if (b.dataset.open) await showGame(b.dataset.open);\n    else if (b.hasAttribute('data-book') || b.hasAttribute('data-admin-book') || b.hasAttribute('data-cancel')) {\n      const pattyBooking = b.hasAttribute('data-admin-book');\n      const booking = b.hasAttribute('data-book') || pattyBooking;\n      const selectedPerson = pattyBooking ? b.closest('.patty-seat-book')?.querySelector('select')?.value : '';\n      if (pattyBooking && (!state.user?.admin || !state.admin?.people.some((p) => p.id === selectedPerson && p.approved && p['wants_' + b.dataset.role])))\n        throw new Error('Seleziona una persona abilitata per questo incarico.');\n      const personName = pattyBooking ? state.admin.people.find((p) => p.id === selectedPerson) : null;\n      const g =\n        state.games.find((g) => g.game_key === b.dataset.game) ||\n        state.admin?.games.find((g) => g.game_key === b.dataset.game);\n      if (!g) throw new Error('Partita non trovata. Riapri la scheda.');\n      $('#action-confirmation')?.remove();\n      const panel = document.createElement('section');\n      panel.id = 'action-confirmation';\n      panel.className = 'action-confirmation';\n      panel.setAttribute('role', 'alertdialog');\n      panel.setAttribute('aria-labelledby', 'action-confirmation-title');\n      const message = pattyBooking\n        ? 'PATTY · Conferma prenotazione per ' + personName.first_name + ' ' + personName.last_name\n        : booking\n          ? 'Ti stai prenotando per questa partita'\n          : state.user?.admin\n            ? 'PATTY · Conferma rimozione della prenotazione'\n            : 'Stai annullando la tua prenotazione per questa partita';\n      const attrs = `data-game=\"${esc(b.dataset.game)}\" data-role=\"${esc(b.dataset.role)}\" data-slot=\"${esc(b.dataset.slot)}\" ${pattyBooking ? 'data-person=\"' + esc(selectedPerson) + '\"' : ''}`;\n      panel.innerHTML = `<h3 id=\"action-confirmation-title\">${esc(message)}</h3>\n        <p><strong>${esc(g.home_team)} – ${esc(g.away_team)}</strong></p>\n        <p>${esc(g.date || 'Data da definire')} · ${esc(g.time || 'Ora da definire')} · ${esc(ROLES[b.dataset.role] || 'Incarico')}</p>\n        <div class=\"actions\">\n          <button type=\"button\" class=\"primary\" data-confirm-action data-action=\"${pattyBooking ? 'admin/assign' : booking ? 'book' : 'cancel'}\" ${attrs}>Conferma</button>\n          <button type=\"button\" data-abort-action>Indietro</button>\n        </div>`;\n      $('#dialog-content').prepend(panel);\n      panel.querySelector('[data-confirm-action]').focus();\n    } else if (b.hasAttribute('data-abort-action')) {\n      $('#action-confirmation')?.remove();\n    } else if (b.hasAttribute('data-confirm-action')) {\n      b.disabled = true;\n      const payload = {\n        game_key: b.dataset.game,\n        role: b.dataset.role,\n        slot: Number(b.dataset.slot),\n      };\n      if (b.dataset.action === 'admin/assign') payload.person_id = b.dataset.person;\n      await api(b.dataset.action, payload);\n      await load();\n      await showGame(b.dataset.game);\n      notice(b.dataset.action === 'cancel' ? 'Prenotazione rimossa.' : 'Prenotazione confermata.', true);\n    } else if (b.hasAttribute('data-staff-reset')) {\n      if (!confirm('Ripristinare gli allenatori e i dirigenti della squadra per questa partita?')) return;\n      await api('admin/game/staff', { game_key: b.dataset.game, scope: 'reset' });\n      await load();\n      await showGame(b.dataset.game);\n      notice('Staff della squadra ripristinato.', true);\n    } else if (b.hasAttribute('data-roster-pgs')) {\n      b.disabled=true;\n      const result=await api('admin/roster/pgs-search',{});\n      await load();\n      notice('PGS: ' + result.linked.length + ' nuove squadre collegate; ' +\n        result.pending.length + ' ancora da verificare.' +\n        (result.pending.length ? ' ' + result.pending.map(x =>\n          x.name + ' (' + x.reason + ')').join('; ') : ''));\n    } else if (b.hasAttribute('data-activity-load')) {\n      b.disabled = true;\n      try {\n        const log = await api('admin/activity');\n        const output = $('#patty-activity');\n        if (output) output.innerHTML = log.activity.map(auditCard).join('') ||\n          '<p class=\"notice\">Nessuna modifica registrata.</p>';\n      } finally { b.disabled = false; }\n    } else if (b.hasAttribute('data-patty-delegate')) {\n      const allowed = b.dataset.allowed === 'true';\n      if (!confirm((allowed ? 'Autorizzare' : 'Revocare') + ' l’accesso PATTY a questa persona?')) return;\n      b.disabled = true;\n      await api('admin/delegate', { id: b.dataset.pattyDelegate, allowed });\n      await load();\n      notice(allowed ? 'Accesso PATTY autorizzato.' : 'Accesso PATTY revocato.');\n    } else if (b.hasAttribute('data-person-roles')) {\n      const p = state.admin?.people.find((x) => x.id === b.dataset.personRoles);\n      if (!state.user?.admin || !p)\n        throw new Error('Persona non trovata. Aggiorna la pagina.');\n      modal('Modifica ruoli · ' + p.first_name + ' ' + p.last_name,\n        '<form data-form=\"person-roles\" data-person-id=\"' + esc(p.id) + '\">' +\n        '<p class=\"notice\">Puoi selezionare più ruoli. Il codice personale e le prenotazioni rimangono invariati.</p>' +\n        '<div class=\"checks\">' +\n          check('Arbitro', 'wants_referee', !!p.wants_referee) +\n          check('Refertista', 'wants_scorer', !!p.wants_scorer) +\n          check('Dirigente', 'wants_manager', !!p.wants_manager) +\n          check('Allenatore', 'wants_coach', !!p.wants_coach) +\n        '</div><div class=\"actions\"><button type=\"submit\" class=\"primary\">Salva ruoli</button></div></form>');\n    } else if (b.hasAttribute('data-person-delete')) {\n      if (!confirm('Vuoi eliminare definitivamente questo account? Questa operazione non si può annullare.')) return;\n      b.disabled = true;\n      await api('admin/person', { id: b.dataset.personDelete, action: 'delete' });\n      await load();\n      notice('Account eliminato.');\n    } else if (b.dataset.sync) await syncAll(b.dataset.sync === 'results');\n    else if (b.dataset.reset) {\n      await api('admin/override/reset', { game_key: b.dataset.game, field: b.dataset.reset });\n      await load();\n      await showGame(b.dataset.game);\n    } else if (b.hasAttribute('data-backup')) {\n      const data = await api('admin/backup');\n      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),\n        u = URL.createObjectURL(blob);\n      const a = document.createElement('a');\n      a.href = u;\n      a.download = 'volley-control-backup-' + isoNow() + '.json';\n      a.click();\n      URL.revokeObjectURL(u);\n    } else if (b.hasAttribute('data-usage')) {\n      const data = await api('admin/usage');\n      const d = data.daily[0];\n      $('#usage').textContent =\n        (d\n          ? `${d.day}: ${d.requests} richieste, ${d.reads} righe lette, ${d.writes} righe scritte. `\n          : 'Nessun conteggio ancora disponibile. ') +\n        data.quota_scope +\n        ' ' +\n        (data.account_plan_verified\n          ? 'Piano Free verificato al momento della configurazione.'\n          : 'Piano dell’account ancora da verificare prima della pubblicazione.');\n    }\n  } catch (error) {\n    notice(error.message, $('#dialog').open);\n    b.disabled = false;\n  }\n});\nload().then(connectLive).catch((e) => notice(e.message));\n","type":"text/javascript; charset=utf-8"},"/style.css":{"body":"* { box-sizing: border-box; }\n:root {\n  --ink: #14213d; --muted: #5b6577; --bg: #f3f6fb; --line: #e3e9f3;\n  --blue: #2f5bea; --red: #e5484d; --green: #1f9d63;\n  --shadow: 0 1px 2px rgba(20,33,61,.04), 0 4px 14px rgba(20,33,61,.06);\n}\nbody {\n  margin: 0; background: var(--bg); color: var(--ink);\n  font: 15px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n}\nmain { max-width: 820px; margin: auto; padding: 0 16px 32px; }\n.hero {\n  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;\n  padding: 12px 0;\n}\n.brand { display: flex; align-items: center; gap: 8px; }\n.logo { width: 32px; height: 32px; border-radius: 8px; background: transparent; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: 0 0 auto; }\n.logo img { display: block; width: 100%; height: 100%; object-fit: cover; }\n.hero h1 { font-size: 15px; letter-spacing: .02em; margin: 0; }\n.hero p { display: none; }\n.staging { font-size: 11px; color: #8a5a00; background: #fff6e5; border-radius: 10px; padding: 6px 10px; margin: 0 0 10px; }\n.top { display: flex; align-items: center; gap: 6px; }\n.top #identity { font-size: 12px; color: var(--muted); }\nbutton, input, select, textarea { font: inherit; }\nbutton {\n  cursor: pointer; border: 0; background: #fff; color: var(--ink); border-radius: 12px;\n  padding: 0 14px; min-height: 40px; font-weight: 600; box-shadow: var(--shadow);\n}\nbutton:hover { background: #eef3ff; }\nbutton:disabled { opacity: .4; cursor: not-allowed; }\nbutton:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #2c91df; outline-offset: 2px; }\nbutton.primary { background: var(--blue); color: #fff; }\n#patty { background: linear-gradient(135deg, #2f5bea, #7c3aed); color: #fff; box-shadow: 0 4px 12px rgba(91,70,234,.35); }\n#access, #home { box-shadow: none; background: transparent; }\n#access:hover, #home:hover { background: #e9eef8; }\nh2 { font-size: 20px; letter-spacing: -.01em; margin: 18px 0 4px; }\n#weeks { display: flex; align-items: center; gap: 4px; background: #fff; border-radius: 16px; padding: 4px; box-shadow: var(--shadow); }\n#weeks .step { width: 44px; height: 44px; padding: 0; font-size: 22px; box-shadow: none; background: transparent; border-radius: 12px; }\n#weeks .step:hover:not(:disabled) { background: #e9eef8; }\n.week-pick { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 44px; border-radius: 12px; }\n.week-pick span { font-size: 11px; color: var(--muted); pointer-events: none; }\n.week-pick select {\n  appearance: none; border: 0; background: transparent; width: 100%; text-align: center; text-align-last: center;\n  font-weight: 600; font-size: 15px; color: var(--ink); cursor: pointer; padding: 0 8px; margin-top: -2px;\n}\n#summary { font-size: 13px; color: var(--muted); margin: 0 0 8px; }\n.legend { display: flex; align-items: center; gap: 14px; font-size: 11px; color: var(--muted); margin: 6px 0 10px; }\n.dot {\n  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%;\n  font-size: 14px; font-weight: 700; font-style: normal; flex-shrink: 0; color: #fff; border: 0;\n}\n.legend .dot { width: 16px; height: 16px; font-size: 10px; }\n.covered { background: var(--green); }\n.missing { background: var(--red); }\n.na { background: #b8c2d3; }\n.metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 12px 0; }\n.metrics > div { background: #fff; border-radius: 14px; padding: 12px 14px; box-shadow: var(--shadow); }\n.metrics span { display: block; font-size: 12px; color: var(--muted); }\n.metrics strong { display: block; font-size: 24px; font-weight: 600; margin-top: 2px; }\n.fixture {\n  position: relative; background: #fff; border-radius: 16px; margin-bottom: 8px; box-shadow: var(--shadow);\n  transition: background .15s ease, transform .1s ease;\n}\n.fixture:hover { background: #eef3ff; }\n.fixture:active { background: #e2eaff; transform: scale(.995); }\n.fixture::after { content: '›'; position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #9aa5b8; font-size: 24px; pointer-events: none; }\n.fixture.away { opacity: .85; }\n.open-game {\n  position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; box-shadow: none;\n  border-radius: 16px; padding: 0; min-height: 0; z-index: 1;\n}\n.open-game:hover { background: transparent; }\n.mobile {\n  display: grid; grid-template-columns: 64px 118px minmax(0, 1fr) auto; align-items: center; gap: 4px 14px;\n  padding: 12px 36px 12px 14px; pointer-events: none;\n}\n.mobile .identity { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 64px; height: 56px; border-radius: 14px; background: #fff1e0; color: #8a4200; }\n.mobile .cat { font-size: 19px; font-weight: 700; line-height: 1; }\n.mobile .cat--long { font-size: 11px; line-height: 12px; text-align: center; max-width: 60px; overflow-wrap: normal; }\n.mobile .source { font-size: 11px; font-weight: 600; margin-top: 4px; }\n.mobile .short { display: none; }\n.mobile .when { display: flex; flex-direction: column; }\n.mobile .when b { font-size: 17px; letter-spacing: -.01em; }\n.mobile .when em { font-style: normal; font-size: 16px; font-weight: 600; color: #2349c9; }\n.mobile .when small { font-size: 11px; color: var(--muted); }\n.mobile .teams { font-size: 15px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }\n.mobile .seats { display: flex; gap: 12px; }\n.mark { display: flex; flex-direction: column; align-items: center; gap: 3px; }\n.mark small { font-size: 11px; color: var(--muted); }\n.notice { font-size: 12px; color: #5b6e80; }\nfooter { margin-top: 20px; font-size: 11px; color: #61778b; }\n.maps { display: inline-block; margin: 6px 0 10px; font-size: 13px; font-weight: 600; color: var(--blue); text-decoration: none; }\n.maps:hover { text-decoration: underline; }\n#message:not(:empty), #dialog-message:not(:empty) { padding: 10px; border-radius: 10px; background: #fff1cf; font-size: 13px; }\n.danger { color: #bb1231; }\n#pending-dot { color: #9dd2ff; }\n.person { padding: 8px; border-bottom: 1px solid #dde7ef; }\n.actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }\n[hidden] { display: none !important; }\n.seat button { min-height: 44px; background: var(--blue); color: #fff; box-shadow: none; }\n.seat button:disabled { background: #dfe6f3; color: #6b778c; opacity: 1; }\n.seat .dot { width: 22px; height: 22px; font-size: 12px; vertical-align: middle; }\n@media (max-width: 700px) {\n  main { padding: 0 12px 24px; }\n  .metrics { display: none; }\n  .mobile { grid-template-columns: 64px minmax(0, 1fr) auto; grid-template-areas: 'id when seats' 'id teams seats'; padding: 12px 30px 12px 12px; gap: 2px 12px; }\n  .mobile .identity { grid-area: id; }\n  .mobile .when { grid-area: when; flex-direction: row; align-items: baseline; gap: 8px; flex-wrap: wrap; }\n  .mobile .when b { font-size: 15px; }\n  .mobile .when em { font-size: 14px; }\n  .mobile .teams { grid-area: teams; font-size: 13px; font-weight: 500; line-height: 1.25; }\n  .mobile .seats { grid-area: seats; gap: 8px; }\n  .fixture::after { right: 8px; }\n  .grid { grid-template-columns: 1fr; }\n  dialog { padding: 12px; }\n}\n\ndialog {\n  width: min(580px, calc(100% - 28px));\n  max-height: 90dvh;\n  overflow: auto;\n  border: 1px solid #d5e2ed;\n  border-radius: 14px;\n  padding: 16px;\n  background: #f8fbfe;\n  color: #193b5c;\n}\ndialog::backdrop {\n  background: #0b203b80;\n}\n.dialog-top {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 10px;\n  position: sticky;\n  top: -16px;\n  background: #f8fbfe;\n  z-index: 1;\n}\n.dialog-top h2 {\n  margin: 8px 0 16px;\n}\n.grid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n}\n.card {\n  border: 1px solid #dae5ee;\n  background: white;\n  border-radius: 12px;\n  padding: 9px 11px;\n  margin-bottom: 6px;\n  overflow-wrap: anywhere;\n}\n.card h3 {\n  font-size: 11px;\n  text-transform: uppercase;\n  color: #557188;\n  margin: 0 0 6px;\n}\n.card p {\n  font-size: 14px;\n  font-weight: 600;\n  margin: 0;\n}\n.card small {\n  display: block;\n  font-size: 12px;\n  color: #596e80;\n  line-height: 1.45;\n  margin-top: 4px;\n}\n.sheet-hero {\n  background: linear-gradient(115deg, #e7f1fb, #f8fbff);\n  padding: 12px 14px;\n  border: 1px solid #d6e4f1;\n  border-radius: 14px;\n  margin-bottom: 9px;\n}\n.sheet-hero strong {\n  display: block;\n  font-size: 18px;\n  margin-top: 5px;\n}\n.seat {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  justify-content: space-between;\n  border-bottom: 1px solid #dce6ef;\n  padding: 8px 0;\n}\n.seat button {\n  font-size: 12px;\n  flex-shrink: 0;\n}\n.field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  margin-bottom: 9px;\n}\n.field input,\n.field textarea,\n.field select {\n  width: 100%;\n  padding: 8px;\n  border: 1px solid #b9cbdc;\n  border-radius: 6px;\n  background: white;\n  min-width: 0;\n}\n.field textarea {\n  min-height: 60px;\n}\n.checks {\n  display: flex;\n  gap: 14px;\n  margin-bottom: 12px;\n  font-size: 13px;\n}\ndetails {\n  background: #fff;\n  border: 1px solid #dbe6ef;\n  border-radius: 8px;\n  padding: 10px;\n  margin: 8px 0;\n}\nsummary {\n  cursor: pointer;\n  font-weight: 600;\n  font-size: 14px;\n}\nform {\n  padding-top: 8px;\n}\n#message:not(:empty),\n#dialog-message:not(:empty) {\n  padding: 10px;\n  border-radius: 6px;\n  background: #fff1cf;\n  font-size: 13px;\n}\n.danger {\n  color: #bb1231;\n}\n.notice {\n  font-size: 12px;\n  color: #5b6e80;\n}\n#pending-dot {\n  color: #168bff;\n}\n.person {\n  padding: 8px;\n  border-bottom: 1px solid #dde7ef;\n}\n.actions {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n  margin: 10px 0;\n}\n[hidden] {\n  display: none !important;\n}\n\n/* Conferma esplicita per prenotazione, annullamento e rimozione incarichi. */\n.action-confirmation {\n  margin: 0 0 16px;\n  padding: 16px;\n  border: 2px solid #e4a63a;\n  border-radius: 12px;\n  background: #fff9e8;\n}\n.action-confirmation h3 { margin: 0 0 8px; }\n.action-confirmation p { margin: 8px 0; }\n.action-confirmation .actions button { min-height: 40px; }\n.mobile .who { display: block; font-size: 12px; font-weight: 600; color: #17633f; margin-top: 2px; }\n\n.grid { margin-top: 14px; }\n.seat { padding: 10px 0; }\n\nh1, h2, h3, strong, b { font-weight: 600; }\n.mobile .who { font-weight: 500; }\n\n#close-dialog { width: 40px; height: 40px; min-height: 40px; padding: 0; border-radius: 50%; }\n#close-dialog:focus-visible { outline: 2px solid #c9d6f7; outline-offset: 1px; }\n@media (max-width: 700px) {\n  .grid { grid-template-columns: 1fr; }\n  .card p { font-size: 14px; }\n  .seat { flex-direction: column; align-items: stretch; gap: 8px; }\n  .seat button { width: 100%; }\n  .seat > span { font-size: 14px; }\n}\n\n/* Nomi sempre nello stesso stile, qualunque sia la scrittura della fonte. */\n.mobile .teams, .mobile .who, .sheet-hero strong {\n  text-transform: uppercase;\n}\n.mobile .teams { font-weight: 500; }\n\n/* ===== V7 · palette bilanciata, header, layout desktop, PATTY, scheda ===== */\n:root {\n  --bg: #d6dce8; --navy: #14213d; --navy2: #24396b; --line: #cdd5e3;\n  --ocra: #f0dfb2; --ocra-ink: #4a3710;\n  --shadow: 0 1px 2px rgba(20,33,61,.10), 0 6px 18px rgba(20,33,61,.12);\n}\nbody { background: var(--bg); }\n.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0; }\n\n/* header a tutta larghezza, fascia navy */\n.hero { display: block; padding: 0; background: var(--navy); box-shadow: 0 2px 10px rgba(10,18,40,.25); }\n.hero-in { max-width: 1280px; margin: auto; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }\n.hero h1 { color: #fff; letter-spacing: .06em; font-weight: 700; }\n.logo { background: transparent; }\n.top #identity { color: #c9d3e8; }\n#home, #access { color: #fff; }\n#access:hover, #home:hover { background: rgba(255,255,255,.12); }\n#patty { background: var(--ocra); color: var(--navy); box-shadow: none; font-weight: 700; }\n#patty:hover { background: #f7ebc7; }\n#pending-dot { color: #c2410c; }\n\nmain { max-width: 1280px; padding-top: 14px; }\n.staging { background: #f6ead0; color: #6b4a00; }\n\n/* card bianche con bordo più deciso */\n#weeks, .metrics > div, .fixture { border: 1px solid var(--line); box-shadow: var(--shadow); }\n.fixture:hover { background: #eceff5; }\n.fixture:active { background: #e1e6ef; }\n.fixture.new-day { margin-top: 16px; }\n.fixture.away { opacity: 1; background: #f1f3f8; }\n#weeks .step:hover:not(:disabled) { background: #e6eaf3; }\nbutton:hover { background: #eceff5; }\nbutton.primary { background: var(--navy2); }\nbutton.primary:hover { background: var(--navy); }\n.seat button { background: var(--navy2); }\n.seat button:hover { background: var(--navy); }\n.seat button:disabled { background: #dfe4ee; color: #5b6577; }\n.mobile .identity { background: var(--ocra); color: var(--ocra-ink); }\n.mobile .when em { color: var(--ink); font-weight: 600; }\n.mobile .teams .t.us { font-weight: 700; }\n.mobile .teams .t:not(.us) { color: #4a566b; }\n.score { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 8px; background: var(--navy); color: #fff; font-size: 12px; font-weight: 700; vertical-align: 1px; }\n.tag-away { font-size: 11px; font-weight: 600; color: #5b6577; border: 1px solid #c4cddd; border-radius: 999px; padding: 2px 10px; background: #fff; white-space: nowrap; }\n.maps { color: var(--navy2); }\n#summary { color: #3b475c; }\n.legend { color: #3b475c; flex-wrap: wrap; }\n\n/* layout desktop a due colonne */\n.layout { display: block; }\n@media (min-width: 1000px) {\n  main { padding-left: 24px; padding-right: 24px; }\n  .layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 24px; align-items: start; }\n  .side { grid-column: 1; grid-row: 1; position: sticky; top: 16px; display: flex; flex-direction: column; gap: 10px; }\n  #games { grid-column: 2; grid-row: 1; }\n  #title { margin: 6px 0 0; font-size: 16px; }\n  .metrics { display: flex; flex-direction: column; gap: 6px; margin: 0; }\n  .metrics > div { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; border-radius: 12px; }\n  .metrics span { display: inline; font-size: 13px; color: #3b475c; }\n  .metrics strong { display: inline; font-size: 18px; margin: 0; }\n  #summary { margin: 0; }\n  .legend { margin: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px 10px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; }\n  .mobile { grid-template-columns: 64px 118px minmax(0, 1fr) auto; }\n}\n\n/* PATTY: una barra, poi gruppi */\n#admin { margin: 0 0 14px; }\n.patty-panel { background: #fff; border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); padding: 0; margin: 0; }\n.patty-panel > summary { list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 16px; min-height: 52px; font-size: 15px; font-weight: 700; cursor: pointer; }\n.patty-panel > summary::-webkit-details-marker { display: none; }\n.patty-panel > summary::after { content: '▾'; color: #5b6577; margin-left: auto; padding-left: 10px; }\n.patty-panel[open] > summary::after { content: '▴'; }\n.patty-panel > summary > span:first-child { display: inline-flex; align-items: center; gap: 8px; }\n.patty-panel > summary > span:first-child::before { content: '🔓'; font-size: 14px; }\n.badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: #e3f3ea; color: #17633f; }\n.badge.warn { background: #fde8e8; color: #b42318; }\n.patty-body { padding: 4px 16px 16px; border-top: 1px solid var(--line); }\n.patty-body > h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #5b6577; margin: 12px 0 0; }\n.pgroup { margin-top: 14px; }\n.pgroup > h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #5b6577; margin: 0 0 6px; }\n.pgroup details { background: #f6f8fc; border: 1px solid var(--line); border-radius: 12px; margin: 6px 0; }\n.pgroup details details { background: #fff; }\n\n/* scheda partita */\n.strip { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin: 10px 0; font-size: 14px; font-weight: 600; min-height: 44px; }\n.pill { border-radius: 999px; padding: 2px 12px; font-size: 13px; font-weight: 700; }\n.pill.home { background: var(--navy); color: #fff; }\n.pill.away { background: #e6eaf3; color: #3b475c; }\n.place { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }\n.place h3, .staff h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #557188; margin: 0 0 4px; }\n.place p { margin: 0; line-height: 1.35; }\n.place .venue { font-size: 16px; font-weight: 700; text-transform: uppercase; }\n.place .addr { font-size: 14px; font-weight: 500; color: #3b475c; }\n.maps.pin { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0; border-radius: 50%; background: var(--navy2); color: #fff; flex-shrink: 0; }\n.maps.pin:hover { background: var(--navy); text-decoration: none; }\n.staff { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }\n.staff-line { padding: 4px 0; }\n.staff-line + .staff-line { border-top: 1px solid #edf0f6; }\n.staff-line small { display: block; font-size: 11px; color: #6b778c; min-height: 0; margin: 0; }\n.staff-line small:empty { display: none; }\n.staff-line p { margin: 0; font-size: 16px; font-weight: 600; text-transform: uppercase; }\n.staff-line + .staff-line:has(small:empty) { border-top: 0; padding-top: 0; }\ndialog .card h3 { margin-bottom: 4px; }\ndialog > #dialog-content > .card { padding: 8px 12px; }\ndialog > #dialog-content > .card p { font-size: 14px; }\n.sheet-hero { background: var(--navy); color: #dfe6f5; border: 0; font-size: 13px; }\n.sheet-hero strong { color: #fff; font-size: 18px; }\ndialog { background: #eef1f7; }\n.dialog-top { background: #eef1f7; }\n\n@media (max-width: 700px) {\n  .hero-in { padding: 8px 12px; }\n  .fixture.new-day { margin-top: 12px; }\n  .mobile .when em { font-size: 14px; }\n  .mobile .teams .score { margin-left: 6px; }\n  .tag-away { font-size: 10px; padding: 2px 8px; }\n  .place .venue { font-size: 15px; }\n}\n\n/* Campo da volley originale Work, fisso dietro tutte le schermate. */\nhtml { min-height: 100%; background: #101b2d; }\nbody {\n  min-height: 100vh;\n  background-color: #101b2d;\n  background-image: linear-gradient(rgba(6,15,32,.12),rgba(6,15,32,.26)), url(\"data:image/webp;base64,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\");\n  background-size: cover;\n  background-position: center center;\n  background-attachment: fixed;\n  background-repeat: no-repeat;\n}\n.hero { background: rgba(8,18,39,.90); }\n#summary, .legend, footer { color: #fff; text-shadow: 0 1px 3px #000; }\n#summary { font-weight: 600; }\n#admin { background: rgba(245,248,253,.96); border-radius: 16px; padding: 14px; }\n@media(max-width:700px) { body { background-attachment: scroll; } }\n\n/* Contrasto sullo sfondo fotografico e nella legenda desktop. */\n#title {\n  color: #fff;\n  text-shadow: 0 1px 3px #000;\n}\n@media (min-width: 1000px) {\n  .legend {\n    color: #14213d;\n    text-shadow: none;\n  }\n}\n\n\n/* PATTY: modifica immediata dello staff nella scheda partita originale. */\n.staff-inline-form { padding-top: 2px; }\n.staff-inline-row { display: block; padding: 6px 0; border-bottom: 1px solid #edf0f6; }\n.staff-inline-row > span { display: block; color: #6b778c; font-size: 11px; margin-bottom: 3px; }\n.staff-inline-row input, .staff-inline-row textarea {\n  box-sizing: border-box; display: block; width: 100%; padding: 7px 9px;\n  border: 1px solid #d9e1eb; border-radius: 7px; background: #f8fafd;\n  color: #193b5c; font-size: 16px; font-weight: 600; font-family: inherit;\n  text-transform: uppercase; resize: vertical;\n}\n.staff-inline-row input:focus, .staff-inline-row textarea:focus { outline: 2px solid #2764a2; background: white; }\n.staff-inline-save { display: flex; gap: 8px; margin: 10px 0 4px; }\n.staff-inline-save button { flex: 1; min-width: 0; padding: 10px 4px; font-size: 13px; }\n.staff-reset { margin-top: 4px; background: transparent; color: #193b5c; border: 1px solid #cbd7e3; }\n\n/* Safari su iPhone: impedisce lo zoom automatico al focus dei campi. */\nhtml {\n  -webkit-text-size-adjust: 100%;\n  text-size-adjust: 100%;\n}\n@media (max-width: 700px) {\n  input:not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"hidden\"]),\n  select,\n  textarea {\n    font-size: 16px !important;\n  }\n  button, input, select, textarea {\n    touch-action: manipulation;\n  }\n}\n\n/* Safari iPhone: la pagina non deve potersi spostare lateralmente.\n   Blocca il doppio-tocco di zoom, ma lascia disponibile lo zoom a due dita. */\nhtml, body {\n  width: 100%;\n  max-width: 100%;\n  overflow-x: clip;\n  overscroll-behavior-x: none;\n  touch-action: manipulation;\n}\n@media (max-width: 700px) {\n  main, .layout, .side, #games, #weeks, .fixture, .mobile {\n    min-width: 0;\n    max-width: 100%;\n  }\n  .week-pick {\n    min-width: 0;\n  }\n  #weeks .step {\n    flex: 0 0 44px;\n  }\n}\n\n/* Accesso personale: un solo modulo alla volta, con alternativa discreta. */\n.access-switch {\n  margin: 14px 0 0;\n  color: #5b6577;\n  font-size: 14px;\n}\n.access-switch button {\n  display: inline;\n  padding: 4px 6px;\n  min-height: 0;\n  background: transparent;\n  border-radius: 4px;\n  box-shadow: none;\n  color: #1c548f;\n  text-decoration: underline;\n  font-size: 16px;\n}\n\n\n/* Volley Control: evidenza personale delle gare per cui si è prenotati.\n   Azzurro riservato alla scheda dell'utente; i semafori rosso/verde restano invariati. */\n.fixture.my-booking {\n  background: #e0f1ff;\n  border-color: #78b6ef;\n  box-shadow: inset 4px 0 0 #287bd0, 0 2px 12px rgba(25, 95, 170, .12);\n}\n.fixture.my-booking:hover { background: #d2eaff; }\n.fixture.my-booking:active { background: #c4e2fb; }\n\n\n/* Colori personali staff: prenotazioni azzurre sempre prioritarie.\n   Non modificare i pallini rosso/verde relativi alle coperture. */\n.fixture.my-manager {\n  background: #e4f6e9;\n  border-color: #87cc9e;\n  box-shadow: inset 4px 0 0 #23844a, 0 2px 12px rgba(19, 104, 57, .10);\n}\n.fixture.my-manager:hover { background: #d6f0df; }\n.fixture.my-manager:active { background: #c7e9d1; }\n.fixture.my-coach {\n  background: #eee6ff;\n  border-color: #b8a1ed;\n  box-shadow: inset 4px 0 0 #7954b7, 0 2px 12px rgba(83, 51, 149, .12);\n}\n.fixture.my-coach:hover { background: #e5d9fc; }\n.fixture.my-coach:active { background: #dacaf7; }\n\n\n\n.team-filter { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; background: #fff; border-radius: 14px; padding: 10px 12px; box-shadow: var(--shadow); }\n.team-filter span { font-size: 11px; color: var(--muted); }\n.team-filter select { width: 100%; min-height: 42px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; color: var(--ink); font-weight: 600; }\n.team-week-heading { background: var(--blue); color: #fff; border-radius: 10px; margin: 10px 0 6px; padding: 8px 12px; font-size: 13px; }\n\n.team-pdf-button { width: 100%; margin-top: 8px; background: var(--blue); color: #fff; box-shadow: var(--shadow); }\n.team-pdf-button:hover { background: #244ed0; }\n","type":"text/css; charset=utf-8"},"/manifest.webmanifest":{"body":"{\n  \"name\": \"VOLLEY CONTROL\",\n  \"short_name\": \"Volley Control\",\n  \"id\": \"/\",\n  \"start_url\": \"/\",\n  \"scope\": \"/\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#ffffff\",\n  \"theme_color\": \"#10233d\",\n  \"icons\": [\n    {\n      \"src\": \"/icons/pvi-volley-control-v4-192.png\",\n      \"sizes\": \"192x192\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any\"\n    },\n    {\n      \"src\": \"/icons/pvi-volley-control-v4-512.png\",\n      \"sizes\": \"512x512\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any\"\n    }\n  ]\n}\n","type":"application/manifest+json"},"/icons/pvi-volley-control-v4-180.png":{"body":"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","type":"image/png","base64":true},"/icons/pvi-volley-control-v4-192.png":{"body":"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","type":"image/png","base64":true},"/icons/pvi-volley-control-v4-512.png":{"body":"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","type":"image/png","base64":true}};
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
    if (field !== 'staff_override' && JSON.stringify(official[field]) !== JSON.stringify(value))
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

const RELEASE = 'cf-staging-2026-10-27.11';
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
// PATTY: scadenza mobile, rinnovata dall'attività reale nell'app.
const PATTY_SESSION_MS = 30 * 60 * 1000;
const PATTY_RENEW_WINDOW_MS = 15 * 60 * 1000;
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
async function authenticate(req, env) {
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
  const actor = s?.admin
    ? (s.person_id ? 'PATTY-DELEGATO:' + s.person_id + '|' + s.first_name + ' ' + s.last_name : 'PATTY')
    : s?.person_id;
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
    try {
      // Verifica che la sessione personale sia stata davvero promossa.
      // Prima la chiamata rispondeva OK anche in caso di UPDATE senza righe modificate.
      const result = await statement(env.DB,
        'UPDATE sessions SET admin=1,patty_expires_at=? WHERE token_hash=? AND person_id=? AND expires_at>?',
        now + PATTY_SESSION_MS, s.token_hash, s.person_id, now).run();
      if (result?.meta?.changes !== 1)
        fail('La sessione personale è scaduta. Esci e rientra nell’area personale.', 409);
      return json({ ok: true, admin: true });
    } catch (error) {
      // Diagnostica riservata nel DB: nessuna password o token viene registrato.
      try {
        await audit(env.DB, 'system', 'patty_entry_failure', null, {
          person_id: s.person_id,
          message: String(error?.message || error).slice(0, 220),
          code: error?.status || 500,
        }).run();
      } catch { /* La diagnostica non deve cambiare l'errore originale. */ }
      if (error.status) throw error;
      fail('Accesso PATTY non riuscito: errore tecnico VC-58. Segnalalo all’organizzatore.', 503);
    }
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
  if (path === '/api/admin/person/roles' && req.method === 'POST') {
    const b = await body(req);
    const fields = ['wants_referee', 'wants_scorer', 'wants_manager', 'wants_coach'];
    if (!b || typeof b !== 'object' || Array.isArray(b) ||
        Object.keys(b).sort().join(',') !== ['id', ...fields].sort().join(',') ||
        typeof b.id !== 'string' || !b.id || b.id.length > 128 ||
        fields.some((key) => typeof b[key] !== 'boolean'))
      fail('Selezione ruoli non valida.', 400);
    if (!fields.some((key) => b[key]))
      fail('Seleziona almeno un ruolo.', 400);
    const person = await one(env.DB,
      'SELECT id,first_name,last_name,wants_referee,wants_scorer,wants_manager,wants_coach FROM people WHERE id=?', b.id);
    if (!person) fail('Utente non trovato.', 404);
    const previous = Object.fromEntries(fields.map((key) => [key, !!person[key]]));
    const updated = Object.fromEntries(fields.map((key) => [key, b[key]]));
    if (fields.every((key) => previous[key] === updated[key]))
      return json({ ok: true, changed: false });
    await env.DB.batch([
      statement(env.DB,
        'UPDATE people SET wants_referee=?,wants_scorer=?,wants_manager=?,wants_coach=? WHERE id=?',
        ...fields.map((key) => b[key] ? 1 : 0), b.id),
      audit(env.DB, actor, 'person_roles_updated', null, {
        id: b.id, name: person.first_name + ' ' + person.last_name,
        before: previous, after: updated,
      }),
    ]);
    return json({ ok: true, changed: true });
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
    const applied = await applyFixed(env.DB, null, [b.game_key]);
    await audit(env.DB, actor, 'fixed_applied', b.game_key, {
      created: applied.created, conflicts: applied.conflicts?.length || 0,
    }).run();
    return json({ ok: true, ...applied });
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
    const scope = clean(b.scope);
    const result = await syncScope(env, scope, b.results_only === true);
    await audit(env.DB, actor, 'calendar_sync_started', null, {
      scope, results_only: b.results_only === true,
    }).run();
    return json(result);
  }
  if (path === '/api/admin/sync/step' && req.method === 'POST') {
    const b = await body(req);
    return json(await syncStep(env, clean(b.job_id)));
  }
  // Registro riservato: soltanto gli interventi manuali di PATTY e collaboratori.
  // La query non espone le azioni agli utenti normali: admin(s) è già verificato.
  if (path === '/api/admin/activity' && req.method === 'GET')
    return json({
      activity: await all(env.DB,
        "SELECT id,actor,action,game_key,details,changed_at FROM audit WHERE actor='PATTY' OR actor LIKE 'PATTY-DELEGATO:%' ORDER BY id DESC LIMIT 150"),
    });
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
