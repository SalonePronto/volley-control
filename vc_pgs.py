"""Public PGS Milano adapter. Called only by the organizer's sync button.

API routes and field names follow the portal's public React client.
No calendar snapshots or personal contact details are bundled with the app.
"""
import requests
from vc_core import PGS_TEAM, SEASON, clean, parse_date, parse_time

BASE = 'https://volley.pgsmilano.org/api'
COMPETITION = 'invernale_2026-2027'
TEAM_ID = PGS_TEAM['team_id']


def _rows(payload, label):
    if not isinstance(payload, list) or any(not isinstance(x, dict) for x in payload):
        raise ValueError(f'PGS: formato {label} non riconosciuto. Archivio precedente conservato.')
    return payload


def normalize_pgs(matches, teams, team=None):
    team = team or PGS_TEAM
    team_id = str(team['team_id'])
    competition = team.get('competition', COMPETITION)
    season = team.get('season', SEASON)
    category = team['category']
    matches = _rows(matches, 'calendario')
    teams = _rows(teams, 'squadre')
    names = {clean(t.get('id') or t.get('_id')): t for t in teams}
    ours = names.get(team_id)
    if not ours or clean(ours.get('nomeSquadra')).upper() != team['team_name'] or ours.get('categoria') != category:
        raise ValueError('PGS: identità U11 PVI ARDOR 2K GIUSSANO non confermata.')
    result, pending, seen = [], [], set()
    for entry in matches:
        home_id, away_id = clean(entry.get('squadraCasaID')), clean(entry.get('squadraTrasfertaID'))
        if team_id not in (home_id, away_id):
            continue
        if entry.get('codiceCampionato') and entry['codiceCampionato'] != competition:
            raise ValueError('PGS: calendario di un campionato diverso da quello richiesto.')
        if entry.get('categoria') != category:
            raise ValueError('PGS: categoria gara diversa da U11.')
        official_id = clean(entry.get('id') or entry.get('_id'))
        if not official_id or official_id in seen:
            raise ValueError('PGS: gara senza ID o duplicata; importazione interrotta.')
        seen.add(official_id)
        h, a = names.get(home_id), names.get(away_id)
        if not h or not a:
            raise ValueError('PGS: denominazione di una squadra non disponibile.')
        # PGS uses a game-specific complete address when available, otherwise
        # the home team's registered venue. Never apply a pending move proposal.
        venue_data = entry if entry.get('indirizzo') and entry.get('citta') else h
        address = ' - '.join(clean(venue_data.get(k)) for k in ('indirizzo', 'citta') if clean(venue_data.get(k)))
        hs, aws = entry.get('setVintiCasa'), entry.get('setVintiTrasferta')
        played = type(hs) is int and type(aws) is int
        pa, pb = entry.get('parzialiCasa') or [], entry.get('parzialiTrasferta') or []
        if len(pa) != len(pb):
            raise ValueError('PGS: parziali incompleti; dati precedenti conservati.')
        sets = [{'home':int(x), 'away':int(y)} for x,y in zip(pa,pb) if x is not None and y is not None and x != '' and y != '']
        home = home_id == team_id
        game = dict(
            game_key=f'PGS:{season}:{competition}:{official_id}', source='PGS Milano',
            season=season, competition=competition, group_id=clean(entry.get('girone')),
            official_id=official_id, game_number=clean(entry.get('numeroGara')),
            category=category, our_team_id=team_id, our_team_name=team['team_name'],
            home_team=clean(h.get('nomeSquadra')), away_team=clean(a.get('nomeSquadra')),
            is_home=home, date=parse_date(entry['data']) if entry.get('data') else '',
            time=parse_time(entry['ora']) if entry.get('ora') else '',
            venue=clean(venue_data.get('presso')) or 'Palestra non indicata', address=address,
            played=played, home_sets=hs if played else None, away_sets=aws if played else None,
            sets=sets, notes='', required_referees=1 if home else 0,
            required_scorers=1 if home else 0, hidden=False,
            source_url='https://volley.pgsmilano.org/calendari')
        if not game['date'] or not game['time']:
            pending.append(game)
        else:
            result.append(game)
    if not seen:
        raise ValueError('PGS: nessuna gara trovata per la squadra; nessun dato cancellato.')
    return result, pending


def download_pgs(session=None, team=None):
    team = team or PGS_TEAM
    team_id = str(team['team_id'])
    competition = team.get('competition', COMPETITION)
    category = team['category']
    requester = session or requests
    def get(path):
        response = requester.get(f'{BASE}/{path}', timeout=30, headers={'Accept':'application/json','User-Agent':'VolleyControl/0.5'})
        response.raise_for_status()
        return response.json()
    # Metadata is validated before any calendar request. Only sports fields
    # from the public registrations are used; contacts are never saved.
    teams = get(f'iscrizioni/campionato/{competition}')
    names = _rows(teams, 'squadre')
    ours = [t for t in names if clean(t.get('id') or t.get('_id')) == team_id]
    if len(ours) != 1 or ours[0].get('categoria') != category or clean(ours[0].get('nomeSquadra')).upper() != team['team_name']:
        raise ValueError('PGS: squadra richiesta non confermata per questa stagione.')
    matches = get(f'calendari/campionato/{competition}')
    return normalize_pgs(matches, names, team=team)
