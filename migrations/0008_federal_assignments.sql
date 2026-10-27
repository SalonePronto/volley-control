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
