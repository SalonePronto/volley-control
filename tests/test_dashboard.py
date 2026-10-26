"""Local regression checks. Test accounts never enter the online application."""
from pathlib import Path
from unittest.mock import patch
import pytest
from streamlit.testing.v1 import AppTest
from vc_people import init_people, register, approval, authenticate, assign, assignments_for_games
from vc_storage import open_engine, save_import

# One actual published CP-03 fixture; used only in an isolated local test DB.
GAME = dict(game_key='FIPAV:2026-2027:63945:12947548', source='FIPAV',
    season='2026-2027', group_id='63945', official_id='12947548',
    game_number='7009', category='U15 Femminile', our_team_id='229693',
    our_team_name='PVI STUDIO OTTOLINA', is_home=True,
    home_team='PVI STUDIO OTTOLINA', away_team="POLISPORTIVA SANT'AGATA VOLLEY BLU",
    date='2026-11-07', time='18:30', venue='PALESTRA SCUOLE MEDIE',
    address='VIA MANZONI, 50 - PAINA DI GIUSSANO', played=False,
    home_sets=None, away_sets=None, sets=[], notes='', required_referees=1,
    required_scorers=1, hidden=False)

@pytest.fixture
def db(tmp_path):
    engine = open_engine('sqlite:///' + str(tmp_path / 'test.sqlite'))
    init_people(engine)
    save_import(engine, [GAME])
    return engine


def test_real_week_and_home_dialog(db):
    # Patch storage only: never invoke live sports feeds or production DB.
    with patch('vc_storage.open_engine', return_value=db):
        app = AppTest.from_file(str(Path(__file__).parents[1] / 'app.py')).run()
        assert not app.exception
        assert any(b.label == 'Vedi scheda' for b in app.button)
        app.button(key=next(b.key for b in app.button if b.label == 'Vedi scheda')).click().run()
        assert not app.exception
        buttons = [b for b in app.button if b.label == 'Mi prenoto']
        assert len(buttons) == 2 and all(b.disabled for b in buttons)
        assert any('Prenotazioni disattivate' in c.value for c in app.caption)
        rows = [m.value for m in app.markdown if 'data-ui-release=' in m.value]
        assert len(rows) == 1
        assert rows[0].count('class="vc-line-') == 3
        assert '7009' in rows[0] and GAME['address'] in rows[0]


def test_approval_dual_roles_duplicates_and_overlaps(db):
    pid = register(db, 'TEST', 'SOLO LOCALE', 'local-test@example.invalid',
                   'test-only-password-123', True, True)
    assert not authenticate(db, 'local-test@example.invalid', 'test-only-password-123')['approved']
    with pytest.raises(ValueError, match='abilitata'):
        assign(db, GAME['game_key'], 'referee', pid)
    approval(db, pid, True)
    assert authenticate(db, 'local-test@example.invalid', 'test-only-password-123')['approved']
    assign(db, GAME['game_key'], 'referee', pid, actor=pid, source='self')
    with pytest.raises(ValueError, match='occupato'):
        assign(db, GAME['game_key'], 'referee', pid)
    with pytest.raises(ValueError, match='già incaricata'):
        assign(db, GAME['game_key'], 'scorer', pid)
    # Isolated test scenario for collision detection; never a published match.
    overlap = {**GAME, 'game_key':'TEST:overlap', 'time':'19:00'}
    save_import(db, [overlap])
    with pytest.raises(ValueError, match='sovrapposto'):
        assign(db, overlap['game_key'], 'scorer', pid)
    booked = assignments_for_games(db, [GAME['game_key']])[GAME['game_key']]
    assert len(booked) == 1 and booked[0]['first_name'] == 'TEST'
