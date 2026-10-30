-- Due accessi PATTY delegati, revocabili, associati ad account già registrati.
-- La sessione personale resta permanente anche dopo la scadenza dell'accesso PATTY.
ALTER TABLE people ADD COLUMN can_access_patty INTEGER NOT NULL DEFAULT 0 CHECK(can_access_patty IN (0,1));
ALTER TABLE sessions ADD COLUMN patty_expires_at INTEGER NOT NULL DEFAULT 0;
INSERT INTO schema_migrations VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
