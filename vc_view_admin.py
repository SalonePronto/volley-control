"""PATTY-only team editor."""
import streamlit as st
from vc_core import FIPAV_TEAMS, PGS_TEAM
from vc_people import people, approval, ROLES, team_staff, update_team_staff, fixed_for_team, set_fixed, apply_fixed

def render_club_admin(engine, persistent):
    if not persistent:
        st.warning("Il database permanente non è configurato: le anagrafiche sono disattivate.")
        return
    with st.expander("PATTY · Persone e squadre"):
        registry=people(engine)
        for p in registry:
            if p["approved"]: continue
            a,b=st.columns([4,1])
            a.write(f"{p['first_name']} {p['last_name']} · {p['email']}")
            if b.button("Approva",key="approve_"+p["id"]):
                approval(engine,p["id"],True)
                st.rerun()
        approved=[p for p in registry if p["approved"]]
        names={p["id"]:f"{p['first_name']} {p['last_name']}" for p in approved}
        for team in FIPAV_TEAMS+[PGS_TEAM]:
            tid=str(team["team_id"])
            st.divider()
            st.write(f"**{team['team_name']} · {team['category']}**")
            staff=team_staff(engine,tid)
            with st.form("staff_"+tid):
                c1=st.text_input("Primo allenatore",value=staff["coach1"])
                c2=st.text_input("Secondo allenatore",value=staff["coach2"])
                mgr=st.text_area("Dirigenti (uno per riga)",value=staff["managers"])
                if st.form_submit_button("Salva scheda squadra"):
                    update_team_staff(engine,tid,c1,c2,mgr)
                    st.success("Salvato")
            fixed=fixed_for_team(engine,tid)
            for role,label in ROLES.items():
                eligible={p["id"]:names[p["id"]] for p in approved if p["wants_"+role]}
                options=[""]+list(eligible)
                selection=fixed.get(role,"")
                chosen=st.selectbox(f"{label} FISSO",options,index=options.index(selection) if selection in options else 0,format_func=lambda x:eligible.get(x,"Nessuno"),key=f"fixed_{tid}_{role}")
                if st.button("Salva incarico fisso",key=f"save_{tid}_{role}"):
                    try:
                        set_fixed(engine,tid,role,chosen or None)
                        report=apply_fixed(engine)
                        st.success(f"Incarichi inseriti: {report['created']}")
                        for err in report["conflicts"]: st.warning(err)
                    except ValueError as exc: st.error(str(exc))
