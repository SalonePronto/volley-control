import json
from collections import Counter
from datetime import datetime, timedelta
import requests
import streamlit as st

st.set_page_config(page_title="VOLLEY CONTROL", page_icon="🏐", layout="wide")
TEAMS = [
    {"name":"PVI Studio Ottolina", "category":"U15 Femminile", "girone":63945, "expected":7},
    {"name":"PVI Pinuccè", "category":"U17 Femminile", "girone":63942, "expected":8},
]
API = "https://data.fipavonline.it/api/v2/calendar/0/{}"
st.markdown("""<style>
.stApp{background:#eff4f9;color:#183657}
.block-container{max-width:1160px;padding-top:2rem}
.hero{background:linear-gradient(105deg,#102b4c,#166193);color:white;padding:30px;border-radius:20px;margin-bottom:22px}
.hero h1{color:white;font-size:2.15rem;margin:0}.hero p{color:#d5eafa;margin:5px 0 0}
[data-testid="stMetric"]{background:white;padding:16px;border:1px solid #dae5f0;border-radius:14px}
.stButton>button[kind=primary]{background:#155fc1;color:white;border-radius:12px;min-height:52px}
</style>""",unsafe_allow_html=True)
st.markdown('<div class="hero"><h1>🏐 VOLLEY CONTROL</h1><p>Centro operativo · Prova di lettura calendari FIPAV</p></div>',unsafe_allow_html=True)
if "results" not in st.session_state:
    st.session_state.results = {}
st.markdown("### Organizzatore")
st.write("Premi il pulsante per verificare se Python riesce a scaricare i calendari direttamente da FIPAV.")
def download(team):
    url=API.format(team["girone"])
    try:
        response=requests.get(url,timeout=25,headers={"Accept":"application/json","User-Agent":"Mozilla/5.0 VolleyControlTest/0.3"})
        response.raise_for_status()
        payload=response.json()
        return {"ok":True,"http":response.status_code,"data":payload,"bytes":len(response.content),"url":url}
    except Exception as e:
        return {"ok":False,"error":f"{type(e).__name__}: {e}","url":url}
if st.button("↻ Aggiorna calendari FIPAV",type="primary",use_container_width=True):
    with st.spinner("Controllo dei calendari FIPAV in corso…"):
        st.session_state.results={str(t["girone"]):download(t) for t in TEAMS}
    st.session_state.checked_at=datetime.now().strftime("%d/%m/%Y %H:%M:%S")
results=st.session_state.results
good=sum(v["ok"] for v in results.values())
cols=st.columns(3)
cols[0].metric("Squadre registrate",2)
cols[1].metric("Partite già note",15)
cols[2].metric("Download riusciti",f"{good}/2" if results else "Non eseguito")
st.caption("Le 15 partite note provengono dai file recuperati da Work: non vengono conteggiate come scaricate da Python.")
st.markdown("### Esito della prova")
for t in TEAMS:
    k=str(t["girone"]); result=results.get(k)
    with st.container(border=True):
        st.markdown(f'**{t["name"]}** · {t["category"]} · Girone {k}')
        if result is None:
            st.info("Verifica non ancora effettuata.")
        elif result["ok"]:
            st.success(f'Collegamento riuscito · HTTP {result["http"]} · {result["bytes"]} byte ricevuti')
            st.download_button("Scarica calendario JSON",json.dumps(result["data"],ensure_ascii=False,indent=2),file_name=f"fipav_{k}.json",mime="application/json",key=k)
            with st.expander("Visualizza dati ricevuti"):
                st.json(result["data"],expanded=False)
        else:
            st.error(f'Download non riuscito: {result["error"]}')
        st.caption(result["url"] if result is not None else API.format(t["girone"]))
if results:
    report=[{"squadra":t["name"],"girone":t["girone"],**{k:v for k,v in results[str(t["girone"])].items() if k!="data"}} for t in TEAMS]
    st.download_button("Scarica report della prova",json.dumps(report,ensure_ascii=False,indent=2),file_name="volley_control_test_report.json",mime="application/json")
    st.caption("Ultimo controllo: "+st.session_state.checked_at)
st.warning("Questa è soltanto una prova di download. Il raggruppamento delle settimane, le prenotazioni e l'archivio condiviso arriveranno dopo la verifica dei dati.")
