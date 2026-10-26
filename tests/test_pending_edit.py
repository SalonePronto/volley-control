"""Completion scenarios use isolated SQLite and synthetic TEST identifiers only."""
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo
import pytest
import streamlit as st
from streamlit.testing.v1 import AppTest
from vc_core import week_start
from vc_pending import complete_pending, list_pending, save_pending
from vc_storage import audit_for_game, conflicts_for_game, list_games, save_import
from test_dashboard import GAME, db

PENDING = {**GAME, 'game_key':'TEST:pending-schedule', 'game_number':'TEST-pending',
           'date':'', 'time':'', 'home_team':'TEST CASA', 'away_team':'TEST OSPITE'}


def test_complete_then_refresh_keeps_schedule_without_duplicates(db):
    save_pending(db, 'TEST:scope', [PENDING])
    game = complete_pending(db, PENDING['game_key'], '05/01/2027', '20:15', 'TEST locale')
    assert game['date']=='2027-01-05' and game['time']=='20:15'
    assert week_start(game['date']).isoformat()=='2027-01-04'
    assert not list_pending(db)
    assert {a['field'] for a in audit_for_game(db, game['game_key'])}=={'date','time'}
    # The official feed still lacks dates: the manually completed game stays complete.
    save_pending(db, 'TEST:scope', [PENDING])
    assert not list_pending(db)
    with pytest.raises(ValueError, match='già nel calendario'):
        complete_pending(db, game['game_key'], '06/01/2027', '21:00')
    # A later official date must preserve and expose the organizer's correction.
    save_import(db, [{**PENDING, 'date':'2027-01-06', 'time':'21:00'}])
    updated = next(g for g in list_games(db) if g['game_key']==game['game_key'])
    assert (updated['date'], updated['time'])==('2027-01-05','20:15')
    assert len(conflicts_for_game(db, game['game_key']))==2
    assert len([g for g in list_games(db) if g['game_key']==game['game_key']])==1


@pytest.mark.parametrize('date,hour', [('', ''), ('31/02/2027','20:00'), ('05/01/2027','25:10')])
def test_invalid_completion_does_not_change_archive(db, date, hour):
    save_pending(db, 'TEST:scope', [PENDING])
    with pytest.raises(ValueError):
        complete_pending(db, PENDING['game_key'], date, hour)
    assert len(list_games(db))==1
    assert list_pending(db)[0]['date']==''
    assert not audit_for_game(db, PENDING['game_key'])


def test_missing_only_time_keeps_real_date(db):
    save_pending(db, 'TEST:scope', [{**PENDING, 'date':'2027-01-05'}])
    game = complete_pending(db, PENDING['game_key'], '2027-01-05', '09:30')
    assert (game['date'], game['time'])==('2027-01-05','09:30')


def test_editor_restricted_to_patty_and_save_selects_correct_week(db, monkeypatch):
    st.cache_resource.clear()
    monkeypatch.setenv('PATTY_PASSWORD','TEST-only-organizer-password')
    save_pending(db, 'TEST:scope', [PENDING])
    with patch('vc_storage.open_engine', return_value=db):
        app=AppTest.from_file(str(Path(__file__).parents[1]/'app.py')).run()
        assert not app.exception
        assert not any('Aggiorna tutti' in b.label for b in app.button)
        assert not app.text_input
        app.session_state['patty_authenticated']=True
        app.session_state['patty_login_at']=datetime.now(ZoneInfo('Europe/Rome')).timestamp()
        app.run()
        assert any(b.label=='↻ Aggiorna tutti i calendari' for b in app.button)
        assert any(b.label=='↻ Aggiorna tutti i risultati' for b in app.button)
        save=lambda: next(b for b in app.button if b.label=='Salva e inserisci nel calendario')
        save().click().run()
        assert not app.exception and any('sia la data sia' in e.value for e in app.error)
        next(t for t in app.text_input if t.label=='Data (GG/MM/AAAA)').set_value('05/01/2027')
        next(t for t in app.text_input if t.label=='Ora (HH:MM)').set_value('20:15')
        save().click().run()
        assert not app.exception
        assert app.session_state['selected_week']=='2027-01-04'
        assert any('TEST-pending' in m.value and '20:15' in m.value for m in app.markdown)
        assert not any('PATTY' in b.label and '🔵' in b.label for b in app.button)
        assert not list_pending(db)
