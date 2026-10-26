"""Organizer-only completion of real matches missing a date or start time."""
import hashlib
import streamlit as st
from vc_core import week_start, week_label
from vc_pending import complete_pending
from vc_people import apply_fixed


def render_pending_editor(engine, pending_games, persistent=False):
    message = st.session_state.pop('pending_saved', None)
    if message:
        st.success(message)
        for warning in st.session_state.pop('pending_fixed_conflicts', []):
            st.warning(warning)
    if not pending_games:
        return
    with st.expander(f"🔵 Gare con dati primari incompleti ({len(pending_games)})", expanded=False):
        st.caption("Inserisci data e ora confermate: la gara comparirà subito nella settimana corretta. Le correzioni PATTY restano valide dopo gli aggiornamenti delle fonti.")
        if not persistent:
            st.caption("Attenzione: il database attuale è di anteprima. Anche queste correzioni possono andare perse al riavvio del server.")
        for item in pending_games:
            key = item['game_key']
            short = hashlib.sha256(key.encode()).hexdigest()[:14]
            st.markdown(f"**{item['source']} · {item['category']} · Gara {item['game_number']}** — {item['home_team']} – {item['away_team']}")
            st.caption(f"{'Casa' if item['is_home'] else 'Trasferta'} · {item.get('venue') or 'Palestra da indicare'}")
            with st.form('pending_' + short):
                date_col, time_col = st.columns(2)
                date_value = date_col.text_input("Data (GG/MM/AAAA)", value=item.get('date') or '', key='pending_date_' + short,
                                                placeholder="Data confermata della gara")
                time_value = time_col.text_input("Ora (HH:MM)", value=item.get('time') or '', key='pending_time_' + short,
                                                placeholder="Ora confermata della gara")
                reason = st.text_input("Motivo / riferimento (facoltativo)", key='pending_reason_' + short)
                submitted = st.form_submit_button("Salva e inserisci nel calendario", type="primary")
            if submitted:
                try:
                    game = complete_pending(engine, key, date_value, time_value, reason)
                except ValueError as exc:
                    st.error(str(exc))
                else:
                    # The match is already committed. Staffing warnings must not
                    # make a successful schedule save look like a failed save.
                    try:
                        fixed = apply_fixed(engine)
                        warnings = fixed['conflicts']
                    except Exception:
                        warnings = ["Gara salvata. Verifica gli incarichi fissi dalla scheda squadra."]
                    week = week_start(game['date'])
                    st.session_state.selected_week = week.isoformat()
                    st.session_state.pending_saved = f"Gara {game['game_number']} inserita in {week_label(week)} alle {game['time']}."
                    st.session_state.pending_fixed_conflicts = warnings
                    st.rerun()
