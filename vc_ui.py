"""Compact, mobile-friendly weekly fixture rows for VOLLEY CONTROL."""
import hashlib
from html import escape
import streamlit as st


def _e(value):
    return escape(str(value if value is not None else "—"))


def inject_calendar_css():
    st.markdown("""<style>
    [class*="st-key-vcrow_"] {background:#ffffff; border:1px solid #dbe6f0; border-radius:11px;
        padding:7px 10px; margin-bottom:5px; box-shadow:0 1px 2px rgba(25,52,78,.035);}
    [class*="st-key-vcrow_"] [data-testid="stHorizontalBlock"] {gap:.45rem;}
    [class*="st-key-vcrow_"] [data-testid="stVerticalBlock"] {gap:0;min-width:0;}
    [class*="st-key-vcrow_"] [data-testid="stColumn"] {min-width:0;overflow-wrap:anywhere;}
    [class*="st-key-vcrow_"] .vc-date {font-weight:800;font-size:.88rem;line-height:1.3;white-space:normal;overflow-wrap:anywhere;color:#193f64;}
    [class*="st-key-vcrow_"] .vc-small {font-size:.73rem;color:#5b6f83;line-height:1.3;}
    [class*="st-key-vcrow_"] .vc-team {font-weight:750;font-size:.91rem;line-height:1.3;color:#183657;overflow-wrap:anywhere;}
    [class*="st-key-vcrow_"] .vc-facility,[class*="st-key-vcrow_"] .vc-staff,[class*="st-key-vcrow_"] .vc-names {
        font-size:.73rem;line-height:1.35;color:#5c7084;white-space:normal;overflow-wrap:anywhere;word-break:normal;}
    [class*="st-key-vcrow_"] .vc-state {font-size:.82rem;font-weight:800;line-height:1.4;color:#b06b13;}
    [class*="st-key-vcrow_"] .vc-state.good {color:#16704b;}
    [class*="st-key-vcrow_"] .vc-state.away {color:#246699;}
    [class*="st-key-vcrow_"] [class*="st-key-vcopen_"] button {min-height:35px!important;height:35px!important;
        min-width:92px!important;width:100%!important;padding:0 .3rem!important;border-radius:9px!important;
        font-size:.76rem!important;font-weight:700!important;white-space:nowrap!important;}
    @media(max-width:750px) {
      [class*="st-key-vcrow_"] {padding:8px;}
      [class*="st-key-vcrow_"] .vc-date,[class*="st-key-vcrow_"] .vc-team {white-space:normal;}
      [class*="st-key-vcrow_"] .vc-facility,[class*="st-key-vcrow_"] .vc-staff,[class*="st-key-vcrow_"] .vc-names {white-space:normal;}
    }
    </style>""",unsafe_allow_html=True)


WEEKDAYS = ("Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom")


def compact_game_row(game, assigned, status, staff, on_open):
    """All required information stays on one compact calendar card."""
    from datetime import datetime
    from vc_view_game import role_names
    d = datetime.fromisoformat(game["date"])
    short = hashlib.sha256(game["game_key"].encode("utf-8")).hexdigest()[:14]
    location = "CASA" if game["is_home"] else "TRASFERTA"
    coaches = ", ".join(x for x in (staff.get("coach1"),staff.get("coach2")) if x) or "—"
    managers = ", ".join(staff.get("managers","").splitlines()).strip(", ") or "—"
    ref = role_names(assigned,"referee") or ("Da assegnare" if game["is_home"] else "Non richiesto")
    scorer = role_names(assigned,"scorer") or ("Da assegnare" if game["is_home"] else "Non richiesto")
    tone = "good" if status=="Completa" else "away" if status=="Trasferta" else ""
    score = ""
    if game.get("played"):
        score = f" · {_e(game.get('home_sets'))}–{_e(game.get('away_sets'))}"
    with st.container(border=False,key="vcrow_"+short):
        a,b,c,action = st.columns([1.7,5.0,3.3,1.55],vertical_alignment="center",gap="small")
        with a:
            st.markdown(
              f'<div class="vc-date">{WEEKDAYS[d.weekday()]} {d:%d/%m} · {_e(game["time"])}</div>'
              f'<div class="vc-small">{_e(game["category"])} · Gara {_e(game.get("game_number") or "—")}</div>',
              unsafe_allow_html=True)
        with b:
            st.markdown(
              f'<div class="vc-team">{_e(game["home_team"])} – {_e(game["away_team"])}{score}</div>'
              f'<div class="vc-facility">{location} · {_e(game.get("venue") or "Palestra da indicare")} · {_e(game.get("address") or "Indirizzo non presente")}</div>'
              f'<div class="vc-staff">All.: {_e(coaches)} &nbsp;·&nbsp; Dir.: {_e(managers)}</div>',
              unsafe_allow_html=True)
        with c:
            st.markdown(
              f'<div class="vc-state {tone}">{_e(status)}</div>'
              f'<div class="vc-names">Arbitro: {_e(ref)}</div>'
              f'<div class="vc-names">Refertista: {_e(scorer)}</div>',
              unsafe_allow_html=True)
        with action:
            if st.button("Vedi scheda",key="vcopen_"+short,help="Apri scheda e prenotazioni",use_container_width=True):
                on_open(game["game_key"])
