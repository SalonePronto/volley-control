"""Registration and sign-in panel for officiating staff."""
from datetime import datetime
from zoneinfo import ZoneInfo
import streamlit as st
from vc_people import authenticate, people, register

@st.dialog("Arbitri e refertisti · Accesso")
def access_dialog(engine):
    sign_in, sign_up = st.tabs(["Accedi", "Prima registrazione"])
    with sign_in:
        with st.form("person_signin"):
            email = st.text_input("Email", key="person_email")
            password = st.text_input("Password", type="password", key="person_password")
            submit = st.form_submit_button("Accedi")
        if submit:
            if st.session_state.get("person_attempts", 0) >= 5:
                st.error("Troppi tentativi in questa sessione.")
            else:
                user = authenticate(engine, email, password)
                if not user:
                    st.session_state.person_attempts = st.session_state.get("person_attempts", 0) + 1
                    st.error("Credenziali non corrette.")
                elif not user["approved"]:
                    st.warning("In attesa di approvazione da PATTY.")
                else:
                    st.session_state.person_id = user["id"]
                    st.session_state.person_login_at = datetime.now(ZoneInfo("Europe/Rome")).timestamp()
                    st.rerun()
    with sign_up:
        with st.form("person_signup"):
            first = st.text_input("Nome")
            last = st.text_input("Cognome")
            mail = st.text_input("Email per i futuri accessi")
            pwd = st.text_input("Crea password (almeno 12 caratteri)", type="password")
            ref = st.checkbox("Arbitro")
            scorer = st.checkbox("Refertista")
            submit = st.form_submit_button("Richiedi registrazione")
        if submit:
            try:
                register(engine, first, last, mail, pwd, ref, scorer)
                st.success("Richiesta inviata. Attendi l’approvazione PATTY.")
            except ValueError as exc:
                st.error(str(exc))

def render_person_access(engine, persistent):
    """Returns an approved user or None. No bookings on ephemeral storage."""
    if not persistent:
        st.caption("Prenotazioni disattivate fino alla configurazione del database condiviso.")
        return None
    now = datetime.now(ZoneInfo("Europe/Rome")).timestamp()
    user_id = st.session_state.get("person_id")
    user = None
    if user_id and now - st.session_state.get("person_login_at", 0) < 8 * 3600:
        user = next((p for p in people(engine, approved_only=True) if p["id"] == user_id), None)
    if user is None:
        st.session_state.pop("person_id", None)
    with st.expander("Arbitri e refertisti · Area personale"):
        if user:
            st.success(f"{user['first_name']} {user['last_name']} · accesso abilitato")
            if st.button("Esci dall’area personale"):
                st.session_state.pop("person_id", None)
                st.rerun()
        elif st.button("Accedi oppure registrati"):
            access_dialog(engine)
    return user
