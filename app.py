"""VOLLEY CONTROL — weekly calendar with verified live FIPAV import.

PGS Milano connector, shared production DB configuration and account registration
are explicitly pending; the interface does not invent matches or assignments.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import hmac
import os
import streamlit as st

from vc_core import (DISPLAY_FIELDS, FIPAV_TEAMS, PGS_TEAM, coverage, download_fipav,
                     parse_date, parse_time, week_label, week_start)
from vc_storage import (audit_for_game, conflicts_for_game, list_games, modify_game,
                        open_engine, save_import)
from vc_people import init_people, apply_fixed, assignments_for_games
from vc_view_people import render_person_access
from vc_view_admin import render_club_admin
from vc_view_game import render_game_people, assignment_status, role_names

st.set_page_config(page_title="VOLLEY CONTROL", page_icon="🏐", layout="wide")


def secret(name):
    try:
        return st.secrets.get(name, os.environ.get(name, ""))
    except Exception:
        return os.environ.get(name, "")


DATABASE_URL = secret("DATABASE_URL")
PERSISTENT = bool(DATABASE_URL)
PATTY_PASSWORD = secret("PATTY_PASSWORD")


@st.cache_resource
def storage(url):
    return open_engine(url)


try:
    engine = storage(DATABASE_URL)
    init_people(engine)
except Exception as exc:
    st.error("Database non disponibile. Nessun dato è stato modificato.")
    st.caption(f"Diagnostica: {type(exc).__name__}")
    st.stop()


st.markdown("""<style>
.stApp {background:#eff4f9;color:#183657}
.block-container{max-width:1300px;padding-top:1.1rem}
.hero{background:linear-gradient(110deg,#102b4c,#166193);color:white;padding:24px;border-radius:17px;margin-bottom:20px}
.hero h1{font-size:2rem;color:white;margin:0}.hero p{color:#d5eafa;margin:.5rem 0 0}
[data-testid="stMetric"]{background:white;padding:13px;border:1px solid #dae5f0;border-radius:12px}
.stButton>button{border-radius:10px;min-height:40px}
</style>""", unsafe_allow_html=True)
st.markdown('<div class="hero"><h1>🏐 VOLLEY CONTROL</h1><p>Calendario settimanale · FIPAV Como · PGS Milano in preparazione</p></div>', unsafe_allow_html=True)

if not DATABASE_URL:
    st.warning("Archivio di anteprima: su Streamlit Community Cloud i dati locali possono sparire ai riavvii. Per conservarli davvero fra accessi e riavvii serve configurare DATABASE_URL con un database esterno.")


def run_sync(results_only=False):
    all_games = []
    errors = []
    for team in FIPAV_TEAMS:
        try:
            all_games.extend(download_fipav(team))
        except Exception as exc:
            errors.append(f"{team['team_name']}: {type(exc).__name__} — {exc}")
    if not all_games:
        return None, errors
    report = save_import(engine, all_games, only_results=results_only)
    if not results_only:
        fixed = apply_fixed(engine)
        errors.extend(fixed["conflicts"])
    return report, errors


if "initial_loaded" not in st.session_state:
    st.session_state.initial_loaded = True
    if not list_games(engine):
        with st.spinner("Caricamento delle gare reali dai calendari FIPAV…"):
            initial_report, initial_errors = run_sync()
        if initial_report:
            st.session_state.initial_report = initial_report
        if initial_errors:
            st.session_state.initial_errors = initial_errors


@st.dialog("PATTY · Accesso organizzatore")
def patty_login():
    if not PATTY_PASSWORD:
        st.error("Password non ancora configurata nei segreti di Streamlit. L'accesso alle modifiche resta disabilitato.")
        return
    if st.session_state.get("patty_attempts", 0) >= 5:
        st.error("Troppi tentativi in questa sessione. Chiudi la sessione e contatta l'amministratore.")
        return
    with st.form("patty_login_form"):
        password = st.text_input("Password organizzatore", type="password")
        submitted = st.form_submit_button("Accedi")
    if submitted:
        if hmac.compare_digest(password.encode(), PATTY_PASSWORD.encode()) and password:
            st.session_state.patty_authenticated = True
            st.session_state.patty_login_at = datetime.now(ZoneInfo("Europe/Rome")).timestamp()
            st.rerun()
        else:
            st.session_state.patty_attempts = st.session_state.get("patty_attempts", 0) + 1
            st.error("Password non corretta.")


now_timestamp = datetime.now(ZoneInfo("Europe/Rome")).timestamp()
admin = bool(st.session_state.get("patty_authenticated")) and (
    now_timestamp - st.session_state.get("patty_login_at", 0) < 1800)
if not admin:
    st.session_state.patty_authenticated = False

viewer = render_person_access(engine, PERSISTENT)

left, right = st.columns([5, 1], vertical_alignment="center")
with left:
    st.markdown("**Calendario gare** · Tutte le squadre, ordinate per data e ora")
with right:
    if admin:
        if st.button("🔓 Esci da PATTY", use_container_width=True):
            st.session_state.patty_authenticated = False
            st.rerun()
    elif st.button("🔒 PATTY", use_container_width=True, type="primary"):
        patty_login()

if "initial_errors" in st.session_state:
    for error in st.session_state.pop("initial_errors"):
        st.error(f"Download iniziale: {error}")

if admin:
    st.markdown("#### PATTY · Comandi riservati")
    c1, c2 = st.columns(2)
    if c1.button("↻ Aggiorna calendari FIPAV", type="primary", use_container_width=True):
        with st.spinner("Sincronizzo FIPAV con il database…"):
            report, errors = run_sync(False)
        if report:
            st.success(f"FIPAV: {report['inserted']} nuove gare, {report['updated']} aggiornate, {report['unchanged']} invariate.")
        for error in errors:
            st.error(error)
    if c2.button("↻ Aggiorna risultati", use_container_width=True):
        with st.spinner("Aggiorno i risultati FIPAV senza duplicare gare…"):
            report, errors = run_sync(True)
        if report:
            st.success(f"Risultati: {report['updated']} gare aggiornate, {report['unchanged']} invariate.")
        for error in errors:
            st.error(error)
    st.info("PGS Milano · U11 PVI ARDOR 2K GIUSSANO: accesso già provato con Work; importazione Python da verificare.")
    render_club_admin(engine, PERSISTENT)

games = list_games(engine)
if not games:
    st.info("Nessuna gara ancora salvata. Il primo recupero automatico FIPAV non ha prodotto dati: l'organizzatore può riprovare da PATTY dopo aver configurato la password.")
    st.stop()

this_week = week_start(datetime.now(ZoneInfo("Europe/Rome")).date())
weeks = sorted({week_start(g["date"]) for g in games})
selected_week_str = st.session_state.get("selected_week", "")
if selected_week_str:
    selected_week = next((w for w in weeks if w.isoformat() == selected_week_str), None)
else:
    selected_week = None
if selected_week is None:
    selected_week = next((w for w in weeks if w >= this_week), weeks[-1])

st.markdown("#### Seleziona la settimana")
for idx in range(0, len(weeks), 3):
    columns = st.columns(3)
    for col, week in zip(columns, weeks[idx:idx + 3]):
        if col.button(week_label(week), key=f"wk_{week.isoformat()}",
                      type="primary" if selected_week == week else "secondary", use_container_width=True):
            st.session_state.selected_week = week.isoformat()
            st.rerun()

week_games = [g for g in games if week_start(g["date"]) == selected_week]
bookings = assignments_for_games(engine, [g["game_key"] for g in week_games])
statuses = [assignment_status(g,bookings.get(g["game_key"],[])) for g in week_games]
needs = [s for s in statuses if s not in ("Trasferta", "Completa")]
missing_ref = sum(max(0,int(g.get("required_referees",0))-sum(a["role"]=="referee" for a in bookings.get(g["game_key"],[]))) for g in week_games if g["is_home"])
missing_score = sum(max(0,int(g.get("required_scorers",0))-sum(a["role"]=="scorer" for a in bookings.get(g["game_key"],[]))) for g in week_games if g["is_home"])

st.markdown(f"### {week_label(selected_week)}")
metrics = st.columns(5)
for c, title, value in zip(metrics, ["Partite", "Complete", "Da completare", "Arbitri mancanti", "Refertisti mancanti"],
                           [len(week_games), statuses.count("Completa"), len(needs), missing_ref, missing_score]):
    c.metric(title, value)
st.caption("Per ora non sono attive anagrafiche e prenotazioni: gli incarichi casalinghi sono conteggiati come vacanti. Le trasferte non richiedono incarichi interni, salvo decisione dell'organizzatore.")


@st.dialog("Scheda partita", width="large")
def show_game(key):
    game = next((g for g in list_games(engine) if g["game_key"] == key), None)
    if not game:
        st.error("Gara non più presente nell'archivio.")
        return
    d = datetime.fromisoformat(game["date"])
    st.subheader(f"{game['home_team']} – {game['away_team']}")
    st.markdown(f"**{d:%d/%m/%Y} · {game['time']} · {game['category']}**")
    st.write(f"**Fonte:** {game['source']} | **Numero gara:** {game['game_number'] or 'Non presente'} | **Sede:** {'Casa' if game['is_home'] else 'Trasferta'}")
    st.write(f"**Palestra:** {game['venue']}")
    st.write(f"**Indirizzo:** {game['address'] or 'Indirizzo non presente nel feed ufficiale'}")
    st.write(f"**Copertura:** {assignment_status(game,assignments_for_games(engine,[key]).get(key,[]))}")
    render_game_people(engine,game,organizer=admin,viewer=viewer,persistent=PERSISTENT)
    if game.get("played"):
        st.write(f"**Risultato:** {game.get('home_sets', '—')} – {game.get('away_sets', '—')}")
        if game.get("sets"):
            st.write("**Parziali:** " + ", ".join(f"{i+1}° {p['home']}–{p['away']}" for i, p in enumerate(game["sets"])))
    else:
        st.write("**Risultato:** non ancora disponibile")
    if game.get("notes"):
        st.write(f"**Note:** {game['notes']}")
    if admin:
        st.divider()
        st.markdown("#### PATTY · Correggi dato")
        fields = [f for f in DISPLAY_FIELDS if f in game]
        with st.form(f"edit_{key}"):
            field = st.selectbox("Campo", fields, format_func=lambda f: DISPLAY_FIELDS[f])
            raw = st.text_input("Nuovo valore", placeholder="Inserisci il valore corretto")
            reason = st.text_input("Motivo della correzione (facoltativo)")
            save = st.form_submit_button("Salva modifica", type="primary")
        if save:
            try:
                if field == "date":
                    value = parse_date(raw)
                elif field == "time":
                    value = parse_time(raw)
                elif field == "played":
                    if raw.lower().strip() not in ("true", "false"):
                        raise ValueError("Per partita disputata scrivi true oppure false")
                    value = raw.lower().strip() == "true"
                elif field in ("home_sets", "away_sets", "required_referees", "required_scorers"):
                    value = int(raw)
                    if value < 0 or value > 10:
                        raise ValueError("Valore fuori intervallo 0–10")
                else:
                    value = raw.strip()
                    if not value and field != "notes":
                        raise ValueError("Il campo non può essere vuoto")
                modify_game(engine, key, field, value, reason)
                st.success("Modifica salvata e registrata nello storico.")
            except (ValueError, KeyError) as exc:
                st.error(str(exc))
        conflicts = conflicts_for_game(engine, key)
        if conflicts:
            st.warning("FIPAV riporta dati diversi da quelli corretti manualmente. La correzione PATTY è conservata.")
            for conflict in conflicts:
                st.write(f"• {DISPLAY_FIELDS.get(conflict['field'],conflict['field'])}: valore ufficiale ricevuto {conflict['incoming']}")
        with st.expander("Storico modifiche"):
            history = audit_for_game(engine, key)
            for entry in history:
                st.write(f"{entry['changed_at']} · {entry['field']} · {entry['old_value']} → {entry['new_value']} · {entry['actor']}")
            if not history:
                st.caption("Nessuna modifica manuale.")


ITALIAN_WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]
for g in week_games:
    d = datetime.fromisoformat(g["date"])
    status = assignment_status(g,bookings.get(g["game_key"],[]))
    result = f" · Ris. {g.get('home_sets')}–{g.get('away_sets')}" if g.get("played") else ""
    with st.container(border=True):
        a, b, c = st.columns([2, 4, 4], vertical_alignment="center")
        with a:
            st.markdown(f"**{ITALIAN_WEEKDAYS[d.weekday()]} {d:%d/%m/%Y}**")
            st.markdown(f"### {g['time']}")
            st.caption(f"{g['category']} · Gara {g.get('game_number') or '—'}")
        with b:
            st.markdown(f"**{g['home_team']} – {g['away_team']}**")
            st.write(f"{'🏠 CASA' if g['is_home'] else '🚗 TRASFERTA'} · {g['source']}{result}")
            st.caption(f"{g['venue']} · {g['address'] or 'Indirizzo ufficiale non presente'}")
        with c:
            st.markdown(f"**{status}**")
            assigned=bookings.get(g["game_key"],[])
            ref=role_names(assigned,"referee") or ("Da assegnare" if g["is_home"] else "Non richiesto")
            scorer=role_names(assigned,"scorer") or ("Da assegnare" if g["is_home"] else "Non richiesto")
            st.caption(f"Arbitro: {ref} · Refertista: {scorer}")
            if st.button("Apri scheda partita", key=f"game_{g['game_key']}", use_container_width=True):
                show_game(g["game_key"])

st.caption("Fonti: FIPAV Como (dati recuperati online da Python). PGS Milano U11 PVI ARDOR 2K GIUSSANO: collegamento automatico ancora da completare. Le date settimanali non riportano il numero di giornata.")
