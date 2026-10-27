import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function splitMigration(sql) {
  const statements = [];
  let rest = sql.trim();
  while (rest) {
    let end;
    if (rest.startsWith('CREATE TRIGGER')) {
      const match = /^END;/m.exec(rest);
      if (!match) throw new Error('Trigger SQL incompleto.');
      end = match.index + 4;
    } else end = rest.indexOf(';') + 1;
    if (!end) throw new Error('Migrazione senza terminatore SQL.');
    statements.push(rest.slice(0, end));
    rest = rest.slice(end).trim();
  }
  return statements;
}

export async function packageRelease() {
  await mkdir('cloudflare', { recursive: true });
  const worker = await readFile('dist/worker.mjs', 'utf8');
  const files = (await readdir('migrations')).filter((p) => /^\d+.*\.sql$/.test(p)).sort();
  const migrations = [],
    statements = [],
    sqlParts = [];
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  for (const file of files) {
    const sql = await readFile('migrations/' + file, 'utf8');
    const queries = splitMigration(sql);
    migrations.push({ file, sha256: digest(sql), statements: queries.length });
    statements.push(...queries.map((sql) => ({ migration: file, sql, params: [] })));
    sqlParts.push('-- ' + file + '\n' + sql);
  }
  const schema = sqlParts.join('\n');
  await writeFile('cloudflare/worker.mjs', worker);
  await writeFile('cloudflare/schema.sql', schema);
  await writeFile('cloudflare/d1-statements.json', JSON.stringify(statements, null, 2) + '\n');
  const manifest = {
    application: 'VOLLEY CONTROL',
    environment: 'staging',
    release: /const RELEASE = '([^']+)'/.exec(worker)?.[1],
    source_base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    target_worker: 'volley-control-dev',
    target_database: 'volley-control-dev-db',
    account_id: 'be2a6531623a2d7500aabcf3a6efe5ce',
    production_deployment_authorized: false,
    cloudflare_connection:
      'Gestita separatamente tramite connettore; nessun accesso browser richiesto.',
    worker: {
      path: 'cloudflare/worker.mjs',
      main_module: 'worker.mjs',
      sha256: digest(worker),
      bytes: Buffer.byteLength(worker),
    },
    schema: { path: 'cloudflare/schema.sql', sha256: digest(schema), fresh_database_only: true },
    statements: {
      path: 'cloudflare/d1-statements.json',
      count: statements.length,
      max_per_api_batch: 15,
    },
    migrations,
    bindings: [
      { name: 'DB', type: 'd1', id: 'DA_CREARE_NELL_ALTRA_CHAT' },
      { name: 'ENVIRONMENT', type: 'plain_text', value: 'staging' },
      { name: 'REGISTRATION_ENABLED', type: 'plain_text', value: 'false' },
      { name: 'FREE_PLAN_VERIFIED', type: 'plain_text', value: 'false' },
      { name: 'PASSWORD_PEPPER', type: 'secret_text', value: 'DA_CONFIGURARE_CON_CANALE_SICURO' },
      { name: 'PATTY_HASH', type: 'secret_text', value: 'DA_CONFIGURARE_CON_CANALE_SICURO' },
    ],
  };
  if (!manifest.release) throw new Error('Versione del Worker non trovata.');
  await writeFile('cloudflare/release.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `Pacchetto connettore pronto: ${manifest.release}, ${statements.length} istruzioni D1. Nessuna pubblicazione eseguita.`,
  );
  return manifest;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  await packageRelease();
