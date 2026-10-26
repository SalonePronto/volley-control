"""Compact fixture bands following the club's approved block sketch."""
import hashlib
import re
from html import escape
import streamlit as st

UI_RELEASE = "2026-10-26.13"
WEEKDAYS = ("Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom")


def _e(value):
    return escape(str(value if value is not None else "—"))


def inject_calendar_css():
    st.markdown("""<style>
    [class*="st-key-vcrow_"] {background:#fff;border:1px solid #dbe6f0;border-radius:10px;padding:6px 9px;margin-bottom:5px;box-shadow:0 1px 2px rgba(25,52,78,.04);}
    [class*="st-key-vcrow_"] [data-testid="stColumn"] {min-width:0;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {gap:7px!important;min-height:73px;flex-wrap:nowrap!important;}
    [class*="st-key-vcrow_"] [data-testid="stVerticalBlock"] {gap:0!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:first-child {flex:1 1 0!important;width:0!important;min-width:0!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:last-child {flex:0 0 64px!important;width:64px!important;min-width:64px!important;}
    [class*="st-key-vcrow_"] [data-testid="stElementContainer"]:has(.vc-two-line),
    [class*="st-key-vcrow_"] [data-testid="stMarkdown"]:has(.vc-two-line),
    [class*="st-key-vcrow_"] [data-testid="stMarkdown"] > div:has(.vc-two-line) {height:69px!important;min-height:69px!important;}
    .vc-two-line {width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;}
    .vc-blocks {display:grid;grid-template-columns:64px 92px minmax(220px,1fr) 118px 122px 128px;gap:7px;align-items:center;height:69px;min-width:820px;text-align:center;color:#4c647b;font-size:.8rem;}
    .vc-block {min-width:0;box-sizing:border-box;height:69px;display:flex;flex-direction:column;justify-content:center;align-items:stretch;}
    .vc-block + .vc-block {border-left:1px solid #e5edf4;padding-left:7px;}
    .vc-category {background:#ffad45;color:#402400;border:1px solid #ec941f;border-radius:7px;}
    .vc-category strong {font-size:1.65rem;line-height:29px;font-weight:850;}
    .vc-category .vc-source {font-size:.76rem;line-height:18px;font-weight:800;}
    .vc-category .vc-number {font-size:.67rem;line-height:16px;}
    .vc-date span,.vc-line-1,.vc-line-2,.vc-line-3 {display:block;min-width:0;max-width:100%;height:23px;line-height:23px;white-space:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;}
    .vc-blocks ::-webkit-scrollbar {display:none;}
    .vc-date {font-weight:750;color:#193b5c;}
    .vc-date .vc-side {font-size:.72rem;color:#4c647b;font-weight:650;}
    .vc-line-1,.vc-line-2 {font-weight:800;color:#193b5c;}
    .vc-line-3 {font-size:.73rem;}
    .vc-staff > span {display:flex;align-items:center;justify-content:center;min-height:34px;min-width:0;}
    .vc-staff .vc-scroll {display:block;white-space:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;}
    .vc-role {height:34px;display:flex;flex-direction:column;justify-content:center;min-width:0;}
    .vc-role b {font-size:.75rem;line-height:17px;}
    .vc-role span {display:block;white-space:nowrap;overflow-x:auto;scrollbar-width:none;font-size:.72rem;line-height:17px;}
    .vc-role-open {color:#147347;font-weight:800;}
    .vc-role-booked {color:#bc2635;font-weight:800;}
    .vc-right-status {display:flex;justify-content:center;align-items:center;text-align:center;box-sizing:border-box;width:100%;height:58px;padding:4px 7px;border-radius:5px;font-size:.77rem;font-weight:850;line-height:1.2;overflow-wrap:anywhere;}
    .vc-right-status.missing {background:#ffe04b;color:#292000;border:2px solid #c99a00;}
    .vc-right-status.ready {background:#e1f4e8;color:#17633f;border:1px solid #c6e6d2;}
    .vc-right-status.away {background:#e5f0fa;color:#1b557f;border:1px solid #d0e3f3;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {box-sizing:border-box;min-width:64px!important;max-width:64px!important;width:64px!important;min-height:64px!important;height:64px!important;padding:5px!important;border-radius:5px!important;font-size:.8rem!important;font-weight:750!important;white-space:normal!important;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button p {max-width:45px!important;line-height:1.35!important;text-align:center;white-space:normal!important;}
    </style>""", unsafe_allow_html=True)


def compact_game_row(game, assigned, status, staff, on_open):
    """Same 87px band for every source: category/date/teams/staff/roles/state/open."""
    from datetime import datetime
    from vc_view_game import role_names
    d = datetime.fromisoformat(game["date"])
    short = hashlib.sha256(game["game_key"].encode("utf-8")).hexdigest()[:14]
    category = str(game.get("category") or "—")
    match = re.search(r"\bU\s*(\d+)", category, flags=re.I)
    category_short = "U" + match.group(1) if match else category
    source = "PGS" if "PGS" in game["source"].upper() else game["source"]
    coaches = ", ".join(x for x in (staff.get("coach1"), staff.get("coach2")) if x) or "—"
    managers = ", ".join(staff.get("managers", "").splitlines()).strip(", ") or "—"
    venue = game.get("venue") or "Palestra da indicare"
    if game.get("address"):
        venue += " · " + game["address"]
    score = f" · {game.get('home_sets')}–{game.get('away_sets')}" if game.get("played") else ""

    def line(value, cls):
        return f'<span class="{cls}" title="{_e(value)}" tabindex="0">{_e(value)}</span>'

    category_box = ('<div class="vc-block vc-category" title="'+_e(category+' · '+game['source'])+'">'
        '<strong>'+_e(category_short)+'</strong><span class="vc-source">'+_e(source)+'</span>'
        '<span class="vc-number">N. '+_e(game.get('game_number') or '—')+'</span></div>')
    date_box = ('<div class="vc-block vc-date">'+line(f"{WEEKDAYS[d.weekday()]} {d:%d/%m}", "")+
        line(game['time'], "")+line("CASA" if game['is_home'] else "TRASFERTA", "vc-side")+'</div>')
    fixture_box = ('<div class="vc-block vc-fixture">'+line(game['home_team'], 'vc-line-1')+
        line(game['away_team']+score, 'vc-line-2')+line(venue, 'vc-line-3')+'</div>')
    staff_box = ('<div class="vc-block vc-staff"><span>'+line('ALL. '+coaches, 'vc-scroll')+
        '</span><span>'+line('DIR. '+managers, 'vc-scroll')+'</span></div>')
    roles = ''
    if game['is_home']:
        for label, role in [('Arbitro', 'referee'), ('Refertista', 'scorer')]:
            name = role_names(assigned, role)
            cls = 'vc-role-booked' if name else 'vc-role-open'
            roles += '<div class="vc-role '+cls+'"><b>'+label+'</b>'
            if name:
                roles += line(name, '')
            roles += '</div>'
    roles_box = '<div class="vc-block vc-roles">'+roles+'</div>'
    status_type = 'away' if status == 'Trasferta' else 'ready' if status == 'Completa' else 'missing'
    state_box = ('<div class="vc-block vc-state-block"><div class="vc-right-status '+status_type+
                 '" role="status">'+_e(status)+'</div></div>')
    html = ('<div class="vc-two-line" data-ui-release="'+UI_RELEASE+'" tabindex="0" '
            'aria-label="Dati gara in blocchi centrati; scorri i testi lunghi"><div class="vc-blocks">'+
            category_box+date_box+fixture_box+staff_box+roles_box+state_box+'</div></div>')
    with st.container(border=False, key='vcrow_'+short):
        left, right = st.columns([12, 1], vertical_alignment='center', gap='small')
        with left:
            st.markdown(html, unsafe_allow_html=True)
        with right:
            if st.button('Vedi scheda', key='vcopen_'+short,
                         help='Apri la scheda completa', use_container_width=True):
                on_open(game['game_key'])


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
