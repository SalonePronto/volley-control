"""Compact fixture bands following the club's approved block sketch."""
import hashlib
import re
from html import escape
import streamlit as st

UI_RELEASE = "2026-10-26.17"
WEEKDAYS = ("Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom")


def _e(value):
    return escape(str(value if value is not None else "—"))


def inject_calendar_css():
    st.markdown("""<style>
    [class*="st-key-vcrow_"] {container-type:inline-size;position:relative;background:#fff;border:1px solid #dbe6f0;border-radius:10px;padding:6px 9px;margin-bottom:5px;box-shadow:0 1px 2px rgba(25,52,78,.04);}
    [class*="st-key-vcrow_"] [data-testid="stColumn"] {min-width:0;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {gap:7px!important;min-height:73px;flex-wrap:nowrap!important;}
    [class*="st-key-vcrow_"] [data-testid="stVerticalBlock"] {gap:0!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:first-child {flex:1 1 0!important;width:0!important;min-width:0!important;}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:last-child {flex:0 0 64px!important;width:64px!important;min-width:64px!important;}
    [class*="st-key-vcrow_"] [data-testid="stElementContainer"]:has(.vc-two-line),
    [class*="st-key-vcrow_"] [data-testid="stMarkdown"]:has(.vc-two-line),
    [class*="st-key-vcrow_"] [data-testid="stMarkdown"] > div:has(.vc-two-line) {height:69px!important;min-height:69px!important;}
    [class*="st-key-vcrow_"] [data-testid="stMarkdownContainer"]:has(.vc-two-line) {margin:0!important;}
    .vc-two-line {width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;}
    .vc-blocks {display:grid;grid-template-columns:64px 92px minmax(220px,1fr) 200px 122px 128px;gap:7px;align-items:center;height:69px;min-width:902px;text-align:center;color:#4c647b;font-size:.8rem;}
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
    .vc-staff {display:grid;grid-template-rows:34px 34px;gap:1px;}
    .vc-coaches {display:flex;flex-direction:column;justify-content:center;min-width:0;}
    .vc-coach-line {display:block;height:17px;line-height:17px;white-space:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;}
    .vc-managers {display:flex;align-items:center;justify-content:center;min-width:0;max-height:34px;}
    .vc-managers .vc-scroll {display:block;white-space:normal;line-height:17px;max-height:34px;overflow:auto;scrollbar-width:none;max-width:100%;}
    .vc-role {height:34px;display:flex;flex-direction:column;justify-content:center;min-width:0;}
    .vc-role b {font-size:.75rem;line-height:17px;}
    .vc-role span {display:block;white-space:nowrap;overflow-x:auto;scrollbar-width:none;font-size:.72rem;line-height:17px;}
    .vc-role-open {color:#e0002b;font-weight:800;}
    .vc-role-booked {color:#008c3a;font-weight:800;}
    .vc-right-status {display:flex;justify-content:center;align-items:center;text-align:center;box-sizing:border-box;width:100%;height:58px;padding:4px 7px;border-radius:5px;font-size:.77rem;font-weight:850;line-height:1.2;overflow-wrap:anywhere;}
    .vc-right-status.missing {background:#ffe04b;color:#292000;border:2px solid #c99a00;}
    .vc-right-status.ready {background:#e1f4e8;color:#17633f;border:1px solid #c6e6d2;}
    .vc-right-status.away {background:#e5f0fa;color:#1b557f;border:1px solid #d0e3f3;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {box-sizing:border-box;min-width:64px!important;max-width:64px!important;width:64px!important;min-height:64px!important;height:64px!important;padding:5px!important;border-radius:5px!important;font-size:.8rem!important;font-weight:750!important;white-space:normal!important;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button p {max-width:45px!important;line-height:1.35!important;text-align:center;white-space:normal!important;}

    .st-key-vcfixture_area {container-type:inline-size;}
    .vc-mobile-quick,.vc-quick-head,.vc-quick-legend {display:none;}
    .st-key-vcfixture_area [data-testid="stElementContainer"]:has(.vc-quick-head) {display:none;}
    .vc-dot {display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;height:16px;border-radius:50%;font-size:11px;font-weight:900;line-height:1;vertical-align:middle;}
    .vc-dot-covered {background:#00e65f;color:#064020;border:1px solid #008d39;}
    .vc-dot-missing {background:#ff1744;color:white;border:1px solid #c9002a;}
    .vc-dot-na {color:#6b7b8b;background:none;font-size:14px;}
    .vc-role b {display:flex;justify-content:center;align-items:center;gap:4px;}
    @container (max-width:1000px) {
      .st-key-vcfixture_list {gap:2px!important;}
      [class*="st-key-vcrow_"] {padding:1px 4px;margin-bottom:0;border-radius:3px;}
      [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {display:flex!important;min-height:32px!important;gap:3px!important;align-items:center;}
      [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:first-child {flex:1 1 0!important;width:0!important;min-width:0!important;}
      [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] > [data-testid="stColumn"]:last-child {flex:0 0 64px!important;width:64px!important;min-width:64px!important;}
      [class*="st-key-vcrow_"] [data-testid="stElementContainer"]:has(.vc-two-line),
      [class*="st-key-vcrow_"] [data-testid="stMarkdown"]:has(.vc-two-line),
      [class*="st-key-vcrow_"] [data-testid="stMarkdown"] > div:has(.vc-two-line) {height:auto!important;min-height:32px!important;}
      .vc-two-line {overflow:visible;}
      .vc-blocks {display:none;}
      .vc-mobile-quick {display:grid;grid-template-columns:minmax(0,1fr) 42px 38px 22px 22px;gap:3px;align-items:center;text-align:center;min-height:32px;font-size:12px;color:#193b5c;font-variant-numeric:tabular-nums;}
      .vc-mobile-identity {min-width:0;line-height:14px;text-align:center;}
      .vc-mobile-category {display:inline-block;background:#ffad45;color:#402400;border-radius:3px;padding:0 3px;font-size:12px;font-weight:800;}
      .vc-mobile-source {font-size:10px;font-weight:650;margin-left:3px;}
      .vc-mobile-name {display:block;font-size:11px;font-weight:750;line-height:14px;overflow-wrap:anywhere;}
      .vc-mobile-role {text-align:center;}
      .vc-quick-head {display:grid;grid-template-columns:minmax(0,1fr) 42px 38px 22px 22px 64px;gap:3px;padding:0 5px;text-align:center;font-size:10px;font-weight:750;color:#4c647b;}
      .vc-quick-legend {display:flex;justify-content:center;align-items:center;gap:12px;font-size:11px;color:#4c647b;margin-bottom:5px;}
      .vc-quick-legend .vc-dot {width:12px;height:12px;font-size:9px;}
      .st-key-vcfixture_area [data-testid="stElementContainer"]:has(.vc-quick-head) {display:block;}
      [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {min-height:32px!important;height:32px!important;max-height:32px!important;padding:1px 3px!important;font-size:11px!important;border-radius:4px!important;}
      [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button p {font-size:11px!important;line-height:13px!important;max-width:none!important;}
    }
    </style>""", unsafe_allow_html=True)


def role_state(game, assigned, role):
    required = int(game.get('required_referees' if role == 'referee' else 'required_scorers', 0))
    if not game['is_home'] or required == 0:
        return 'na', 'Non richiesto', '—'
    covered = sum(a['role'] == role for a in assigned)
    if covered >= required:
        return 'covered', f'Coperto ({covered}/{required})', '✓'
    return 'missing', f'Mancante ({covered}/{required} coperti)', '!'


def role_dot(game, assigned, role):
    state, label, mark = role_state(game, assigned, role)
    role_label = 'Arbitro' if role == 'referee' else 'Refertista'
    label = _e(role_label + ': ' + label)
    return f'<span class="vc-dot vc-dot-{state}" role="img" aria-label="{label}" title="{label}">{mark}</span>'


def quick_list_header():
    st.markdown('<div class="vc-quick-legend"><span><span class="vc-dot vc-dot-covered">✓</span> Coperto</span>'
                '<span><span class="vc-dot vc-dot-missing">!</span> Mancante</span><span>— Trasferta</span></div>'
                '<div class="vc-quick-head"><span>SQUADRA</span><span>DATA</span><span>ORA</span>'
                '<span>ARB</span><span>REF</span><span>SCHEDA</span></div>', unsafe_allow_html=True)


def compact_game_row(game, assigned, status, staff, on_open):
    """Desktop band plus 36px mobile summary; both open the same real dialog."""
    from datetime import datetime
    from vc_view_game import role_names
    d = datetime.fromisoformat(game["date"])
    short = hashlib.sha256(game["game_key"].encode("utf-8")).hexdigest()[:14]
    category = str(game.get("category") or "—")
    match = re.search(r"\bU\s*(\d+)", category, flags=re.I)
    category_short = "U" + match.group(1) if match else category
    source = "PGS" if "PGS" in game["source"].upper() else game["source"]
    coaches = [x for x in (staff.get("coach1"), staff.get("coach2")) if x] or ["—"]
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
    # First and second coach retain the order saved in the team registry.
    coach_lines = ''.join(line(('ALL. ' if i == 0 else '') + name, 'vc-coach-line')
                          for i, name in enumerate(coaches))
    staff_box = ('<div class="vc-block vc-staff"><div class="vc-coaches">'+coach_lines+
        '</div><div class="vc-managers">'+line('DIR. '+managers, 'vc-scroll')+'</div></div>')
    roles = ''
    if game['is_home']:
        for label, role in [('Arbitro', 'referee'), ('Refertista', 'scorer')]:
            name = role_names(assigned, role)
            state, _, _ = role_state(game, assigned, role)
            cls = 'vc-role-booked' if state == 'covered' else 'vc-role-open'
            roles += '<div class="vc-role '+cls+'"><b>'+role_dot(game, assigned, role)+label+'</b>'
            if name:
                roles += line(name, '')
            roles += '</div>'
    roles_box = '<div class="vc-block vc-roles">'+roles+'</div>'
    status_type = 'away' if status == 'Trasferta' else 'ready' if status == 'Completa' else 'missing'
    state_box = ('<div class="vc-block vc-state-block"><div class="vc-right-status '+status_type+
                 '" role="status">'+_e(status)+'</div></div>')
    short_name = staff.get('short_name') or game.get('our_team_name') or game['home_team' if game['is_home'] else 'away_team']
    mobile = ('<div class="vc-mobile-quick" role="group" aria-label="Lista rapida gara">'
        '<span class="vc-mobile-identity"><span class="vc-mobile-category">'+_e(category_short)+'</span>'
        '<span class="vc-mobile-source">'+_e(source)+'</span>'
        '<span class="vc-mobile-name" data-team-short="'+_e(short_name)+'">'+_e(short_name)+'</span></span>'
        '<span>'+f'{d:%d/%m}'+'</span><span>'+_e(game['time'])+'</span>'
        '<span class="vc-mobile-role">'+role_dot(game, assigned, 'referee')+'</span>'
        '<span class="vc-mobile-role">'+role_dot(game, assigned, 'scorer')+'</span></div>')
    html = ('<div class="vc-two-line" data-ui-release="'+UI_RELEASE+'" '
            'aria-label="Gara: scheda completa su PC, lista rapida su smartphone"><div class="vc-blocks">'+
            category_box+date_box+fixture_box+staff_box+roles_box+state_box+'</div>'+mobile+'</div>')
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
