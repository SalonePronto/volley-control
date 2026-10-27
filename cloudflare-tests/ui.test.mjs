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
  const dom = new JSDOM(html, { url: 'https://test.invalid/', runScripts: 'outside-only' }),
    w = dom.window;
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
    assert.equal(f.elements.namedItem('password').maxLength,4);
    assert.ok(f.elements.namedItem('wants_manager'));
    assert.ok(f.elements.namedItem('wants_coach'));
    await u.submit('form[data-form="register"]', {
      first_name:'MARIO',last_name:'COLLAUDO',password:'A123',
      wants_referee:true,wants_scorer:true,staging_consent:true,
    });
    assert.equal((await statement(u.db,'SELECT count(*) n FROM people').first()).n,1);
  } finally {u.dom.window.close();u.db.close();}
});

test('dirigente registrato automaticamente e prenotazione accessibile',async()=>{
 const u=await setup();try{
 await saveGame(u.db,GAME,GAME,{});await u.start();await u.click('#access');
 await u.submit('form[data-form="register"]',{first_name:'TEST',last_name:'DIRIGENTE',password:'D123',wants_manager:true,staging_consent:true});
 assert.equal((await statement(u.db,"SELECT approved FROM people WHERE last_name='DIRIGENTE'").first()).approved,1);
 assert.equal(u.w.document.querySelector('#identity').textContent,'TEST DIRIGENTE');
 await u.click('[data-open]');assert.equal(u.w.document.querySelector('[data-book][data-role="referee"]').disabled,false);
 }finally{u.dom.window.close();u.db.close();}
});
