import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BACKUP_TABLES } from '../worker/index.mjs';
import { splitMigration } from './package-release.mjs';

const GUARDED = ['booking_guard', 'game_retime_guard', 'audit_booking', 'audit_cancellation'];
function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value !== 'string' || value.includes('\0'))
    throw new Error('Valore backup non supportato.');
  return "'" + value.replaceAll("'", "''") + "'";
}
export async function backupSQL(backup) {
  if (backup?.format !== 'volley-control-backup' || backup.version !== 1 || !backup.data)
    throw new Error('Backup non riconosciuto.');
  const migration = await readFile(
    new URL('../migrations/0001_initial.sql', import.meta.url),
    'utf8',
  );
  const guards = splitMigration(migration).filter((sql) =>
    GUARDED.some((name) => sql.startsWith('CREATE TRIGGER ' + name + ' ')),
  );
  if (guards.length !== 4) throw new Error('Guardie dello schema non trovate.');
  const lines = [
    '-- DATI RISERVATI: usare soltanto su un DB DI RECUPERO VUOTO con schema applicato.',
    '-- Non eseguire sul database attivo, su Streamlit o su Salone Pronto.',
    ...GUARDED.map((name) => 'DROP TRIGGER ' + name + ';'),
  ];
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.data[table])) throw new Error('Backup incompleto: ' + table);
    for (const row of backup.data[table]) {
      const keys = Object.keys(row);
      if (!keys.length || keys.some((key) => !/^[a-z_][a-z_0-9]*$/.test(key)))
        throw new Error('Colonne non valide.');
      lines.push(
        `INSERT ${table === 'teams' ? 'OR REPLACE ' : ''}INTO ${table}(${keys.join(',')}) VALUES(${keys.map((k) => literal(row[k])).join(',')});`,
      );
    }
  }
  lines.push(...guards, 'PRAGMA foreign_key_check;');
  return lines.join('\n') + '\n';
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      'Uso tecnico: node scripts/backup-to-sql.mjs FILE_PRIVATO_JSON FILE_PRIVATO_SQL',
    );
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const dest = resolve(output),
    rel = relative(root, dest);
  if (!rel.startsWith('..') && !rel.startsWith('/'))
    throw new Error('Il backup SQL deve restare fuori dal repository pubblico.');
  await writeFile(dest, await backupSQL(JSON.parse(await readFile(input, 'utf8'))), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log('Backup SQL privato generato. Nessun caricamento o ripristino remoto eseguito.');
}
