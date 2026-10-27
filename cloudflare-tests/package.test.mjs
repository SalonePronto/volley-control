import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { LocalD1 } from './db.mjs';
import { saveGame, statement, exportBackup } from '../worker/index.mjs';
import { backupSQL } from '../scripts/backup-to-sql.mjs';

test('pacchetto connettore: Worker singolo, hash verificabili, D1 vuoto senza dati fittizi', async () => {
  const root = new URL('../cloudflare/', import.meta.url),
    manifest = JSON.parse(await readFile(new URL('release.json', root), 'utf8'));
  const worker = await readFile(new URL('worker.mjs', root), 'utf8'),
    schema = await readFile(new URL('schema.sql', root), 'utf8'),
    queries = JSON.parse(await readFile(new URL('d1-statements.json', root), 'utf8'));
  assert.equal(createHash('sha256').update(worker).digest('hex'), manifest.worker.sha256);
  assert.equal(createHash('sha256').update(schema).digest('hex'), manifest.schema.sha256);
  assert.equal(manifest.production_deployment_authorized, false);
  assert.equal(manifest.bindings.find((b) => b.name === 'REGISTRATION_ENABLED').value, 'false');
  assert.ok(!/^import\s/m.test(worker));
  assert.equal((worker.match(/^export default/gm) || []).length, 1);
  assert.equal(manifest.migrations.length, 6);
  assert.equal(queries.length, manifest.statements.count);
  const db = new DatabaseSync(':memory:');
  for (const q of queries) {
    assert.deepEqual(q.params, []);
    db.exec(q.sql);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM teams').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM games').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM people').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM assignments').get().n, 0);
  assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get().v, 6);
  db.close();
});

test('backup SQL per archivi grandi: ripristino isolato e apostrofi sicuri', async () => {
  const source = new LocalD1(),
    target = new LocalD1();
  for (let i = 0; i < 650; i++) {
    const g = {
      game_key: 'TEST:sql:' + i,
      team_id: 'FIPAV:229693',
      source: 'FIPAV',
      season: '2030-2031',
      group_id: '63945',
      date: '2030-01-05',
      time: '18:00',
      is_home: true,
      hidden: false,
      required_referees: 1,
      required_scorers: 1,
      home_team: "TEST L'APOSTROFO '; DROP TABLE people; --",
      away_team: 'TEST OSPITE',
    };
    await saveGame(source, g, g, {});
  }
  const backup = await exportBackup(source);
  target.db.exec(await backupSQL(backup));
  assert.equal((await statement(target, 'SELECT count(*) n FROM games').first()).n, 650);
  assert.equal((await statement(target, 'SELECT count(*) n FROM people').first()).n, 0);
  assert.equal(
    JSON.parse(
      (await statement(target, 'SELECT effective_json FROM games LIMIT 1').first()).effective_json,
    ).home_team,
    "TEST L'APOSTROFO '; DROP TABLE people; --",
  );
  assert.deepEqual((await statement(target, 'PRAGMA foreign_key_check').all()).results, []);
  assert.equal(
    (await statement(target, "SELECT count(*) n FROM sqlite_master WHERE type='trigger'").first())
      .n,
    6,
  );
  source.close();
  target.close();
});
