import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export class LocalD1 {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    this.db.exec(
      readFileSync(new URL('../migrations/0002_sync_jobs.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../migrations/0003_game_versions.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../migrations/0004_recovery_jobs.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../migrations/0005_write_guards.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('../migrations/0006_cancellation_guards.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(readFileSync(new URL('../migrations/0007_open_registration_roles.sql', import.meta.url), 'utf8'));
    this.db.exec(readFileSync(new URL('../migrations/0008_federal_assignments.sql', import.meta.url), 'utf8'));
    this.db.exec(readFileSync(new URL('../migrations/0009_team_roster.sql', import.meta.url),'utf8'));
    this.calls = 0;
  }
  prepare(sql) {
    const db = this;
    return {
      bind(...p) {
        return {
          async first() {
            db.calls++;
            return db.db.prepare(sql).get(...p) || null;
          },
          async all() {
            db.calls++;
            return { results: db.db.prepare(sql).all(...p), success: true, meta: {} };
          },
          async run() {
            db.calls++;
            const r = db.db.prepare(sql).run(...p);
            return {
              success: true,
              meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
            };
          },
          sql,
          p,
        };
      },
    };
  }
  async batch(q) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = [];
      for (const x of q) {
        this.calls++;
        const r = this.db.prepare(x.sql).run(...x.p);
        out.push({ success: true, meta: { changes: Number(r.changes) } });
      }
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
