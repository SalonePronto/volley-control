"""Isolated checks for team identity, role colors and short-name editing."""
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo
import pytest
import streamlit as st
from streamlit.testing.v1 import AppTest
from vc_core import week_start
from vc_team_names import display_names, save_display_name, short_name_for
from vc_ui import role_state
from test_dashboard import GAME, db


def test_short_names_distinguish_sources_and_preserve_official_game(db):
    save_display_name(db, 'FIPAV', '229693', 'TEST  SQUADRA UNO')
    save_display_name(db, 'PGS Milano', '229693', 'TEST SQUADRA DUE')
    names=display_names(db)
    assert short_name_for(GAME,names)=='TEST SQUADRA UNO'
    assert short_name_for({**GAME,'source':'PGS Milano'},names)=='TEST SQUADRA DUE'
    assert GAME['our_team_name']=='PVI STUDIO OTTOLINA'
    assert short_name_for({**GAME,'our_team_id':'TEST-unknown'},names)==GAME['our_team_name']
    with pytest.raises(ValueError):
        save_display_name(db,'FIPAV','229693','   ')
    assert short_name_for(GAME,display_names(db))=='TEST SQUADRA UNO'


def test_role_coverage_includes_partial_slots_and_away():
    assert role_state(GAME,[],'referee')[0]=='missing'
    assert role_state(GAME,[{'role':'referee'}],'referee')[0]=='covered'
    assert role_state({**GAME,'required_referees':2},[{'role':'referee'}],'referee')[0]=='missing'
    assert role_state({**GAME,'is_home':False},[],'referee')[0]=='na'
    assert role_state({**GAME,'required_scorers':0},[],'scorer')[0]=='na'


def test_patty_can_edit_alias_and_same_dialog_opens(db,monkeypatch):
    st.cache_resource.clear()
    monkeypatch.setenv('PATTY_PASSWORD','TEST-only-organizer-password')
    with patch('vc_storage.open_engine',return_value=db):
        app=AppTest.from_file(str(Path(__file__).parents[1]/'app.py')).run()
        assert not any(b.label=='Salva nome breve' for b in app.button)
        app.session_state['patty_authenticated']=True
        app.session_state['patty_login_at']=datetime.now(ZoneInfo('Europe/Rome')).timestamp()
        app.run()
        field=next(t for t in app.text_input if 'PVI STUDIO OTTOLINA' in t.label)
        field.set_value('TEST OTTOLINA BREVE')
        next(b for b in app.button if b.key=='FormSubmitter:short_name_FIPAV_229693-Salva nome breve').click().run()
        assert not app.exception
        app.button(key='wk_'+week_start(GAME['date']).isoformat()).click().run()
        row=next(m.value for m in app.markdown if 'data-ui-release=' in m.value)
        assert 'data-team-short="TEST OTTOLINA BREVE"' in row
        assert 'vc-mobile-quick' in row and 'vc-dot-missing' in row
        assert GAME['away_team'].replace("'",'&#x27;') in row
        next(b for b in app.button if b.label=='Vedi scheda').click().run()
        assert not app.exception
        assert len([b for b in app.button if b.label=='Mi prenoto' and b.disabled])==2
