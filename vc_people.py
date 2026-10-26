"""Shared people, roles, staff and conflict-safe officiating assignments.

Accounts and assignments should be enabled only with a persistent DATABASE_URL.
"""
import hashlib
import hmac
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import text
from vc_storage import list_games, utcnow

ROME = ZoneInfo('Europe/Rome')
DURATION_MINUTES = 120  # conservative planning window; adjustable per game later
ROLES = {'referee': 'Arbitro', 'scorer': 'Refertista'}


def init_people(engine):
    with engine.begin() as cx:
        cx.execute(text('''CREATE TABLE IF NOT EXISTS people (
           id VARCHAR(32) PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
           first_name VARCHAR(120) NOT NULL, last_name VARCHAR(120) NOT NULL,
           hash_password VARCHAR(255) NOT NULL, wants_referee BOOLEAN NOT NULL,
           wants_scorer BOOLEAN NOT NULL, approved BOOLEAN NOT NULL DEFAULT FALSE,
           created_at VARCHAR(40) NOT NULL)'''))
        cx.execute(text('''CREATE TABLE IF NOT EXISTS team_staff (
           team_id VARCHAR(60) PRIMARY KEY, coach1 TEXT NOT NULL DEFAULT '',
           coach2 TEXT NOT NULL DEFAULT '', managers TEXT NOT NULL DEFAULT '')'''))
        cx.execute(text('''CREATE TABLE IF NOT EXISTS team_fixed (
           team_id VARCHAR(60) NOT NULL, role VARCHAR(15) NOT NULL,
           person_id VARCHAR(32) NOT NULL, PRIMARY KEY(team_id,role))'''))
        cx.execute(text('''CREATE TABLE IF NOT EXISTS assignments (
           game_key VARCHAR(220) NOT NULL, role VARCHAR(15) NOT NULL, slot INTEGER NOT NULL,
           person_id VARCHAR(32) NOT NULL, source VARCHAR(20) NOT NULL,
           created_at VARCHAR(40) NOT NULL, PRIMARY KEY(game_key,role,slot))'''))
        cx.execute(text('''CREATE TABLE IF NOT EXISTS fixed_exceptions (
           game_key VARCHAR(220) NOT NULL, role VARCHAR(15) NOT NULL,
           PRIMARY KEY(game_key,role))'''))
        cx.execute(text('''CREATE TABLE IF NOT EXISTS personnel_audit (
           id VARCHAR(32) PRIMARY KEY, actor TEXT NOT NULL,
           action TEXT NOT NULL, details TEXT NOT NULL, changed_at VARCHAR(40) NOT NULL)'''))


def _password_hash(password):
    if len(password) < 12:
        raise ValueError('La password deve contenere almeno 12 caratteri.')
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 400_000)
    return f'pbkdf2_sha256:400000:{salt.hex()}:{digest.hex()}'


def _verify_password(password, record):
    try:
        _, cycles, salt, expected = record.split(':')
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), int(cycles))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, AttributeError):
        return False


def register(engine, first, last, email, password, ref, scorer):
    from uuid import uuid4
    first, last, email = first.strip(), last.strip(), email.strip().lower()
    if not first or not last or '@' not in email or email.startswith('@') or not (ref or scorer):
        raise ValueError('Inserisci nome, cognome, email e almeno un ruolo.')
    pwd_hash = _password_hash(password)
    person_id = uuid4().hex
    with engine.begin() as cx:
        try:
            cx.execute(text('''INSERT INTO people
              (id,email,first_name,last_name,hash_password,wants_referee,wants_scorer,approved,created_at)
              VALUES (:id,:email,:first,:last,:pwd,:ref,:scorer,FALSE,:at)'''),
              dict(id=person_id,email=email,first=first,last=last,pwd=pwd_hash,ref=ref,scorer=scorer,at=utcnow()))
        except Exception as exc:
            # Prevent leaking SQL exception details from the UI.
            raise ValueError('Email già registrata o dati non validi.') from exc
    return person_id


def authenticate(engine, email, password):
    with engine.connect() as cx:
        person = cx.execute(text('SELECT * FROM people WHERE email=:email'),
                            {'email':email.strip().lower()}).mappings().first()
    if not person or not _verify_password(password, person['hash_password']):
        return None
    result={k: v for k, v in dict(person).items() if k != 'hash_password'}
    for k in ('approved','wants_referee','wants_scorer'):
        result[k]=bool(result[k])
    return result


def people(engine, approved_only=False):
    with engine.connect() as cx:
        rows=[dict(x) for x in cx.execute(text('''SELECT id,email,first_name,last_name,
          wants_referee,wants_scorer,approved,created_at FROM people
          WHERE (:approved=FALSE OR approved=TRUE) ORDER BY last_name,first_name'''),
          {'approved':approved_only}).mappings()]
    for item in rows:
        for k in ('approved','wants_referee','wants_scorer'):
            item[k]=bool(item[k])
    return rows


def approval(engine, person_id, approved):
    with engine.begin() as cx:
        updated=cx.execute(text('UPDATE people SET approved=:approved WHERE id=:id'),
                           {'approved':approved,'id':person_id})
        if updated.rowcount != 1:
            raise ValueError('Persona non trovata.')
        _audit(cx,'PATTY','approval',f'{person_id}:{approved}')


def _audit(cx, actor, action, details):
    from uuid import uuid4
    cx.execute(text('''INSERT INTO personnel_audit (id,actor,action,details,changed_at)
      VALUES (:id,:actor,:action,:details,:at)'''),
      {'id':uuid4().hex,'actor':actor,'action':action,'details':details,'at':utcnow()})


def team_staff(engine, team_id):
    with engine.connect() as cx:
        row=cx.execute(text('SELECT * FROM team_staff WHERE team_id=:id'),{'id':str(team_id)}).mappings().first()
    return dict(row) if row else {'coach1':'','coach2':'','managers':''}


def update_team_staff(engine, team_id, coach1, coach2, managers):
    with engine.begin() as cx:
        cx.execute(text('DELETE FROM team_staff WHERE team_id=:id'),{'id':str(team_id)})
        cx.execute(text('''INSERT INTO team_staff (team_id,coach1,coach2,managers)
           VALUES (:id,:c1,:c2,:mgr)'''),dict(id=str(team_id),c1=coach1.strip(),c2=coach2.strip(),mgr=managers.strip()))
        _audit(cx,'PATTY','team_staff',str(team_id))


def fixed_for_team(engine, team_id):
    with engine.connect() as cx:
        records=cx.execute(text('SELECT role,person_id FROM team_fixed WHERE team_id=:id'),{'id':str(team_id)}).mappings().all()
    return {row['role']:row['person_id'] for row in records}


def set_fixed(engine, team_id, role, person_id):
    if role not in ROLES:
        raise ValueError('Ruolo non valido.')
    # Changing a team's fixed appointee updates all *future* automatic seats;
    # individually booked or PATTY-assigned seats remain untouched.
    future_keys=[g['game_key'] for g in list_games(engine)
                 if g['is_home'] and str(g.get('our_team_id'))==str(team_id)
                 and g['date']>=datetime.now(ROME).date().isoformat()]
    with engine.begin() as cx:
        if person_id:
            row=cx.execute(text('SELECT * FROM people WHERE id=:id'),{'id':person_id}).mappings().first()
            if not row or not row['approved'] or not row['wants_'+role]:
                raise ValueError('Persona non abilitata per questo ruolo.')
        cx.execute(text('DELETE FROM team_fixed WHERE team_id=:id AND role=:role'),dict(id=str(team_id),role=role))
        if person_id:
            cx.execute(text('INSERT INTO team_fixed(team_id,role,person_id) VALUES (:id,:role,:pid)'),
                       dict(id=str(team_id),role=role,pid=person_id))
        for game_key in future_keys:
            cx.execute(text('''DELETE FROM assignments WHERE game_key=:game AND role=:role
              AND source='fixed' '''), {'game':game_key,'role':role})
        _audit(cx,'PATTY','team_fixed',f'{team_id}:{role}:{person_id or "removed"}')


def assignments_for_games(engine, keys):
    # Fetch all then filter; avoids expanding unsanitised SQL bind lists.
    wanted=set(keys)
    if not wanted:
        return {}
    with engine.connect() as cx:
        rows=cx.execute(text('''SELECT a.game_key,a.role,a.slot,a.person_id,a.source,
          p.first_name,p.last_name FROM assignments a JOIN people p ON p.id=a.person_id''')).mappings()
        result={}
        for item in rows:
            if item['game_key'] in wanted:
                result.setdefault(item['game_key'],[]).append(dict(item))
    return result


def _lock(cx, engine):
    if engine.dialect.name=='postgresql':
        # Serialize booking decisions across all roles/matches (small club scale).
        cx.execute(text('SELECT pg_advisory_xact_lock(20261026)'))
    elif engine.dialect.name=='sqlite':
        cx.exec_driver_sql('BEGIN IMMEDIATE')


def _interval(game):
    when=datetime.fromisoformat(f"{game['date']}T{game['time']}").replace(tzinfo=ROME)
    minutes=int(game.get('duration_minutes') or DURATION_MINUTES)
    return when,when+timedelta(minutes=minutes)


def _ensure_available(cx, person_id, game, game_map):
    target_a,target_b=_interval(game)
    rows=cx.execute(text('SELECT game_key FROM assignments WHERE person_id=:id'),{'id':person_id}).mappings()
    for row in rows:
        if row['game_key']==game['game_key']:
            raise ValueError('Questa persona è già incaricata nella partita.')
        other=game_map.get(row['game_key'])
        if other:
            a,b=_interval(other)
            if target_a<b and a<target_b:
                raise ValueError('Persona già impegnata in una partita con orario sovrapposto.')


def assign(engine, game_key, role, person_id, actor='PATTY', source='patty', slot=1):
    if role not in ROLES:
        raise ValueError('Ruolo non riconosciuto.')
    game_map={g['game_key']:g for g in list_games(engine)}
    game=game_map.get(game_key)
    if not game or not game['is_home']:
        raise ValueError('Gara non casalinga o non trovata.')
    required=int(game.get('required_referees' if role=='referee' else 'required_scorers',0))
    if not (1 <= slot <= required):
        raise ValueError('Posto non previsto per questa gara.')
    with engine.connect() as cx:
        try:
            _lock(cx,engine)
            person=cx.execute(text('SELECT * FROM people WHERE id=:id'),{'id':person_id}).mappings().first()
            if not person or not person['approved'] or not person['wants_'+role]:
                raise ValueError('Persona non abilitata per questo ruolo.')
            found=cx.execute(text('''SELECT 1 FROM assignments WHERE game_key=:game
              AND role=:role AND slot=:slot'''),dict(game=game_key,role=role,slot=slot)).first()
            if found:
                raise ValueError('Questo incarico risulta già occupato.')
            _ensure_available(cx,person_id,game,game_map)
            cx.execute(text('''INSERT INTO assignments(game_key,role,slot,person_id,source,created_at)
              VALUES(:game,:role,:slot,:person,:source,:at)'''),
              dict(game=game_key,role=role,slot=slot,person=person_id,source=source,at=utcnow()))
            _audit(cx,actor,'assigned',f'{game_key}:{role}:{slot}:{person_id}')
            cx.commit()
        except Exception:
            cx.rollback()
            raise


def cancel(engine, game_key, role, slot, actor='PATTY'):
    with engine.connect() as cx:
        try:
            _lock(cx,engine)
            row=cx.execute(text('''SELECT person_id,source FROM assignments
              WHERE game_key=:game AND role=:role AND slot=:slot'''),
              dict(game=game_key,role=role,slot=slot)).mappings().first()
            if not row:
                raise ValueError('Incarico non trovato.')
            if actor!='PATTY' and (row['person_id']!=actor or row['source']=='fixed'):
                raise ValueError('Puoi annullare soltanto una tua prenotazione.')
            cx.execute(text('DELETE FROM assignments WHERE game_key=:game AND role=:role AND slot=:slot'),
                       dict(game=game_key,role=role,slot=slot))
            if actor=='PATTY':
                cx.execute(text('DELETE FROM fixed_exceptions WHERE game_key=:game AND role=:role'),dict(game=game_key,role=role))
                cx.execute(text('INSERT INTO fixed_exceptions(game_key,role) VALUES(:game,:role)'),dict(game=game_key,role=role))
            _audit(cx,actor,'cancelled',f'{game_key}:{role}:{slot}:{row["person_id"]}')
            cx.commit()
        except Exception:
            cx.rollback()
            raise


def apply_fixed(engine):
    """Only occupy vacant slots, never replace or bypass a manual exception."""
    games=list_games(engine)
    by_key=assignments_for_games(engine,[g['game_key'] for g in games])
    with engine.connect() as cx:
        exceptions={(x['game_key'],x['role']) for x in cx.execute(text('SELECT * FROM fixed_exceptions')).mappings()}
    configured={}
    results={'created':0,'skipped':0,'conflicts':[]}
    for game in games:
        if not game['is_home']:
            continue
        team_id=str(game.get('our_team_id') or '')
        if team_id not in configured:
            configured[team_id]=fixed_for_team(engine,team_id)
        for role,pid in configured[team_id].items():
            if (game['game_key'],role) in exceptions or any(a['role']==role for a in by_key.get(game['game_key'],[])):
                results['skipped']+=1
                continue
            try:
                assign(engine,game['game_key'],role,pid,actor='PATTY-AUTO',source='fixed')
                results['created']+=1
                by_key.setdefault(game['game_key'],[]).append({'role':role})
            except ValueError as exc:
                results['conflicts'].append(f"{game['game_number'] or game['game_key']} {ROLES[role]}: {exc}")
    return results