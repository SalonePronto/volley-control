CREATE TABLE write_guards(game_key TEXT PRIMARY KEY,expected_version INTEGER NOT NULL);
CREATE TRIGGER version_guard BEFORE INSERT ON write_guards BEGIN
 SELECT CASE WHEN COALESCE((SELECT version FROM games WHERE game_key=NEW.game_key),-1)<>NEW.expected_version
 THEN RAISE(ABORT,'STALE_WRITE') END;
END;
INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
