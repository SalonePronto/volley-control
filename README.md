# VOLLEY CONTROL — ramo di migrazione Cloudflare

Applicazione per calendari FIPAV/PGS, PATTY, squadre e prenotazioni di arbitri/refertisti.

**Questa branch prepara lo staging Cloudflare; non sostituisce la versione Streamlit su main.** Nessuna pubblicazione definitiva è autorizzata.

- [Consegna pronta per la chat con connettore Cloudflare](CLOUDFLARE_CONNETTORE_CONSEGNA.md)
- [Pacchetto Worker e D1 già assemblato](cloudflare/)
- [Parità funzionale e test](docs/CLOUDFLARE_PARITA_E_COLLAUDO.md)
- [Configurazione e confini di pubblicazione](docs/CLOUDFLARE_PUBBLICAZIONE.md)
- [Backup e recupero](docs/CLOUDFLARE_RECUPERO.md)
- [Incarico originale](CLOUDFLARE_MIGRAZIONE_WORK.md)

Sorgenti: `worker/`, `web/`; schema versionato: `migrations/`; test: `cloudflare-tests/`. La cartella `cloudflare/` contiene un Worker ESM unico, frontend incluso, schema SQL e payload D1 ordinato, senza credenziali o dati di prova.

Per il tecnico: Node 22.13 o superiore, `npm ci`, `npm run check`. Il controllo ricostruisce il pacchetto ed esegue i test; non crea risorse né pubblica applicazioni. Andrea non deve programmare o usare terminali.

Connessione e deploy dello staging sono affidati separatamente al connettore nell'altra chat. Non tentare accessi al pannello Cloudflare via browser. Non modificare mai Salone Pronto, i suoi Workers o il suo D1. Solo servizi gratuiti verificati, nessun upgrade o fatturazione attivata.

I sorgenti Python esistenti restano intatti per continuità e confronto; i checkpoint storici rimangono conservati.
