"""Primary-data alerts, shared through the same configured application DB.

The preview DB remains explicitly temporary until DATABASE_URL is configured.
A failed source request must never clear its last valid alert list.
"""
import json
from sqlalchemy import text


def init_pending(engine):
    with engine.begin() as cx:
        cx.execute(text('''CREATE TABLE IF NOT EXISTS pending_games (
          scope VARCHAR(220) NOT NULL, game_key VARCHAR(220) NOT NULL,
          data_json TEXT NOT NULL, PRIMARY KEY(scope,game_key))'''))


def save_pending(engine, scope, games):
    """Replace only a successfully retrieved team's complete pending set."""
    init_pending(engine)
    with engine.begin() as cx:
        cx.execute(text('DELETE FROM pending_games WHERE scope=:scope'), {'scope':scope})
        for game in games:
            cx.execute(text('''INSERT INTO pending_games(scope,game_key,data_json)
              VALUES(:scope,:key,:data)'''),
              dict(scope=scope,key=game['game_key'],data=json.dumps(game,ensure_ascii=False)))


def list_pending(engine):
    init_pending(engine)
    with engine.connect() as cx:
        rows=cx.execute(text('SELECT data_json FROM pending_games ORDER BY scope,game_key')).scalars().all()
    # Both teams can be followed: a match is still just one primary-data alert.
    unique={}
    for row in rows:
        game=json.loads(row)
        unique[game['game_key']]=game
    return list(unique.values())
