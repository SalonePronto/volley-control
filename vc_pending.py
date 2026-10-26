"""Primary-data alerts, shared through the same configured application DB.

The preview DB remains explicitly temporary until DATABASE_URL is configured.
A failed source request must never clear its last valid alert list.
"""
import json
from sqlalchemy import text

PENDING_RELEASE = '2026-10-26.4'


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
        scheduled=cx.execute(text('SELECT game_key,official_json,overrides_json FROM games')).mappings().all()
    completed=set()
    for row in scheduled:
        effective={**json.loads(row['official_json']), **json.loads(row['overrides_json'])}
        if effective.get('date') and effective.get('time'):
            completed.add(row['game_key'])
    # Both teams can be followed: a match is still just one primary-data alert.
    unique={}
    for row in rows:
        game=json.loads(row)
        key=game['game_key']
        if key not in completed and (key not in unique or game.get('is_home')):
            unique[key]=game
    return list(unique.values())


def complete_pending(engine, game_key, date_value, time_value, reason=""):
    """Promote one real source match atomically; retain PATTY overrides and audit.

    Nothing is invented: identifiers, teams and venue come from the pending feed.
    Raw pending rows remain available to reconcile subsequent source refreshes.
    """
    from vc_core import parse_date, parse_time
    from vc_storage import utcnow, effective
    if not str(date_value or '').strip() or not str(time_value or '').strip():
        raise ValueError("Indica sia la data sia l'ora prima di inserire la gara nel calendario.")
    try:
        date = parse_date(date_value)
    except ValueError:
        raise ValueError("Data non valida. Usa GG/MM/AAAA, ad esempio 31/10/2026.") from None
    try:
        hour = parse_time(time_value)
    except ValueError:
        raise ValueError("Ora non valida. Usa HH:MM, ad esempio 14:30.") from None
    init_pending(engine)
    now = utcnow()
    with engine.begin() as cx:
        lock = " FOR UPDATE" if engine.dialect.name == "postgresql" else ""
        rows = cx.execute(text('SELECT data_json FROM pending_games WHERE game_key=:key ORDER BY scope' + lock),
                          {'key': game_key}).scalars().all()
        if not rows:
            raise ValueError("La gara non è più tra quelle incomplete. Aggiorna la pagina.")
        candidates = [json.loads(row) for row in rows]
        game = next((g for g in candidates if g.get('is_home')), candidates[0])
        current = cx.execute(text('SELECT official_json, overrides_json FROM games WHERE game_key=:key' + lock),
                             {'key': game_key}).mappings().first()
        official = json.loads(current['official_json']) if current else game
        overrides = json.loads(current['overrides_json']) if current else {}
        previous = effective(official, overrides)
        if current and previous.get('date') and previous.get('time'):
            raise ValueError("La gara è già nel calendario. Per correggerla apri Vedi scheda.")
        overrides.update(date=date, time=hour)
        if current:
            cx.execute(text('UPDATE games SET overrides_json=:data, updated_at=:now WHERE game_key=:key'),
                       dict(key=game_key, data=json.dumps(overrides, ensure_ascii=False), now=now))
        else:
            cx.execute(text('''INSERT INTO games
              (game_key,source,season,official_json,overrides_json,created_at,updated_at)
              VALUES(:key,:source,:season,:official,:overrides,:now,:now)'''),
              dict(key=game_key, source=game['source'], season=game['season'],
                   official=json.dumps(game, ensure_ascii=False),
                   overrides=json.dumps(overrides, ensure_ascii=False), now=now))
        for field, value in (('date', date), ('time', hour)):
            cx.execute(text('''INSERT INTO game_audit
              (game_key,field,old_value,new_value,actor,changed_at,note)
              VALUES(:key,:field,:old,:new,'PATTY',:now,:reason)'''),
              dict(key=game_key, field=field, old=json.dumps(previous.get(field)),
                   new=json.dumps(value), now=now,
                   reason=reason.strip() or 'Completamento data e ora da gara incompleta'))
    return effective(official, overrides)
