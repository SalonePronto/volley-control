"""Isolated synthetic API cases; no live calendar requests or production data."""
from copy import deepcopy
import pytest
from vc_pgs import TEAM_ID, COMPETITION, normalize_pgs, download_pgs
from vc_core import week_start
from vc_storage import save_import, list_games, modify_game
from test_dashboard import GAME, db

TEAMS = [dict(id=TEAM_ID, nomeSquadra='PVI ARDOR 2K GIUSSANO', categoria='U11',
              presso='TEST palestra',indirizzo='TEST indirizzo',citta='TEST città'),
         dict(id='TEST-opponent',nomeSquadra='TEST avversaria',categoria='U11')]
MATCH = dict(id='TEST-match',codiceCampionato=COMPETITION,categoria='U11',girone='4',
             squadraCasaID=TEAM_ID,squadraTrasfertaID='TEST-opponent',
             numeroGara='TEST-number',data='07/11/2026',ora='17:00')


def test_filter_identity_and_merge_weeks_preserving_overrides(db):
    irrelevant = {**MATCH, 'id':'TEST-unrelated', 'squadraCasaID':'TEST-other'}
    games, pending = normalize_pgs([MATCH, irrelevant], TEAMS)
    assert len(games) == 1 and not pending
    game = games[0]
    assert week_start(game['date']) == week_start(GAME['date'])
    assert save_import(db, games)['inserted'] == 1
    modify_game(db,game['game_key'],'venue','TEST correzione')
    assert save_import(db,games)['unchanged'] == 1
    merged = list_games(db)
    assert len(merged) == 2 and {g['source'] for g in merged} == {'FIPAV','PGS Milano'}
    assert next(g for g in merged if g['source']=='PGS Milano')['venue'] == 'TEST correzione'
    changed = {**MATCH,'data':'14/11/2026'}
    updated, _ = normalize_pgs([changed], TEAMS)
    assert updated[0]['game_key'] == game['game_key']
    assert save_import(db,updated)['updated'] == 1 and len(list_games(db)) == 2


def test_invalid_feed_rejected_pending_explicit():
    with pytest.raises(ValueError,match='duplicata'):
        normalize_pgs([MATCH,MATCH],TEAMS)
    with pytest.raises(ValueError,match='categoria'):
        normalize_pgs([{**MATCH,'categoria':'U12'}],TEAMS)
    games,pending=normalize_pgs([{**MATCH,'data':''}],TEAMS)
    assert not games and [g['game_number'] for g in pending] == ['TEST-number']
    with pytest.raises(ValueError,match='formato'):
        normalize_pgs({},TEAMS)


def test_connector_uses_public_routes_only_on_call():
    class Response:
        def __init__(self,data): self.data=data
        def raise_for_status(self): pass
        def json(self): return self.data
    class Session:
        def __init__(self): self.calls=[]
        def get(self,url,**kwargs):
            self.calls.append(url)
            return Response(TEAMS if '/iscrizioni/' in url else [MATCH])
    session=Session()
    assert not session.calls
    games,pending=download_pgs(session)
    assert len(games)==1 and len(session.calls)==2
    assert session.calls[1].endswith('calendari/campionato/'+COMPETITION)


def test_sync_button_filters_pgs_and_updates_shared_week(db,monkeypatch):
    """Exercise the real UI button locally with synthetic HTTP responses only."""
    import streamlit as st
    from pathlib import Path
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from unittest.mock import patch
    from streamlit.testing.v1 import AppTest
    st.cache_resource.clear()
    monkeypatch.setenv('PATTY_PASSWORD','TEST-only-organizer-password')
    class Response:
        def __init__(self,data): self.data=data
        def raise_for_status(self): pass
        def json(self): return self.data
    def get(url,**kwargs):
        return Response(TEAMS if '/iscrizioni/' in url else [MATCH])
    with patch('vc_storage.open_engine',return_value=db), patch('vc_core.download_fipav',return_value=[GAME]), patch('vc_pgs.requests.get',side_effect=get):
        app=AppTest.from_file(str(Path(__file__).parents[1]/'app.py')).run()
        app.session_state['patty_authenticated']=True
        app.session_state['patty_login_at']=datetime.now(ZoneInfo('Europe/Rome')).timestamp()
        app.run()
        next(b for b in app.button if b.label=='↻ Aggiorna tutti i calendari').click().run()
        assert not app.exception
        assert any('PGS Milano U11: 1 gare' in msg.value for msg in app.success)
        assert len(list_games(db))==2
        assert len([b for b in app.button if b.label=='Vedi scheda'])==2
        next(b for b in app.button if b.label=='↻ Aggiorna tutti i calendari').click().run()
        assert not app.exception and len(list_games(db))==2
