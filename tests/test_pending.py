"""Pending-data alerts and configurable-team updates; isolated test data only."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
import streamlit as st
from streamlit.testing.v1 import AppTest
from vc_pending import save_pending, list_pending
from vc_core import normalize_fipav
from vc_pgs import normalize_pgs
from test_dashboard import GAME, db
from test_pgs import MATCH, TEAMS


def test_pending_scopes_survive_and_clear_independently(db):
    _, pending = normalize_pgs([{**MATCH, 'data':''}], TEAMS)
    save_pending(db,'PGS:teamA',pending)
    save_pending(db,'PGS:teamB',[{**pending[0], 'game_key':'TEST:other', 'game_number':'TEST-other'}])
    assert len(list_pending(db)) == 2
    save_pending(db,'PGS:teamA',[])
    assert len(list_pending(db)) == 1
    assert list_pending(db)[0]['game_number'] == 'TEST-other'


def test_fipav_missing_primary_data_can_be_reported():
    team={'team_id':'TEST-our', 'group_id':'TEST-group', 'category':'TEST-cat', 'team_name':'TEST team'}
    payload={'matches':[{'id':'TEST-id','team1':{'id':'TEST-our','title':'TEST team'},
        'team2':{'id':'TEST-away','title':'TEST away'}, 'ng':'TEST-ng','date':'','time':'18:00'}]}
    games,pending=normalize_fipav(payload,team,include_pending=True)
    assert not games and len(pending)==1 and pending[0]['time']=='18:00'


def test_pgs_supports_another_configured_team():
    config={'team_id':'TEST-another', 'team_name':'TEST OTHER', 'category':'U13',
            'competition':'TEST-competition', 'season':'TEST-season'}
    other_teams=[*TEAMS,dict(id='TEST-another',nomeSquadra='TEST OTHER',categoria='U13')]
    match={**MATCH,'id':'TEST-another-match','squadraCasaID':'TEST-another',
           'categoria':'U13','codiceCampionato':'TEST-competition'}
    games,pending=normalize_pgs([match],other_teams,team=config)
    assert not pending and games[0]['category']=='U13'
    assert games[0]['season']=='TEST-season' and games[0]['our_team_id']=='TEST-another'


def test_dot_survives_navigation_and_clears_after_successful_update(db,monkeypatch):
    st.cache_resource.clear()
    monkeypatch.setenv('PATTY_PASSWORD','TEST-only-organizer-password')
    _, pending=normalize_pgs([{**MATCH,'data':''}],TEAMS)
    with patch('vc_storage.open_engine',return_value=db), patch('vc_core.download_fipav',return_value=([GAME],[])), patch('vc_pgs.download_pgs',return_value=([],pending)):
        app=AppTest.from_file(str(Path(__file__).parents[1]/'app.py')).run()
        app.session_state['patty_authenticated']=True
        app.session_state['patty_login_at']=datetime.now(ZoneInfo('Europe/Rome')).timestamp()
        app.run()
        next(b for b in app.button if b.label=='↻ Aggiorna tutti i calendari').click().run()
        assert not app.exception
        assert any('PATTY' in b.label and '🔵' in b.label for b in app.button)
        app.run()
        assert any('PATTY' in b.label and '🔵' in b.label for b in app.button)
        assert len(list_pending(db))==1
        with patch('vc_pgs.download_pgs',side_effect=ValueError('TEST source unavailable')):
            next(b for b in app.button if b.label=='↻ Aggiorna tutti i calendari').click().run()
            assert any('PATTY' in b.label and '🔵' in b.label for b in app.button)
    games,_=normalize_pgs([MATCH],TEAMS)
    with patch('vc_storage.open_engine',return_value=db), patch('vc_core.download_fipav',return_value=([GAME],[])), patch('vc_pgs.download_pgs',return_value=(games,[])):
        next(b for b in app.button if b.label=='↻ Aggiorna tutti i calendari').click().run()
        assert not app.exception
        assert not list_pending(db)
        assert not any('PATTY' in b.label and '🔵' in b.label for b in app.button)
