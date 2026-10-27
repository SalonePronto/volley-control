CREATE TABLE restore_jobs(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,triggers_json TEXT NOT NULL,
 offset INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
