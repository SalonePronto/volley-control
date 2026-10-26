"""Displays personnel and lets approved people book available home games."""
import streamlit as st
from vc_core import coverage
from vc_people import ROLES, team_staff, people, assign, cancel, assignments_for_games

def assignment_status(game,assigned):
    return coverage(game,[a for a in assigned if a["role"]=="referee"],[a for a in assigned if a["role"]=="scorer"])

def role_names(assigned,role):
    return ", ".join(f"{a['first_name']} {a['last_name']}" for a in assigned if a["role"]==role)

def render_game_people(engine,game,organizer=False,viewer=None,persistent=False):
    key=game["game_key"]
    assigned=assignments_for_games(engine,[key]).get(key,[])
    staff=team_staff(engine,game.get("our_team_id") or "")
    st.markdown("#### Staff della squadra")
    col1,col2=st.columns(2)
    with col1:
        st.metric("Primo allenatore",staff["coach1"] or "Da inserire")
    with col2:
        st.metric("Secondo allenatore",staff["coach2"] or "—")
    st.caption("Dirigenti: "+(", ".join(staff["managers"].splitlines()) or "Da inserire"))
    st.markdown("#### Incarichi e prenotazioni")
    for role,label in ROLES.items():
        name=role_names(assigned,role)
        st.write(f"**{label}:** {name or ('Da assegnare' if game['is_home'] else 'Non richiesto')}")
    if not game["is_home"]:
        st.info("Trasferta: nessun arbitro o refertista interno richiesto.")
        return
    if not persistent:
        st.warning("Prenotazioni non disponibili: serve attivare l'archivio permanente condiviso.")
        return
    if not organizer and not viewer:
        st.info("Per prenotarti, accedi come arbitro o refertista dall'area personale sopra il calendario. Dopo l'approvazione di PATTY potrai prenotare qui.")
        return
    eligible=people(engine,approved_only=True) if organizer else [viewer]
    for role,label in ROLES.items():
        total=int(game.get("required_referees" if role=="referee" else "required_scorers",0))
        options={p["id"]:f"{p['first_name']} {p['last_name']}" for p in eligible if p["wants_"+role]}
        for slot in range(1,total+1):
            booked=next((a for a in assigned if a["role"]==role and a["slot"]==slot),None)
            if booked:
                if organizer or (viewer and viewer["id"]==booked["person_id"] and booked["source"]!="fixed"):
                    if st.button(f"Rimuovi {label}: {booked['first_name']} {booked['last_name']}",key=f"cancel_{key}_{role}_{slot}"):
                        try:
                            cancel(engine,key,role,slot,actor="PATTY" if organizer else viewer["id"])
                            st.rerun()
                        except ValueError as exc: st.error(str(exc))
                continue
            if not options:
                st.caption(f"{label}: nessuna persona abilitata disponibile per prenotarsi.")
                continue
            chosen=st.selectbox(label,list(options),format_func=lambda p:options[p],key=f"pick_{key}_{role}_{slot}") if organizer else viewer["id"]
            if st.button(f"Prenota {label}",key=f"book_{key}_{role}_{slot}"):
                try:
                    assign(engine,key,role,chosen,actor="PATTY" if organizer else viewer["id"],source="patty" if organizer else "self",slot=slot)
                    st.rerun()
                except ValueError as exc: st.error(str(exc))
