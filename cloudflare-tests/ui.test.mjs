import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { LocalD1 } from './db.mjs';
import worker, { passwordHash, sha, statement, saveGame } from '../worker/index.mjs';
const password = 'TEST-only-UI-password-123';
const personPin = 'P123';
async function flush(window) {
  let idle = 0;
  for (let i = 0; i < 400; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (window.testPending() === 0) idle++;
    else idle = 0;
    if (idle >= 3) return;
  }
  throw new Error('Richieste UI non terminate entro il limite del test.');
}
async function setup() {
  const db = new LocalD1(),
    env = {
      DB: db,
      PASSWORD_PEPPER: 'TEST-ui-private-key',
      ENVIRONMENT: 'staging',
      REGISTRATION_ENABLED: 'true',
    };
  env.PATTY_HASH = await passwordHash(password, env.PASSWORD_PEPPER);
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
    script = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  // Come una scheda visibile: JSDOM altrimenti la considera in prerender
  // e l'app sospende correttamente la connessione live.
  const dom = new JSDOM(html, {
    url: 'https://test.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
  }),
    w = dom.window;
  // Simula la connessione push in modo deterministico, senza rete nei test DOM.
  const sockets = [];
  w.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    close() { this.readyState = 3; this.onclose?.(); }
    static OPEN = 1;
  };
  w.testSendLiveChange = () => {
    assert.ok(sockets.some((socket) => socket.readyState === 1), 'connessione live aperta');
    for (const socket of sockets)
      if (socket.readyState === 1)
        socket.onmessage?.({ data: '{"type":"calendar-changed"}' });
  };
  let cookie = '',
    pending = 0;
  w.testPending = () => pending;
  w.fetch = async (path, options = {}) => {
    pending++;
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Cookie', cookie);
      if (options.method === 'POST') headers.set('Origin', 'https://test.invalid');
      const r = await worker.fetch(
        new Request(new URL(path, 'https://test.invalid'), { ...options, headers }),
        env,
      );
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return r;
    } finally {
      pending--;
    }
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  return {
    db,
    env,
    w,
    dom,
    async start() {
      w.eval(script);
      await flush(w);
    },
    async click(s) {
      const el = w.document.querySelector(s);
      assert.ok(el, 'elemento ' + s);
      el.click();
      await flush(w);
    },
    async submit(s, values) {
      const form = w.document.querySelector(s);
      assert.ok(form, s);
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        assert.ok(el, name);
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
      }
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await flush(w);
    },
  };
}
test('notifica live aggiorna il posto su un secondo dispositivo, senza F5', async () => {
  const u = await setup();
  try {
    await saveGame(u.db, GAME, GAME, {});
    await u.start();
    await u.click('[data-week]');
    assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.missing').length, 2);
    await statement(u.db,
      'INSERT INTO people(id,email,first_name,last_name,password_hash,wants_referee,wants_scorer,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      'LIVE-person', 'live@invalid.example', 'TEST', 'LIVE', 'test-hash', 1, 1, 1,
      new Date().toISOString()).run();
    await statement(u.db,
      "INSERT INTO assignments(game_key,role,slot,person_id,source,created_at) VALUES(?,?,?,?,?,?)",
      GAME.game_key, 'referee', 1, 'LIVE-person', 'self', new Date().toISOString()).run();
    assert.doesNotMatch(u.w.document.querySelector('#games').textContent, /TEST LIVE/);
    u.w.testSendLiveChange();
    await flush(u.w);
    assert.match(u.w.document.querySelector('#games').textContent, /TEST LIVE/);
    assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.missing').length, 1);
    assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.covered').length, 1);
    await statement(u.db, 'DELETE FROM assignments WHERE game_key=?', GAME.game_key).run();
    u.w.testSendLiveChange();
    await flush(u.w);
    assert.doesNotMatch(u.w.document.querySelector('#games').textContent, /TEST LIVE/);
    assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.missing').length, 2);
  } finally { u.dom.window.close(); u.db.close(); }
});
const GAME = {
  game_key: 'TEST:UI',
  team_id: 'FIPAV:229693',
  source: 'FIPAV',
  season: '2026-2027',
  group_id: '63945',
  official_id: 'TEST:UI',
  game_number: 'TEST',
  our_team_id: '229693',
  our_team_name: 'TEST SQUADRA',
  category: 'U15 Femminile',
  home_team: 'TEST <img src=x>',
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
test('frontend DOM: navigazione ripetuta, etichette, comitato, nomi brevi e scheda reale', async () => {
  const u = await setup();
  try {
    await saveGame(u.db, GAME, GAME, {});
    await u.start();
    assert.equal(u.w.document.querySelectorAll('#games article').length, 0);
    await u.click('[data-week]');
    assert.equal(u.w.document.querySelectorAll('#games article').length, 1);
    assert.match(u.w.document.querySelector('.mobile').textContent, /U15.*FIPAV.*OTTOLINA/);
    assert.equal(
      u.w.document.querySelectorAll('#games img').length,
      0,
      'testi fonte trattati come testo',
    );
    await u.click('[data-open]');
    assert.ok(u.w.document.querySelector('dialog').open);
    assert.equal(u.w.document.querySelectorAll('[data-book]:disabled').length, 2);
    await u.click('#close-dialog');
    await u.click('#home');
    await u.click('[data-week]');
    await u.click('#home');
    assert.equal(u.w.document.querySelector('#message').textContent, '');
    assert.equal(u.w.document.querySelectorAll('#metrics>div').length, 5);
  } finally {
    u.dom.window.close();
    u.db.close();
  }
});
test('frontend → API: login personale, Mi prenoto, nominativo e annullamento', async () => {
  const u = await setup();
  try {
    await saveGame(u.db, GAME, GAME, {});
    await statement(
      u.db,
      'INSERT INTO people(id,email,first_name,last_name,password_hash,wants_referee,wants_scorer,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      'TEST-ui-person',
      (await sha(JSON.stringify(['test','utente']))) + '@example.invalid',
      'TEST',
      'UTENTE',
      await passwordHash(personPin, u.env.PASSWORD_PEPPER),
      1,
      1,
      1,
      new Date().toISOString(),
    ).run();
    await u.start();
    await u.click('[data-week]');
    await u.click('#access');
    await u.submit('form[data-form="login"]', { first_name: 'TEST', last_name: 'UTENTE', password: personPin });
    await u.click('[data-open]');
    assert.equal(u.w.document.querySelector('[data-book]').disabled, false);
    await u.click('[data-book][data-role="referee"]');
    assert.match(
      u.w.document.querySelector('#action-confirmation').textContent,
      /Ti stai prenotando per questa partita/,
    );
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 0);
    assert.equal(u.w.document.querySelectorAll('#action-confirmation img').length, 0);
    await u.click('[data-abort-action]');
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 0);
    await u.click('[data-book][data-role="referee"]');
    await u.click('[data-confirm-action]');
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 1);
    assert.match(u.w.document.querySelector('#dialog-content').textContent, /TEST UTENTE/);
    assert.ok(u.w.document.querySelector('#games .mobile .dot.covered'));
    await u.click('[data-cancel]');
    assert.match(
      u.w.document.querySelector('#action-confirmation').textContent,
      /Stai annullando la tua prenotazione per questa partita/,
    );
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 1);
    await u.click('[data-abort-action]');
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 1);
    await u.click('[data-cancel]');
    await u.click('[data-confirm-action]');
    assert.equal((await statement(u.db, 'SELECT count(*) n FROM assignments').first()).n, 0);
    assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.missing').length, 2);
  } finally {
    u.dom.window.close();
    u.db.close();
  }
});
test('frontend PATTY: completamento gara incompleta e cambio settimana', async () => {
  const u = await setup();
  try {
    await saveGame(u.db, { ...GAME, date: '', time: '' }, { ...GAME, date: '', time: '' }, {});
    await u.start();
    assert.match(u.w.document.querySelector('#patty').textContent, /●/);
    await u.click('#patty');
    await u.submit('form[data-form="login"]', { password });
    assert.equal(u.w.document.querySelector('#admin').hidden, false);
    await u.submit('form[data-form="patty-pin"]', { pin: 'P444', confirm: 'P444' });
    assert.ok((await statement(u.db, "SELECT value FROM settings WHERE key='patty_pin_hash'").first())?.value);
    await u.click('#patty');
    await u.click('#patty');
    await u.submit('form[data-form="login"]', { password: 'P444' });
    assert.equal(u.w.document.querySelector('#admin').hidden, false);
    await u.submit('form[data-form="pending"]', {
      date: '2030-01-06',
      time: '20:15',
      reason: 'TEST collaudo locale',
    });
    assert.match(u.w.document.querySelector('#title').textContent, /GARE/);
    assert.equal(u.w.document.querySelectorAll('#games article').length, 1);
    assert.match(u.w.document.querySelector('#games').textContent, /20:15/);
    assert.doesNotMatch(u.w.document.querySelector('#patty').textContent, /●/);
  } finally {
    u.dom.window.close();
    u.db.close();
  }
});

test('Registrazione senza email e con codice 4 caratteri', async () => {
  const u=await setup();
  try {
    await u.start();
    await u.click('#access');
    const area=u.w.document.querySelector('#dialog-content');
    assert.equal(area.querySelector('[name="email"]'), null);
    const f=area.querySelector('form[data-form="register"]');
    assert.doesNotMatch(area.textContent, /Solo collaudo|dati fittizi|nomi inventati/i);
    assert.equal(f.elements.namedItem('staging_consent'),null);
    assert.match(area.textContent,/Puoi sceglierne più di uno/);
    assert.equal(f.elements.namedItem('password').maxLength,4);
    assert.ok(f.elements.namedItem('wants_manager'));
    assert.ok(f.elements.namedItem('wants_coach'));
    await u.submit('form[data-form="register"]', {
      first_name:'MARIO',last_name:'COLLAUDO',password:'A123',
      wants_referee:true,wants_scorer:true,wants_manager:true,wants_coach:true,
    });
    assert.equal((await statement(u.db,'SELECT count(*) n FROM people').first()).n,1);
    const p=await statement(u.db,'SELECT * FROM people').first();
    for(const key of ['wants_referee','wants_scorer','wants_manager','wants_coach']) assert.equal(p[key],1);
    await u.click('#patty');await u.submit('form[data-form="login"]',{password});
    const admin=u.w.document.querySelector('#admin');
    assert.match(admin.textContent,/Arbitro, Refertista, Dirigente, Allenatore/);
    assert.match(admin.textContent,/Disattiva account/);
  } finally {u.dom.window.close();u.db.close();}
});

test('solo dirigente o allenatore: accesso alle gare ma nessuna prenotazione',async()=>{
 for (const [role,first,last] of [
  ['wants_manager','DIRIGENTE','TEST'],
  ['wants_coach','ALLENATORE','TEST']
 ]) {
  const u=await setup();try{
   await saveGame(u.db,GAME,GAME,{});await u.start();await u.click('#access');
   await u.submit('form[data-form="register"]',{first_name:first,last_name:last,password:'D123',[role]:true});
   assert.equal((await statement(u.db,'SELECT approved FROM people LIMIT 1').first()).approved,1);
   await u.click('[data-week]');await u.click('[data-open]');
   assert.equal(u.w.document.querySelector('[data-book]'),null);
   assert.match(u.w.document.querySelector('#dialog-content').textContent,/Non abilitato a questo ruolo/);
   assert.equal((await statement(u.db,'SELECT count(*) n FROM assignments').first()).n,0);
  }finally{u.dom.window.close();u.db.close();}
 }
});
test('dirigente e refertista: solo prenotazione come refertista',async()=>{
 const u=await setup();try{
  await saveGame(u.db,GAME,GAME,{});await u.start();await u.click('#access');
  await u.submit('form[data-form="register"]',{first_name:'DIRETTORE',last_name:'REFERTISTA',password:'D123',wants_manager:true,wants_scorer:true});
  await u.click('[data-week]');await u.click('[data-open]');
  assert.equal(u.w.document.querySelector('[data-book][data-role="referee"]'),null);
  assert.equal(u.w.document.querySelector('[data-book][data-role="scorer"]').disabled,false);
  await u.click('[data-book][data-role="scorer"]');await u.click('[data-confirm-action]');
  const a=await statement(u.db,'SELECT role FROM assignments WHERE game_key=?',GAME.game_key).first();
  assert.equal(a.role,'scorer');
 }finally{u.dom.window.close();u.db.close();}
});

test('PATTY attiva e disattiva le due spunte federali nella scheda partita',async()=>{
 const u=await setup();
 try{
  await saveGame(u.db,GAME,GAME,{});
  await u.start();
  await u.click('#patty');
  await u.submit('form[data-form="login"]',{password});
  await u.click('[data-week]');
  await u.click('[data-open]');
  const form='form[data-form="federal"]';
  assert.ok(u.w.document.querySelector(form+' [name="federal_referee"]'));
  assert.ok(u.w.document.querySelector(form+' [name="federal_scorer"]'));
  await u.submit(form,{federal_referee:true,federal_scorer:true});
  assert.match(u.w.document.querySelector('#dialog-content').textContent,/Arbitro federale/);
  assert.match(u.w.document.querySelector('#dialog-content').textContent,/Refertista federale/);
  assert.ok(u.w.document.querySelectorAll('#games .dot.covered').length>=2);
  assert.equal(u.w.document.querySelector('#dialog-content [data-book]'),null);
  await u.submit(form,{federal_referee:false,federal_scorer:false});
  // PATTY prenota per una persona: il pulsante personale data-book è riservato agli utenti.
  assert.equal(u.w.document.querySelector('#dialog-content [data-book]'), null);
  assert.ok(u.w.document.querySelector('#dialog-content [data-admin-book][data-role="referee"]'));
  assert.ok(u.w.document.querySelector('#dialog-content [data-admin-book][data-role="scorer"]'));
  assert.equal(u.w.document.querySelectorAll('#games .mobile .dot.missing').length,2);
  const row=await statement(u.db,'SELECT effective_json FROM games WHERE game_key=?',GAME.game_key).first();
  const g=JSON.parse(row.effective_json);
  assert.equal(g.federal_referee,false);
  assert.equal(g.federal_scorer,false);
  // Lo stesso posto è di nuovo prenotabile dall'area personale dopo l'uscita da PATTY.
  await u.click('#close-dialog');await u.click('#patty');await u.click('#access');
  await u.submit('form[data-form="register"]',{first_name:'TEST',last_name:'FEDERALI',password:'F123',wants_referee:true,wants_scorer:true,});
  await u.click('[data-open]');
  assert.equal(u.w.document.querySelector('#dialog-content [data-book][data-role="referee"]').disabled,false);
  assert.equal(u.w.document.querySelector('#dialog-content [data-book][data-role="scorer"]').disabled,false);
 }finally{u.dom.window.close();u.db.close();}
});

test('PATTY mostra registrati senza salvataggio o modifica dei ruoli',async()=>{
 const u=await setup();
 try {
   await statement(u.db,'INSERT INTO people(id,email,first_name,last_name,password_hash,wants_referee,wants_scorer,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?)','TEST-access','access@invalid.example','TEST','ACCESS','testhash',1,0,1,new Date().toISOString()).run();
   await u.start();await u.click('#patty');await u.submit('form[data-form="login"]',{password});
   assert.equal(u.w.document.querySelector('form[data-form="person"]'),null);
   assert.doesNotMatch(u.w.document.querySelector('#admin').textContent,/Salva ruoli/);
   assert.match(u.w.document.querySelector('#admin').textContent,/TEST ACCESS/);
   assert.ok(u.w.document.querySelector('[data-person-access="TEST-access"]'));
 }finally{u.dom.window.close();u.db.close();}
});

test('PATTY vede archivio delle 21 squadre e salva staff collegato',async()=>{
 const u=await setup();
 try {
  await u.start();await u.click('#patty');
  await u.submit('form[data-form="login"]',{password});
  assert.equal(u.w.document.querySelectorAll('form[data-form="roster-staff"]').length,21);
  await u.submit('form[data-form="roster-staff"][data-id="12"]',{coach1:'NUOVA',coach2:'SIMONE',managers:'FEDERICO'});
  assert.equal((await statement(u.db,"SELECT coach1 FROM teams WHERE id='FIPAV:229693'").first()).coach1,'NUOVA');
 } finally {u.dom.window.close();u.db.close();}
});

test('NOVAVISION: nessun collegamento o aggiornamento automatico, inserimento manuale disponibile', async () => {
  const u = await setup();
  try {
    await statement(u.db, 'UPDATE teams SET active=0').run();
    await statement(u.db, "UPDATE teams SET name='PVI NOVAVISION',active=1 WHERE id='FIPAV:229693'").run();
    let externalRequests = 0;
    u.env.FETCH = async () => { externalRequests++; throw new Error('Nessuna fonte esterna prevista'); };
    await u.start();
    await u.click('#patty');
    await u.submit('form[data-form="login"]', { password });
    assert.equal(u.w.document.querySelector('form[data-form="roster-fipav"][data-id="1"]'), null);
    const rosterCard = u.w.document.querySelector('form[data-form="roster-staff"][data-id="1"]').closest('details');
    assert.match(rosterCard.textContent, /Gestione manuale/);
    assert.doesNotMatch(rosterCard.textContent, /Verifica e collega|Da collegare|ancora da verificare/);
    assert.ok(u.w.document.querySelector('form[data-form="roster-fipav"][data-id="2"]'));
    await u.click('[data-sync="calendar"]');
    await u.click('[data-sync="results"]');
    assert.equal(externalRequests, 0);
    await u.submit('form[data-form="manual"]', {
      team_id: 'FIPAV:229693', opponent: 'TEST OSPITE MANUALE', is_home: true,
      date: '2030-01-05', time: '18:30', venue: 'PALESTRA TEST',
      address: 'INDIRIZZO TEST', game_number: 'TEST-NOVA-MANUALE'
    });
    const row = await statement(u.db, "SELECT effective_json FROM games WHERE json_extract(effective_json, '$.game_number')='TEST-NOVA-MANUALE'").first();
    const g = row && JSON.parse(row.effective_json);
    assert.ok(g);
    assert.equal(g.home_team, 'PVI NOVAVISION');
    assert.equal(g.date, '2030-01-05');
    assert.match(u.w.document.querySelector('#games').textContent, /TEST OSPITE MANUALE/);
  } finally { u.dom.window.close(); u.db.close(); }
});

test('PATTY salva finale e sei parziali insieme, corregge e conserva Golden set', async () => {
 const u=await setup(); try {
  await saveGame(u.db,GAME,GAME,{}); await u.start(); await u.click('[data-week]'); await u.click('[data-open]');
  const f='form[data-form="result"]'; assert.equal(u.w.document.querySelector(f),null);
  await u.click('#close-dialog'); await u.click('#patty'); await u.submit('form[data-form="login"]',{password}); await u.click('[data-open]');
  assert.equal(u.w.document.querySelectorAll(f+' input').length,14);
  const values={home_sets:'3',away_sets:'2'};
  for(let n=1;n<=6;n++){values['set_'+n+'_home']=n>=5?'15':'25';values['set_'+n+'_away']=n>=5?'12':'20';}
  const read=async()=>JSON.parse((await statement(u.db,'SELECT effective_json FROM games WHERE game_key=?',GAME.game_key).first()).effective_json);
  await u.submit(f,values);let g=await read();
  assert.equal(g.played,true);assert.equal(g.home_sets,3);assert.equal(g.away_sets,2);assert.equal(g.sets.length,6);assert.equal(g.sets[5].number,6);
  assert.equal(u.w.document.querySelector(f+' [name="set_6_home"]').value,'15');
  await u.submit(f,{set_2_away:''});assert.match(u.w.document.querySelector('#dialog-message').textContent,/Completa entrambi/);assert.equal((await read()).sets.length,6);
  await u.submit(f,{away_sets:'0',set_2_away:'20',set_4_home:'',set_4_away:'',set_5_home:'',set_5_away:'',set_6_away:'13'});
  g=await read();assert.equal(g.away_sets,0);assert.equal(g.sets.length,4);assert.equal(g.sets[3].number,6);assert.equal(g.sets[3].away,13);
  assert.equal(u.w.document.querySelector(f+' [name="set_4_home"]').value,'');assert.equal(u.w.document.querySelector(f+' [name="set_6_away"]').value,'13');
  await u.click('#close-dialog');await u.click('#patty');await u.click('[data-open]');
  assert.equal(u.w.document.querySelector(f),null);assert.match(u.w.document.querySelector('#dialog-content').textContent,/3 – 0/);assert.match(u.w.document.querySelector('#dialog-content').textContent,/Golden set 15–13/);
 }finally{u.dom.window.close();u.db.close();}
});

test('PATTY modifica staff da scheda: questa gara e per sempre',async()=>{
 const u=await setup();
 try {
  await saveGame(u.db,GAME,GAME,{});
  await u.start(); await u.click('#patty');
  await u.submit('form[data-form="login"]',{password});
  await u.click('[data-week]'); await u.click('[data-open]');
  const form='form[data-form="game-staff"]';
  assert.ok(u.w.document.querySelector(form));
  await u.submit(form,{coach1:'ALLENATORE OGGI',coach2:'',managers:'DIRIGENTE OGGI',scope:'match'});
  assert.match(u.w.document.querySelector('#dialog-content').textContent,/ALLENATORE OGGI/);
  assert.ok(u.w.document.querySelector('[data-staff-reset]'));
  await u.submit(form,{coach1:'ALLENATORE SEMPRE',coach2:'VICE',managers:'DIRIGENTE SEMPRE',scope:'permanent'});
  assert.equal((await statement(u.db,'SELECT coach1 FROM teams WHERE id=?',GAME.team_id).first()).coach1,'ALLENATORE SEMPRE');
  assert.match(u.w.document.querySelector('#dialog-content').textContent,/DIRIGENTE SEMPRE/);
  assert.equal(u.w.document.querySelector('[data-staff-reset]'),null);
 }finally { u.dom.window.close(); u.db.close(); }
});
