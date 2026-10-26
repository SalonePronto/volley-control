"""Scheda partita: presentazione compatta, nominativi e prenotazioni esistenti."""
from html import escape
import streamlit as st
from vc_core import coverage
from vc_people import ROLES, team_staff, assign, cancel, assignments_for_games


def inject_sheet_css():
    st.markdown("""<style>
    [data-testid="stDialog"] [role="dialog"] {max-width:1000px;width:calc(100% - 2rem);}
    .vc-info {border:1px solid #dae5ee;background:#fff;border-radius:12px;
      padding:9px 11px;margin-bottom:6px;overflow-wrap:anywhere;}
    .vc-info-title {font-size:.73rem;text-transform:uppercase;letter-spacing:.03em;
      font-weight:800;color:#557188;margin-bottom:6px;}
    .vc-info-main {font-size:.96rem;font-weight:750;color:#193b5c;line-height:1.35;}
    .vc-info-detail {font-size:.81rem;color:#596e80;line-height:1.45;margin-top:4px;}
    .vc-section {font-size:.97rem;font-weight:800;color:#193b5c;margin:9px 0 7px;}
    </style>""", unsafe_allow_html=True)


def assignment_status(game, assigned):
    return coverage(game, [a for a in assigned if a["role"] == "referee"],
                    [a for a in assigned if a["role"] == "scorer"])


def role_names(assigned, role):
    return ", ".join(f"{a['first_name']} {a['last_name']}"
                     for a in assigned if a["role"] == role)


def info_card(title, main, detail=""):
    st.markdown('<div class="vc-info"><div class="vc-info-title">'
                + escape(str(title)) + '</div><div class="vc-info-main">'
                + escape(str(main)) + '</div><div class="vc-info-detail">'
                + escape(str(detail)) + '</div></div>', unsafe_allow_html=True)


def render_game_people(engine, game, organizer=False, viewer=None, persistent=False):
    """Show only names for occupied roles, never a PATTY assignment option."""
    inject_sheet_css()
    key = game["game_key"]
    assigned = assignments_for_games(engine, [key]).get(key, [])
    staff = team_staff(engine, game.get("our_team_id") or "")
    status = assignment_status(game, assigned)
    coaches = staff["coach1"] or "Da inserire"
    managers = ", ".join(staff["managers"].splitlines()) or "Da inserire"
    referee = role_names(assigned, "referee") or ("Da assegnare" if game["is_home"] else "Non richiesto")
    scorer = role_names(assigned, "scorer") or ("Da assegnare" if game["is_home"] else "Non richiesto")

    a, b = st.columns(2, gap="small")
    with a:
        info_card("Staff squadra", coaches,
                  f"Secondo allenatore: {staff['coach2'] or '—'} · Dirigenti: {managers}")
    with b:
        info_card("Copertura", status, f"Arbitro: {referee} · Refertista: {scorer}")

    if not game["is_home"]:
        st.caption("Trasferta: la società non richiede arbitro e refertista interni.")
        return

    st.markdown('<div class="vc-section">Prenotazioni · Gare in casa</div>',
                unsafe_allow_html=True)
    for role, label in ROLES.items():
        total = int(game.get("required_referees" if role == "referee" else "required_scorers", 0))
        for slot in range(1, total + 1):
            booked = next((a for a in assigned if a["role"] == role and a["slot"] == slot), None)
            title = label if total == 1 else f"{label} · posto {slot}"
            if booked:
                name = escape(f"{booked['first_name']} {booked['last_name']}")
                st.markdown(f"**{title}:** {name}")
                if persistent and viewer and viewer["id"] == booked["person_id"] and booked["source"] != "fixed":
                    if st.button("Annulla la mia prenotazione", key=f"cancel_{key}_{role}_{slot}"):
                        try:
                            cancel(engine, key, role, slot, actor=viewer["id"])
                            st.rerun()
                        except ValueError as exc:
                            st.error(str(exc))
            else:
                left, right = st.columns([4, 1.4], vertical_alignment="center")
                with left:
                    st.markdown(f"**{title}:** Posto libero")
                with right:
                    allowed = bool(persistent and viewer and viewer.get("approved")
                                   and viewer.get("wants_" + role))
                    reason = ("Database condiviso non ancora configurato" if not persistent
                              else "Accedi con un account approvato e abilitato al ruolo")
                    if st.button("Mi prenoto", key=f"book_{key}_{role}_{slot}",
                                 disabled=not allowed, help=None if allowed else reason,
                                 use_container_width=True):
                        try:
                            assign(engine, key, role, viewer["id"], actor=viewer["id"],
                                   source="self", slot=slot)
                            st.rerun()
                        except ValueError as exc:
                            st.error(str(exc))
    if not persistent:
        st.caption("Prenotazioni disattivate finché non sarà attivo il database condiviso.")
    elif not viewer and not organizer:
        st.caption("Per prenotarti, accedi nell'area personale arbitri/refertisti sopra il calendario.")

    if organizer and persistent and assigned:
        with st.expander("PATTY · Rimuovi incarico"):
            for person in assigned:
                role, slot = person["role"], person["slot"]
                name = f"{person['first_name']} {person['last_name']}"
                if st.button(f"Rimuovi {ROLES[role]}: {name}",
                             key=f"patty_cancel_{key}_{role}_{slot}"):
                    try:
                        cancel(engine, key, role, slot, actor="PATTY")
                        st.rerun()
                    except ValueError as exc:
                        st.error(str(exc))
