CREATE TABLE cancellation_guards(
 game_key TEXT NOT NULL,role TEXT NOT NULL,slot INTEGER NOT NULL,
 person_id TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(game_key,role,slot)
);
CREATE TRIGGER cancellation_version_guard BEFORE INSERT ON cancellation_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM assignments a
 WHERE a.game_key=NEW.game_key AND a.role=NEW.role AND a.slot=NEW.slot
 AND a.person_id=NEW.person_id AND a.source=NEW.source AND a.created_at=NEW.created_at)
 THEN RAISE(ABORT,'STALE_ASSIGNMENT') END;
END;
INSERT INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
