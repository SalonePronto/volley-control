"""Organizer-chosen short names; official feed names and match IDs stay intact."""
from sqlalchemy import text

DEFAULT_NAMES = {
    ('FIPAV', '229693'): 'OTTOLINA',
    ('FIPAV', '229990'): 'PINUCCE',
    ('PGS', '6ab0ec072cf8134e0d68e749'): 'ARDOR GIUSSANO',
}


def name_key(source, team_id):
    return ('PGS' if 'PGS' in str(source).upper() else str(source).upper(), str(team_id))


def init_team_names(engine):
    with engine.begin() as cx:
        cx.execute(text('''CREATE TABLE IF NOT EXISTS team_display_names (
          source VARCHAR(32) NOT NULL, team_id VARCHAR(120) NOT NULL,
          short_name TEXT NOT NULL, PRIMARY KEY(source,team_id))'''))


def display_names(engine):
    init_team_names(engine)
    with engine.connect() as cx:
        rows=cx.execute(text('SELECT source,team_id,short_name FROM team_display_names')).mappings().all()
    return {**DEFAULT_NAMES, **{(r['source'],r['team_id']):r['short_name'] for r in rows}}


def short_name_for(game, names):
    return names.get(name_key(game['source'], game.get('our_team_id', '')),
                     game.get('our_team_name') or game['home_team' if game['is_home'] else 'away_team'])


def save_display_name(engine, source, team_id, value):
    value=' '.join(value.split())
    if not value:
        raise ValueError('Indica un nome breve riconoscibile per la squadra.')
    init_team_names(engine)
    source,team_id=name_key(source,team_id)
    with engine.begin() as cx:
        cx.execute(text('DELETE FROM team_display_names WHERE source=:source AND team_id=:id'),dict(source=source,id=team_id))
        cx.execute(text('INSERT INTO team_display_names(source,team_id,short_name) VALUES(:source,:id,:name)'),
                   dict(source=source,id=team_id,name=value))
