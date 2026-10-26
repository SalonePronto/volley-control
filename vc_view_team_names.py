"""Short-name preferences, displayed only from the authenticated PATTY section."""
import streamlit as st
from vc_core import FIPAV_TEAMS, PGS_TEAMS
from vc_team_names import display_names, name_key, save_display_name


def render_team_names(engine, persistent):
    with st.expander('PATTY · Nomi brevi per smartphone'):
        st.caption('Il nome breve distingue le squadre della stessa categoria. Il nome ufficiale completo resta nella scheda partita.')
        if not persistent:
            st.caption('Archivio di anteprima: anche questi nomi possono andare persi al riavvio del server, finché manca il database permanente.')
        names=display_names(engine)
        for source,teams in [('FIPAV',FIPAV_TEAMS),('PGS',PGS_TEAMS)]:
            for team in teams:
                key=name_key(source,team['team_id'])
                with st.form('short_name_'+source+'_'+key[1]):
                    value=st.text_input(f"{team['category']} · {source} · {team['team_name']}",
                                        value=names.get(key,team['team_name']))
                    if st.form_submit_button('Salva nome breve'):
                        try:
                            save_display_name(engine,source,team['team_id'],value)
                        except ValueError as exc:
                            st.error(str(exc))
                        else:
                            st.success('Nome breve salvato. Le gare e i nomi ufficiali restano gli stessi.')
