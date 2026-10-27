# Volley Control — migrazione Cloudflare, stato del 27 ottobre 2026

**Stato aggiornato: sviluppo e collaudo locale proseguiti; pacchetto pronto per la chat con connettore. Pubblicazione e collaudo remoto affidati separatamente a quella chat. Non è dichiarata una migrazione online completata.**

Il 27 ottobre Andrea ha vietato ulteriori tentativi di login al pannello Cloudflare e ha assegnato connessione/pubblicazione a un’altra chat. Tale problema non interrompe più lo sviluppo. Vedere `CLOUDFLARE_CONNETTORE_CONSEGNA.md` e la cartella `cloudflare/`.

## Fonti e isolamento

Letto integralmente `CLOUDFLARE_MIGRAZIONE_WORK.md`; analizzati i sorgenti Python, gli adattatori e i test presenti nel ramo. Base del lavoro: `214da2bf4975569650743a4aa6ce072b4345c1dc`. Main verificato ancora a `7a72ddb087e8f1bfb6f7b795392e2fda25b79e6e`. Nessun file Python preesistente è stato modificato. Nessun merge su main, nessuna modifica a Streamlit, nessuna modifica a Salone Pronto.

Nuovi sorgenti in `worker/`, `web/`, `migrations/`, `cloudflare-tests/`, `scripts/`. Applicazione HTML/CSS/JS senza dipendenze frontend o servizi aggiuntivi; Worker ESM e D1. I pacchetti npm sono solo strumenti di sviluppo/test. Le sei migrazioni inseriscono **solo la configurazione delle tre squadre reali già approvate**, mai gare, persone o prenotazioni di esempio.

## Stato del collegamento: verifica demandata alla chat di pubblicazione

La connessione API Cloudflare autorizzata funziona. Inventario letto: dieci Worker preesistenti, tutti relativi a Salone Pronto, e un D1 `salone-pronto-db` (466944 byte al controllo). Non sono stati letti i suoi dati applicativi e non è stato modificato.

`GET /accounts/{account_id}/subscriptions` è rifiutato con HTTP 403: la connessione OAuth non ha accesso alla fatturazione; l'errore indica che quell'endpoint richiede una connessione con permessi Billing Read. `workers/account-settings` restituisce `default_usage_model: standard`, **che non dimostra il piano Free**. L'accesso sicuro al pannello nel browser è stato tentato ma Cloudflare ha risposto `API Request Failed ... /login (403)`.

Per rispettare l'ordine di verificare il piano Free prima del deploy, **non sono stati creati Worker o database remoti per questa migrazione**, non è stato attivato alcun piano e non c'è ancora un nuovo URL di prova. Nessuna spesa di hosting generata dalle nuove risorse, perché non esistono ancora. I test workerd e D1 descritti sotto sono locali.

La precedente prova separata di connettività da Cloudflare verso FIPAV/PGS era riuscita (7 gare Ottolina, 8 Pinuccè, 10 Ardor, risultati/parziali presenti); il suo Worker temporaneo era stato cancellato. Non equivale al collaudo remoto di questa nuova applicazione.

## Parità implementata e verifiche

| Funzione | Implementazione | Verifica effettuata | Rimane da fare |
|---|---|---|---|
| HOME: settimana attuale, sole gare casalinghe scoperte | Frontend | Test DOM con ritorni HOME e navigazione ripetuta | Browser su staging |
| Linguette blu in fila con ritorno a capo, senza giornata | CSS e pulsanti settimanali | DOM, lettura CSS | Verifica visiva desktop e 375px |
| Fasce desktop circa 87px | Griglia con categoria arancione, data, squadre, luogo, staff, ruoli, stato, pulsante | Sorgente e DOM | Confronto visivo con Streamlit |
| Smartphone circa 36px, comitato, squadra breve, data, ora, ARB/REF | Lista compatta responsive | DOM; nomi fonte trattati come testo | Browser a 375px, orientamento largo e telefono reale |
| Verde acceso coperto, rosso acceso mancante, trasferte — | Entrambe le viste; coperture parziali restano mancanti | Test della logica e DOM dopo prenotazione/annullamento | Browser remoto |
| Scheda partita e Mi prenoto | Stessa finestra con dati, staff, palestra/indirizzo, risultati/parziali e posti | Percorso DOM → API → DB | Browser remoto |
| PATTY e area personale | Password salate con pepper separato, sessioni scadenti, cookie Secure/HttpOnly/SameSite, CSRF/origine e autorizzazioni server | Test API e runtime workerd | Configurazione secrets remoti e password proprietario; revisione sicurezza prima di dati reali |
| Registrazione e approvazione | Anagrafica unica; ruoli entrambi selezionabili, approvazione manuale, revoca | API, runtime workerd e DOM | Collaudo remoto solo con account fittizi |
| Squadre configurabili senza codice | CRUD PATTY, disattivazione, nomi brevi, due allenatori ordinati e dirigenti | 20 configurazioni in test, validazione server | Inserimento delle altre squadre reali quando comunicate |
| FIPAV/PGS e risultati | Richieste backend ai medesimi endpoint dell'app Python, selezione per ID, risultati/parziali, niente contatti PGS salvati | Normalizzatori e rete simulata; prova Cloudflare precedente separata | Pulsanti reali della nuova app online |
| Aggiorna tutti in PATTY | Tutti gli ambiti attivi, un recupero per girone/campionato; job persistenti e blocchi di due gare | Test 20 squadre e query per passo <50 | CPU e quote reali sotto carico remoto |
| Merge e gare già presenti | ID stabile, idempotenza, priorità override, derby con vista casa; controllo versione contro scritture concorrenti | Test storage e job | Gara derby reale quando disponibile |
| Date e ore mancanti | Alert blu PATTY, editor completo; ordinamento nella settimana dopo salvataggio | API e percorso DOM completo | Verifica sulla nuova app con date realmente confermate |
| Prenotazioni simultanee | Vincoli univoci e trigger D1 controllano persona, posto e intervalli | Due utenti concorrenti nel vero runtime workerd locale: una accettata e una 409 | Stessa prova remota |
| FISSO | Assegnazione automatica diretta, modifica/rimozione per squadra, eccezione singola gara | Test DB/API, nessuna modalità suggerita | Remoto |
| Sovrapposizioni e cambio orario | Intervallo conservato a 120 minuti; date/ore Europe/Rome con cambio legale; aggiornamento conflittuale respinto e segnalato | Test con booking esistenti e ora inesistente al cambio legale | Test remoto |
| Gara assente dalla fonte o annullata | Nessuna cancellazione silenziosa: flag, avviso PATTY, prenotazioni conservate; blocco nuove prenotazioni su gare assenti/nascoste | Test storage | Conferma operativa con fonti reali |
| Correzioni/manuale/storico | Override e audit, ripristino valore ufficiale, inserimento manuale PATTY, nascondi/riattiva | API/storage | Percorsi browser remoti |
| Backup e ripristino | Export riservato fuori DB; recupero su nuovo DB isolato in blocchi; consultazione/booking disabilitati durante recupero | Backup/ripristino locale, anche 400 gare; guardie ricreate e integrità controllata | Export reale, ripristino D1 remoto, custodia privata del file e del pepper |
| Inattività | Nessuno stato dei calendari nella memoria del Worker; riletto da D1 | Riimportazione del modulo con DB intatto | Prova riavvio/deploy remoto; non sono trascorsi quattro giorni in questo test |
| Monitoraggio | Conteggi effettivi dalle meta D1 e richieste Volley Control; accesso PATTY | Endpoint e runtime locale | Quote aggregate dell'intero account: non accessibili al momento |

I nomi lunghi possono far aumentare la riga mobile oltre il minimo di 36px per mantenere il testo leggibile; i nomi brevi approvati sono il caso di riferimento. Non è stato dichiarato un test visivo o su iPhone fisico.

## Test automatici al controllo

- **33 test JavaScript**: 27 di dominio/storage/API, due sul pacchetto e ripristino SQL, uno di integrazione sul runtime Cloudflare workerd con D1 locale, tre di frontend DOM con chiamate alle API. Eseguire `npm run check` per rigenerare il pacchetto prima dei test runtime.
- **19 test Python originali superati** nel checkout di migrazione, senza modifiche ai vecchi sorgenti.
- Migrazioni applicate anche tramite Wrangler D1 locale.
- Build del Worker standalone, controllo sintassi e `git diff --check`.
- Il test con 400 gare verifica il ripristino a passi di 20 record e il ripristino dei trigger; un secondo test recupera 650 gare mediante SQL privato, preservando apostrofi e stringhe potenzialmente ostili.
- Nuovi test verificano che una modifica PATTY non riapra le prenotazioni di una gara assente dalla fonte e che un annullamento concorrente non rimuova un incarico riassegnato a un’altra persona.
- Il test workerd usa esattamente il Worker unico e le 41 istruzioni D1 consegnate nella cartella `cloudflare/`, non una ricostruzione differente.
- Nessuna persona o prenotazione di test pubblicata online.

`npm run check` costruisce il Worker unico, prepara i payload del connettore, verifica la sintassi e avvia i test. Il simulatore workerd non dimostra il rispetto del budget CPU del piano Free in produzione: serve il test remoto con gli effettivi calendari, specialmente la risposta PGS più ampia.

## Costi e limiti: documentazione controllata

Fonti ufficiali consultate il 27 ottobre 2026:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

Workers Free: 100000 richieste al giorno condivise nell'account, 10ms CPU per richiesta, 50 subrequest. D1 Free: 5 milioni di righe lette e 100000 scritte al giorno, condivise nell'account; 500MB per DB, 5GB complessivi, massimo 10 DB, Time Travel 7 giorni. Gli indici incidono sulle scritture; un aggiornamento idempotente evita riscritture inutili. I contatori di Volley Control non includono i consumi di Salone Pronto e non vanno presentati come disponibilità residua dell'account.

Sul piano Free il superamento delle quote blocca le operazioni fino al reset; non abilitiamo upgrade automatici. **Questo comportamento non è una prova che l'account attuale sia Free**, né una garanzia di gratuità illimitata o di condizioni commerciali immutabili nel futuro. Va verificato il piano dell'account prima di creare il nuovo D1 e Worker.

Le fonti sportive vengono lette con richieste pubbliche a basso volume, nessun aggiramento di autenticazione e nessun download automatico continuo. L'accessibilità pubblica dell'endpoint non costituisce una licenza generale di redistribuzione: le condizioni d'uso non sono state oggetto di una verifica legale.

## Sicurezza e dati reali

Staging di default con registrazioni chiuse. Se aperte per collaudo, richiede consenso ai soli dati fittizi e indirizzi `@example.invalid`. Non sono importate anagrafiche dal vecchio SQLite temporaneo. Nessuna password, cookie o backup in git.

KDF: PBKDF2-HMAC-SHA512 100000 iterazioni con salt casuale per account e HMAC con pepper separato custodito come secret. Il costo è scelto per la compatibilità di WebCrypto Workers e non viene dichiarata una certificazione OWASP o una revisione di sicurezza indipendente. Limiti per IP ai tentativi di accesso/registrazione; sessione PATTY 30 minuti e personale 8 ore. Password PATTY come hash in secret, senza account pubblico di amministrazione e senza credenziali predefinite.

Per ripristinare anche gli accessi, il pepper deve essere custodito separatamente dal backup: senza di esso le password esportate non sono verificabili. La procedura di custodia di produzione e la valutazione privacy/minori vanno completate prima dell'apertura a persone reali. Non viene promesso un recupero di password via email, che non era implementato nel progetto originale e richiederebbe una decisione separata.

## Ripresa del lavoro

1. Ottenere verifica leggibile del piano Workers Free e dei consumi condivisi, senza cambiare piano o attivare fatturazione.
2. Verificare che i nomi `volley-control-dev` e `volley-control-dev-db` siano liberi; creare solo queste risorse, preferendo D1 in giurisdizione UE. Non riutilizzare né collegare il DB Salone Pronto.
3. Configurare binding e secrets tramite connessione Cloudflare; nessun terminale richiesto ad Andrea. `wrangler.jsonc` contiene intenzionalmente un ID segnaposto che impedisce di scambiare un DB locale per quello remoto.
4. Applicare le sei migrazioni al nuovo DB, pubblicare lo staging e recuperare i calendari reali con i pulsanti PATTY. Non usare fixture di test nel nuovo DB remoto.
5. Eseguire test browser desktop/mobile, account fittizi, prenotazioni concorrenti, modifica orario, aggiornamenti, backup/ripristino su un secondo DB di recupero dedicato; verificare che l'altro Worker e DB siano invariati.
6. Presentare URL e risultati effettivi ad Andrea. Versione definitiva solo dopo approvazione. Streamlit non viene dismesso automaticamente.

CP-05 e checkpoint storici rimangono conservati: questo rapporto è uno stato tecnico della migrazione, non un nuovo checkpoint di rilascio approvato.
