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
    [class*="st-key-vcrow_"] [data-testid="stVerticalBlock"] {gap:3px!important;}
    [class*="st-key-vcrow_"] [data-testid="stElementContainer"]:has(.vc-two-line) {height:auto!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {min-height:73px;flex-wrap:nowrap!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:first-child {flex:1 1 0!important;width:0!important;min-width:0!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:last-child {flex:0 0 124px!important;width:124px!important;min-width:124px!important;}
    .vc-two-line {width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;}
    .vc-lines {width:100%;min-width:720px;}
    .vc-line-1,.vc-line-2,.vc-line-3 {display:grid;align-items:center;gap:0;height:23px;width:100%;font-size:.8rem;line-height:23px;color:#4c647b;}
    .vc-line-1,.vc-line-2,.vc-line-3 {grid-template-columns:repeat(12,minmax(0,1fr));}
    .vc-line-1 > span:nth-child(1) {grid-column:span 2;}
    .vc-line-1 > span:nth-child(2) {grid-column:span 3;}
    .vc-line-1 > span:nth-child(3) {grid-column:span 7;}
    .vc-line-2 > span:nth-child(1) {grid-column:span 8;}
    .vc-line-2 > span:nth-child(n+2) {grid-column:span 2;}
    .vc-line-2.vc-line-away > span {grid-column:1/-1;}
    .vc-line-3 > span:nth-child(1) {grid-column:span 5;}
    .vc-line-3 > span:nth-child(2) {grid-column:span 7;}
    .vc-two-line span {display:block;min-width:0;box-sizing:border-box;white-space:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding-right:9px;text-align:left;}
    .vc-two-line span::-webkit-scrollbar {display:none;}
    .vc-two-line .vc-strong {font-weight:750;color:#193b5c;}
    .vc-two-line .vc-role-open {color:#147347;font-weight:850;}
    .vc-two-line .vc-role-booked {color:#bc2635;font-weight:850;}
    .vc-two-line .vc-state {font-weight:780;color:#aa6a14;}
    .vc-two-line .vc-away {color:#246699;}
    .vc-two-line .vc-ready {color:#16704b;}
    .vc-right-status {display:flex;justify-content:center;align-items:center;text-align:center;
        box-sizing:border-box;width:100%;padding:2px 6px;min-height:34px;height:34px;margin:0;
        border-radius:8px;font-size:.71rem;font-weight:850;line-height:1.1;
        overflow-wrap:anywhere;white-space:normal;position:static!important;}
    .vc-right-status.missing {background:#ffe04b;color:#292000;border:2px solid #c99a00;}
    .vc-right-status.ready {background:#e1f4e8;color:#17633f;border:1px solid #c6e6d2;}
    .vc-right-status.away {background:#e5f0fa;color:#1b557f;border:1px solid #d0e3f3;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {min-width:92px!important;min-height:32px!important;height:32px!important;width:100%!important;padding:0 4px!important;border-radius:8px!important;font-size:.77rem!important;font-weight:700!important;white-space:nowrap!important;position:static!important;}
    [class*="st-key-vcrow_"] > [data-testid="stHorizontalBlock"] {flex-wrap:nowrap!important;}
    [class*="st-key-vcrow_"] > [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:first-child {flex:1 1 0!important;width:0!important;min-width:0!important;}
    [class*="st-key-vcrow_"] > [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:last-child {flex:0 0 124px!important;width:124px!important;min-width:124px!important;}
    .vc-two-line span + span {border-left:1px solid #e5edf4;padding-left:9px;}
    </style>""",unsafe_allow_html=True)


UI_RELEASE = "2026-10-26.11"


WEEKDAYS = ("Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom")


def compact_game_row(game, assigned, status, staff, on_open):
    """Three horizontal lines of match information, plus Vedi scheda."""
    from datetime import datetime
    from vc_view_game import role_names
    d = datetime.fromisoformat(game["date"])
    short = hashlib.sha256(game["game_key"].encode("utf-8")).hexdigest()[:14]
    date_info = f"{WEEKDAYS[d.weekday()]} {d:%d/%m} · {game['time']}"
    event_info = f"{game['source']} · {game['category']} · Gara {game.get('game_number') or '—'}"
    teams = f"{game['home_team']} – {game['away_team']}"
    if game.get("played"):
        teams += f" · {game.get('home_sets')}–{game.get('away_sets')}"
    state_class = " vc-ready" if status == "Completa" else " vc-away" if status == "Trasferta" else ""
    venue = f"{'CASA' if game['is_home'] else 'TRASFERTA'} · {game.get('venue') or 'Palestra da indicare'}"
    if game.get("address"):
        venue += f" · {game['address']}"
    coaches = ", ".join(x for x in (staff.get("coach1"), staff.get("coach2")) if x) or "—"
    managers = ", ".join(staff.get("managers", "").splitlines()).strip(", ") or "—"
    coach_info = f"Allenatori: {coaches}"
    manager_info = f"Dirigenti: {managers}"
    referee_name = role_names(assigned, "referee")
    scorer_name = role_names(assigned, "scorer")

    def cell(value, style=""):
        safe = _e(value)
        return f'<span class="{style}" title="{safe}" tabindex="0">{safe}</span>'

    top = cell(date_info, "vc-strong") + cell(event_info) + cell(teams, "vc-strong")
    if game["is_home"]:
        # Verde = posto libero; rosso = nominativo già prenotato.
        ref_value = "Arbitro" + (f": {referee_name}" if referee_name else "")
        scorer_value = "Refertista" + (f": {scorer_name}" if scorer_name else "")
        ref_cell = cell(ref_value, "vc-role-booked" if referee_name else "vc-role-open")
        scorer_cell = cell(scorer_value, "vc-role-booked" if scorer_name else "vc-role-open")
        bottom = cell(venue) + ref_cell + scorer_cell
        row_type = "vc-line-2"
    else:
        # Nelle trasferte non mostrare nessun campo arbitro/refertista.
        bottom = cell(venue)
        row_type = "vc-line-2 vc-line-away"
    staff_line = cell(coach_info) + cell(manager_info)
    with st.container(border=False, key="vcrow_" + short):
        left, right = st.columns([9, 1.2], vertical_alignment="center", gap="small")
        with left:
            st.markdown('<div class="vc-two-line" data-ui-release="2026-10-26.11" tabindex="0" aria-label="Dati gara su tre righe; scorri i campi lunghi per leggere tutti i dettagli"><div class="vc-lines"><div class="vc-line-1">' + top +
                        '</div><div class="' + row_type + '">' + bottom +
                        '</div><div class="vc-line-3">' + staff_line + '</div></div></div>',
                        unsafe_allow_html=True)
        with right:
            # Button must be above the yellow/neutral availability notice.
            if st.button("Vedi scheda", key="vcopen_" + short,
                         help="Apri la scheda completa", use_container_width=True):
                on_open(game["game_key"])
            if status != "Trasferta":
                status_type = "ready" if status == "Completa" else "missing"
                st.markdown(f'<div class="vc-right-status {status_type}" role="status">{_e(status)}</div>',
                            unsafe_allow_html=True)


def week_tabs(weeks, selected_week):
    """Blue filing tabs wrap only when the available row is full."""
    from vc_core import week_label
    st.markdown(f"""<style>
    .st-key-vcweek_tabs {{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:flex-end;gap:7px 5px!important;overflow:visible;padding:6px 0 0;border-bottom:3px solid #17659d;max-width:100%;}}
    .st-key-vcweek_tabs [data-testid="stElementContainer"] {{width:max-content!important;flex:0 0 auto!important;max-width:100%;}}
    .st-key-vcweek_tabs button {{background:#17659d!important;color:#fff!important;border:1px solid #17659d!important;border-radius:12px 12px 0 0!important;min-height:31px!important;height:31px!important;padding:2px 12px!important;box-shadow:inset 0 2px 0 #ffffff35;white-space:nowrap;}}
    .st-key-vcweek_tabs button p {{font-size:.76rem!important;line-height:1.1!important;color:#fff!important;}}
    .st-key-vcweek_tabs button[kind="primary"] {{background:#083b68!important;border-color:#083b68!important;box-shadow:inset 0 3px 0 #7ac5ff;transform:translateY(-3px);}}
    .st-key-vcweek_tabs button:hover {{background:#104e7c!important;}}
    </style>""", unsafe_allow_html=True)
    with st.container(key="vcweek_tabs"):
        for week in weeks:
            if st.button(week_label(week), key=f"wk_{week.isoformat()}",
                         type="primary" if selected_week == week else "secondary"):
                st.session_state.selected_week = week.isoformat()
                st.rerun()
