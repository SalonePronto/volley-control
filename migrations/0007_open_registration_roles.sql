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
