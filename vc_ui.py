"""Compact, mobile-friendly weekly fixture rows for VOLLEY CONTROL."""
import hashlib
from html import escape
import streamlit as st


def _e(value):
    return escape(str(value if value is not None else "—"))


def inject_calendar_css():
    st.markdown("""<style>
    [class*="st-key-vcrow_"] {background:#fff;border:1px solid #dbe6f0;border-radius:10px;padding:6px 9px;margin-bottom:5px;box-shadow:0 1px 2px rgba(25,52,78,.04);}
    [class*="st-key-vcrow_"] [data-testid="stColumn"] {min-width:0;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {gap:.45rem;}
    [class*="st-key-vcrow_"] [data-testid="stVerticalBlock"] {gap:0;}
    .vc-two-line {width:100%;min-width:0;overflow:hidden;}
    .vc-line-1,.vc-line-2 {display:grid;align-items:center;gap:11px;height:20px;width:100%;min-width:0;font-size:.77rem;line-height:20px;color:#4c647b;}
    .vc-line-1 {grid-template-columns:minmax(0,1.18fr) minmax(0,.98fr) minmax(0,3.9fr) minmax(0,1.35fr);}
    .vc-line-2 {grid-template-columns:minmax(0,3.5fr) minmax(0,1.55fr) minmax(0,1.65fr) minmax(0,1.65fr);}
    .vc-two-line span {display:block;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .vc-two-line .vc-strong {font-weight:750;color:#193b5c;}
    .vc-two-line .vc-state {font-weight:780;color:#aa6a14;}
    .vc-two-line .vc-away {color:#246699;}
    .vc-two-line .vc-ready {color:#16704b;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {min-width:92px!important;min-height:34px!important;height:34px!important;width:100%!important;padding:0 4px!important;border-radius:8px!important;font-size:.77rem!important;font-weight:700!important;white-space:nowrap!important;}
    @media(max-width:680px) {.vc-two-line {overflow-x:auto;}.vc-line-1,.vc-line-2 {min-width:660px;}}
    </style>""",unsafe_allow_html=True)


WEEKDAYS = ("Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom")


def compact_game_row(game, assigned, status, staff, on_open):
    """Exactly two horizontal lines of match information, plus Vedi scheda."""
    from datetime import datetime
    from vc_view_game import role_names
    d = datetime.fromisoformat(game["date"])
    short = hashlib.sha256(game["game_key"].encode("utf-8")).hexdigest()[:14]
    date_info = f"{WEEKDAYS[d.weekday()]} {d:%d/%m} · {game['time']}"
    event_info = f"{game['category']} · Gara {game.get('game_number') or '—'}"
    teams = f"{game['home_team']} – {game['away_team']}"
    if game.get("played"):
        teams += f" · {game.get('home_sets')}–{game.get('away_sets')}"
    state_class = " vc-ready" if status == "Completa" else " vc-away" if status == "Trasferta" else ""
    venue = f"{'CASA' if game['is_home'] else 'TRASFERTA'} · {game.get('venue') or 'Palestra da indicare'}"
    if game.get("address"):
        venue += f" · {game['address']}"
    coaches = ", ".join(x for x in (staff.get("coach1"), staff.get("coach2")) if x) or "—"
    managers = ", ".join(staff.get("managers", "").splitlines()).strip(", ") or "—"
    personnel = f"All.: {coaches} · Dir.: {managers}"
    referee = f"Arbitro: {role_names(assigned,'referee') or ('Da assegnare' if game['is_home'] else 'Non richiesto')}"
    scorer = f"Refertista: {role_names(assigned,'scorer') or ('Da assegnare' if game['is_home'] else 'Non richiesto')}"

    def cell(value, style=""):
        safe = _e(value)
        return f'<span class="{style}" title="{safe}">{safe}</span>'

    top = (cell(date_info, "vc-strong") + cell(event_info) +
           cell(teams, "vc-strong") + cell(status, "vc-state" + state_class))
    bottom = cell(venue) + cell(personnel) + cell(referee) + cell(scorer)
    with st.container(border=False, key="vcrow_" + short):
        left, right = st.columns([9, 1.15], vertical_alignment="center", gap="small")
        with left:
            st.markdown('<div class="vc-two-line"><div class="vc-line-1">' + top +
                        '</div><div class="vc-line-2">' + bottom + '</div></div>',
                        unsafe_allow_html=True)
        with right:
            if st.button("Vedi scheda", key="vcopen_" + short,
                         help="Apri la scheda completa", use_container_width=True):
                on_open(game["game_key"])
