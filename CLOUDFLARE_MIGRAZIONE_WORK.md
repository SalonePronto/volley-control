# VOLLEY CONTROL — CONSEGNA PER WORK: MIGRAZIONE SU CLOUDFLARE

Data: 2026-10-27. Stato: **incarico autorizzato dall'utente** alla migrazione; questo file non costituisce prova di migrazione completata.

## Fonte autorevole e isolamento

- Repository: `SalonePronto/volley-control`, ramo originale `main` (ultima versione vista `7a72ddb087e8f1bfb6f7b795392e2fda25b79e6e`).
- Lavorare SOLO su ramo `cloudflare-migrazione`, verificando sempre che il ramo main non sia avanzato.
- App precedente Streamlit: https://volley-control-afkrxmk83jvosswifhbbts.streamlit.app/ ; tenerla operativa, nessuna interruzione o cancellazione.
- Cloudflare account già autorizzato: `be2a6531623a2d7500aabcf3a6efe5ce`. ATTENZIONE: ospita **Salone Pronto** e ha già D1 `salone-pronto-db`; non modificarli **mai**. Creare risorse specifiche `volley-control-*` sul piano Free dopo verifica.
- La connessione Cloudflare potrebbe non consentire accesso alla fatturazione: NON presumere dettagli del piano né abilitare un piano Paid o consumi extra. Se un passaggio richiede pagamento, fermarsi e segnalarlo.

## Obiettivo

Convertire l'app Python/Streamlit in web app Cloudflare, con frontend responsive + Cloudflare Worker backend + Cloudflare D1 persistente, affinché dopo 4 o più giorni senza utilizzo gli utenti aprano normalmente il link, senza riattivazione Streamlit. 20 squadre FIPAV/PGS, PATTY organizzatrice, anagrafica/refertisti/arbitri, incarichi, calendari e risultati, override, audit, prenotazioni. Utilizzo gratuito entro i limiti documentati.

NON portare Python Streamlit nel Worker pensando che funzioni invariato: migrare logica e stato, conservare UX e comportamenti. Non inventare partite/risultati. Codice originale e storia git come riferimento.

## Informazioni sullo stato precedente

- L'app Python usa `app.py`, `vc_storage.py`, `vc_people.py`, `vc_view_game.py`, `vc_view_admin.py`, `vc_team_names.py`, `vc_view_team_names.py`, `vc_ui.py`, e altri file del repo.
- L'archivio SQLite attuale è temporaneo (default `/tmp/volley_control_preview.sqlite3`): **non fidarsi per dati persistenti**; `DATABASE_URL` non era configurato all'ultima verifica.
- Calendari ufficiali attuali: FIPAV Como Studio Ottolina U15 e Pinuccè U17; PGS Milano Ardor 2K Giussano U11. Crescita a circa 20 squadre. I dati acquisiti reali e gli identificativi provengono dal sorgente: leggere il codice, non introdurre dati fittizi in produzione.
- Sorgenti FIPAV e PGS: verificare la rete/api, controllare CORS, autenticazione, condizioni d'uso e correttezza degli aggiornamenti; usare backend per richieste sensibili e throttling.
- C'è una logica esistente per FIXED/FISSO, per utenti, rilevamento collisioni di prenotazione, override e archivio audit: portarla e testarla, senza dare per scontato che sia bug-free.
- Test Python precedenti: 19 superati; non equivalgono al collaudo dell'app Cloudflare.
- Ultime decisioni grafiche: desktop fasce 87px; smartphone righe circa 36px senza scroll orizzontale con comitato (FIPAV/PGS), categoria, nome squadra abbreviato, data/ora, ARB e REF, scheda completa. Nomi brevi modificabili da PATTY. Pallino VERDE acceso `#00e65f` e ✓ per coperto; ROSSO acceso `#ff1744` e ! per mancante. Trasferta = — (non richiede copertura interna).
- La home apre sulle sole gare casalinghe della settimana corrente con ruoli scoperti. Clic su linguetta settimanale apre tutte le partite (comprese trasferte e coperte). I dettagli sono accessibili via «Vedi scheda».
- Prenotazione `Mi prenoto` solo per persona autorizzata e gara casalinga con ruolo disponibile; nessuna doppia prenotazione dello stesso ruolo o di un utente nella medesima gara; evitare anche conflitti temporali. Stato riservato visibile in UI, aggiornato in modo atomico.
- Ruoli abituali esclusivamente modalità `FISSO`: assegnazione automatica diretta alle gare casalinghe, modificabile/rimuovibile da PATTY per squadra e per singola gara. NIENTE modalità suggerita/predefinita. Distinguere incarichi confermati da scoperti.
- PATTY gestisce squadre, anagrafiche, autorizzazioni, nomi brevi, assegnazioni, modifiche e annullamenti, calendari/risultati, gare senza data. Aggiornamenti non devono cancellare override manuali/prenotazioni o duplicare partite.
- Le nuove squadre devono poter essere aggiunte senza interventi sul codice.
- Non è consentito introdurre modalità nuove, cambiare grafica o funzionalità fuori da questa migrazione senza autorizzazione.

## Sicurezza, privacy e continuità

- PATTY e collaboratori: credenziali e sessioni sicure, password con hashing robusto, cookie HttpOnly Secure SameSite e scadenza, autorizzazioni validate lato server; utente che si prenota non può impersonare altri. Password e API key solo in secrets Cloudflare, mai repo.
- Registrazione non implica approvazione automatica. PATTY può approvare e revocare. Valutare persone minorenni e GDPR prima dei dati personali reali.
- D1 schema versionato + migrazioni riproducibili; prenotazioni atomiche con vincoli univoci, conflitti gestiti. Sync idempotente con priorità esplicita agli override manuali, audit degli interventi.
- Backup RECUPERABILI con procedura di export/ripristino verificata e non in repository pubblico. Valutare Time Travel D1, export accessibile solo PATTY e prova di ripristino. Non chiamare backup una copia dentro il medesimo database.
- Confini: prima staging con soli dati già pubblici e account fittizi non riferiti a persone reali; nessuna importazione di utenti reali dal vecchio SQLite volatile senza verifica.
- Requisiti di costo: Cloudflare Workers Free + D1 Free, nessun upgrade o servizio a pagamento, quote condivise con altri Worker dello stesso account. Verificare quote 2026 nelle docs Cloudflare prima di deploy: in particolare richieste Workers per giorno (shared) e D1 letture/scritture al giorno, capacità DB; prevedere richieste ottimizzate e contatori/monitoraggio. Se superamento causa errore, comunicarlo, niente costi automatici.

## Piano di esecuzione richiesto a Work

1. LEGGI tutta la repository e produce una checklist di parità delle funzionalità e dei test esistenti, distinguendo fatto/mancante/non testato. Preserva nomi e design CP05 + PATTY e successive correzioni.
2. Crea struttura web separata nella branch `cloudflare-migrazione`, test/build locale: `worker/` (TS/JS), `web/` (HTML/CSS/JS o Vite), `migrations/`, test automatizzati. Documenta scelta minima, nessun servizio aggiuntivo obbligatorio.
3. Realizza D1 schema e tutte le funzionalità: PATTY, account, squadre configurabili, gare, refresh FIPAV/PGS, storico e risultati, prenotazioni, incarichi fissi, sicurezza, privacy; implementa idempotenza e validazione server.
4. Riproduci il layout compatto desktop/mobile, con navigazione per settimana, colori ruoli, dettagli partita, date senza orario con segnalazione, gestione nomi brevi.
5. Test automated e2e includendo 20 squadre, giorni di inattività (niente sleep), due utenti che prenotano contemporaneamente, cambi data/orario dopo booking, cancellazioni gare, merge di sync, diritti utenti e backup+ripristino. Test manuale su telefono reale, se disponibile; altrimenti segnala che manca.
6. Verifica accesso account Cloudflare giusto e piano Free. CREA **risorse Cloudflare nuove e separate** esclusivamente per Volley Control (es. `volley-control-dev`, D1 `volley-control-db`). Nessuna modifica su Salone Pronto e sui relativi Workers/D1; nessun trasferimento di risorse già esistenti. Pubblica solo ambiente staging/test.
7. Confronta comportamento e copertura con la versione Streamlit. Non dismettere Streamlit e non rilasciare nuova versione definitiva senza conferma del proprietario dopo dimostrazione.
8. Alla fine consegna URL test funzionante, commit/branch, tabella test eseguiti e mancanti, spese effettive (0 o spiegare esattamente perché no), limiti reali di Cloudflare e passaggio successivo per pubblicazione.

## Condizione essenziale

L'utente vuole una soluzione affidabile **senza imprevisti economici prevedibili**. Se non riesci a verificare un requisito, segnala chiaramente il blocco e prosegui dove possibile: non fingere che il sistema sia testato, sicuro o gratuito senza verifica. Non chiedere all'utente di editare codice o aprire terminale.
