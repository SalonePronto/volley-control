-- 0001_initial.sql
PRAGMA foreign_keys=ON;
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE teams (
 id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('FIPAV','PGS')),
 season TEXT NOT NULL, competition TEXT NOT NULL DEFAULT '', group_id TEXT NOT NULL DEFAULT '',
 official_team_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, short_name TEXT NOT NULL,
 coach1 TEXT NOT NULL DEFAULT '', coach2 TEXT NOT NULL DEFAULT '', managers TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 UNIQUE(source,season,competition,group_id,official_team_id)
);
INSERT INTO teams(id,source,season,group_id,official_team_id,name,category,short_name) VALUES
 ('FIPAV:229693','FIPAV','2026-2027','63945','229693','PVI STUDIO OTTOLINA','U15 Femminile','OTTOLINA'),
 ('FIPAV:229990','FIPAV','2026-2027','63942','229990','PVI PINUCCÈ','U17 Femminile','PINUCCE');
INSERT INTO teams(id,source,season,competition,group_id,official_team_id,name,category,short_name) VALUES
 ('PGS:6ab0ec072cf8134e0d68e749','PGS','2026-2027','invernale_2026-2027','4','6ab0ec072cf8134e0d68e749','PVI ARDOR 2K GIUSSANO','U11','ARDOR GIUSSANO');
CREATE TABLE people (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, wants_referee INTEGER NOT NULL CHECK(wants_referee IN(0,1)),
 wants_scorer INTEGER NOT NULL CHECK(wants_scorer IN(0,1)), approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN(0,1)),
 created_at TEXT NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
 admin INTEGER NOT NULL DEFAULT 0, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE games (
 game_key TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), source TEXT NOT NULL, season TEXT NOT NULL,
 scope TEXT NOT NULL, official_json TEXT NOT NULL CHECK(json_valid(official_json)),
 overrides_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides_json)),
 effective_json TEXT NOT NULL CHECK(json_valid(effective_json)), date TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '',
 is_home INTEGER NOT NULL CHECK(is_home IN(0,1)), hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN(0,1)),
 source_missing INTEGER NOT NULL DEFAULT 0 CHECK(source_missing IN(0,1)),
 start_ts INTEGER, end_ts INTEGER, required_referees INTEGER NOT NULL CHECK(required_referees BETWEEN 0 AND 10),
 required_scorers INTEGER NOT NULL CHECK(required_scorers BETWEEN 0 AND 10),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX games_week ON games(date,time);
CREATE INDEX games_scope ON games(scope);
CREATE INDEX games_team ON games(team_id,date);
CREATE TABLE assignments (
 game_key TEXT NOT NULL REFERENCES games(game_key) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN('referee','scorer')),
 slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10), person_id TEXT NOT NULL REFERENCES people(id),
 source TEXT NOT NULL CHECK(source IN('self','fixed','patty')), created_at TEXT NOT NULL,
 PRIMARY KEY(game_key,role,slot), UNIQUE(game_key,person_id)
);
CREATE INDEX assignments_person ON assignments(person_id,game_key);
CREATE TABLE team_fixed(team_id TEXT NOT NULL REFERENCES teams(id), role TEXT NOT NULL CHECK(role IN('referee','scorer')),
 person_id TEXT NOT NULL REFERENCES people(id), PRIMARY KEY(team_id,role));
CREATE TABLE fixed_exceptions(game_key TEXT NOT NULL REFERENCES games(game_key), role TEXT NOT NULL, PRIMARY KEY(game_key,role));
CREATE TABLE import_conflicts(game_key TEXT NOT NULL REFERENCES games(game_key), field TEXT NOT NULL,
 incoming TEXT NOT NULL, detected_at TEXT NOT NULL, PRIMARY KEY(game_key,field));
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
 game_key TEXT, details TEXT NOT NULL, changed_at TEXT NOT NULL);
CREATE INDEX audit_game ON audit(game_key,id);
CREATE TABLE sync_runs(scope TEXT PRIMARY KEY, at TEXT NOT NULL, report TEXT NOT NULL, error TEXT);
CREATE TABLE sync_locks(scope TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE usage_daily(day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0,
 requests INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER booking_guard BEFORE INSERT ON assignments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND approved=1 AND
  CASE NEW.role WHEN 'referee' THEN wants_referee ELSE wants_scorer END=1)
  THEN RAISE(ABORT,'PERSON_NOT_ELIGIBLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM games WHERE game_key=NEW.game_key AND is_home=1 AND hidden=0 AND source_missing=0
  AND start_ts IS NOT NULL AND NEW.slot <= CASE NEW.role WHEN 'referee' THEN required_referees ELSE required_scorers END)
  THEN RAISE(ABORT,'GAME_NOT_BOOKABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignments a JOIN games other ON other.game_key=a.game_key
  JOIN games target ON target.game_key=NEW.game_key WHERE a.person_id=NEW.person_id
  AND other.hidden=0 AND target.start_ts<other.end_ts AND other.start_ts<target.end_ts)
  THEN RAISE(ABORT,'TIME_CONFLICT') END;
END;
CREATE TRIGGER game_retime_guard BEFORE UPDATE OF start_ts,end_ts,is_home,required_referees,required_scorers ON games BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignments a JOIN assignments b ON a.person_id=b.person_id AND a.game_key<>b.game_key
  JOIN games other ON other.game_key=b.game_key WHERE a.game_key=NEW.game_key AND other.hidden=0 AND NEW.hidden=0
  AND NEW.start_ts<other.end_ts AND other.start_ts<NEW.end_ts)
  THEN RAISE(ABORT,'MOVE_BOOKING_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignments a WHERE a.game_key=NEW.game_key AND
  (NEW.is_home=0 OR NEW.start_ts IS NULL OR a.slot>CASE a.role WHEN 'referee' THEN NEW.required_referees ELSE NEW.required_scorers END))
  THEN RAISE(ABORT,'REMOVE_ASSIGNMENTS_FIRST') END;
END;
CREATE TRIGGER audit_booking AFTER INSERT ON assignments BEGIN
 INSERT INTO audit(actor,action,game_key,details,changed_at) VALUES(NEW.person_id,'assigned',NEW.game_key,
 json_object('role',NEW.role,'slot',NEW.slot,'source',NEW.source),NEW.created_at);
END;
CREATE TRIGGER audit_cancellation AFTER DELETE ON assignments BEGIN
 INSERT INTO audit(actor,action,game_key,details,changed_at) VALUES('system','assignment_removed',OLD.game_key,
 json_object('person_id',OLD.person_id,'role',OLD.role,'slot',OLD.slot),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- 0002_sync_jobs.sql
CREATE TABLE sync_jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,results_only INTEGER NOT NULL,
 payload_json TEXT NOT NULL,offset INTEGER NOT NULL DEFAULT 0,report_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);

-- 0003_game_versions.sql
ALTER TABLE games ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- 0004_recovery_jobs.sql
CREATE TABLE restore_jobs(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,triggers_json TEXT NOT NULL,
 offset INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 0005_write_guards.sql
CREATE TABLE write_guards(game_key TEXT PRIMARY KEY,expected_version INTEGER NOT NULL);
CREATE TRIGGER version_guard BEFORE INSERT ON write_guards BEGIN
 SELECT CASE WHEN COALESCE((SELECT version FROM games WHERE game_key=NEW.game_key),-1)<>NEW.expected_version
 THEN RAISE(ABORT,'STALE_WRITE') END;
END;
INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 0006_cancellation_guards.sql
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
-- 0007_open_registration_roles.sql
ALTER TABLE people ADD COLUMN wants_manager INTEGER NOT NULL DEFAULT 0 CHECK(wants_manager IN(0,1));
ALTER TABLE people ADD COLUMN wants_coach INTEGER NOT NULL DEFAULT 0 CHECK(wants_coach IN(0,1));
DROP TRIGGER booking_guard;
CREATE TRIGGER booking_guard BEFORE INSERT ON assignments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM people WHERE id=NEW.person_id AND approved=1)
  THEN RAISE(ABORT,'PERSON_NOT_ELIGIBLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM games WHERE game_key=NEW.game_key AND is_home=1 AND hidden=0 AND source_missing=0
  AND start_ts IS NOT NULL AND NEW.slot <= CASE NEW.role WHEN 'referee' THEN required_referees ELSE required_scorers END)
  THEN RAISE(ABORT,'GAME_NOT_BOOKABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignments a JOIN games other ON other.game_key=a.game_key
  JOIN games target ON target.game_key=NEW.game_key WHERE a.person_id=NEW.person_id
  AND other.hidden=0 AND target.start_ts<other.end_ts AND other.start_ts<target.end_ts)
  THEN RAISE(ABORT,'TIME_CONFLICT') END;
END;
INSERT INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 0008_federal_assignments.sql
-- Federali per singola gara, mantenuti in overrides_json della partita.
CREATE TRIGGER federal_booking_guard BEFORE INSERT ON assignments
WHEN EXISTS (
 SELECT 1 FROM games WHERE game_key=NEW.game_key AND
 CASE NEW.role WHEN 'referee' THEN json_extract(effective_json,'$.federal_referee')
               ELSE json_extract(effective_json,'$.federal_scorer') END = 1
)
BEGIN SELECT RAISE(ABORT,'FEDERAL_SLOT'); END;
-- Un ruolo non può diventare federale finché ci sono incarichi già presenti.
CREATE TRIGGER federal_game_guard BEFORE UPDATE OF effective_json ON games
WHEN EXISTS (
 SELECT 1 FROM assignments WHERE game_key=NEW.game_key AND
 ((role='referee' AND json_extract(NEW.effective_json,'$.federal_referee')=1) OR
  (role='scorer' AND json_extract(NEW.effective_json,'$.federal_scorer')=1))
)
BEGIN SELECT RAISE(ABORT,'FEDERAL_CONFLICT'); END;
INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
