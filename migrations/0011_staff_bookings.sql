-- Presenze personali di allenatori e dirigenti alle gare.
CREATE TABLE staff_bookings (
 game_key TEXT NOT NULL REFERENCES games(game_key) ON DELETE CASCADE,
 person_id TEXT NOT NULL REFERENCES people(id),
 role TEXT NOT NULL CHECK(role IN ('coach1','coach2','manager')),
 source TEXT NOT NULL CHECK(source IN ('self','patty')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(game_key,person_id)
);
CREATE UNIQUE INDEX staff_bookings_coach_slot ON staff_bookings(game_key,role) WHERE role IN ('coach1','coach2');
CREATE INDEX staff_bookings_person ON staff_bookings(person_id,game_key);
INSERT INTO schema_migrations VALUES(11,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
