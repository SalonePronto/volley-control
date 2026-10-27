# VOLLEY CONTROL — consegna alla chat con connettore Cloudflare

Aggiornamento operativo autorizzato da Andrea il **27 ottobre 2026**. Questa consegna integra `CLOUDFLARE_MIGRAZIONE_WORK.md` e lo stato precedente senza cancellarli.

**Non accedere al pannello Cloudflare tramite browser e non ripetere il tentativo di login che ha restituito 403.** Lo sviluppo prosegue indipendentemente da quel problema. In questa fase connessione, creazione delle risorse, configurazione dei secrets e pubblicazione dello staging sono assegnate separatamente alla chat dotata del connettore Cloudflare funzionante.

## Dove prendere il materiale

Repository `SalonePronto/volley-control`, **ramo `cloudflare-migrazione`**. Prima leggere il commit corrente del ramo, non assumere che sia ancora `2dc1a18`. Non toccare `main`, Streamlit, Salone Pronto o i suoi database/Worker.

La cartella **`cloudflare/`** è pronta per il connettore, senza bisogno di ricostruire il frontend:

| File | Utilizzo |
|---|---|
| `worker.mjs` | Worker ESM unico: include backend, dominio e frontend HTML/CSS/JS; nessun import esterno e nessun servizio aggiuntivo obbligatorio |
| `d1-statements.json` | **41 istruzioni SQL ordinate** con parametri vuoti e riferimento alla migrazione; applicarle in ordine a un D1 nuovo |
| `schema.sql` | Schema consolidato equivalente, **solo database nuovo/vuoto**, non da rilanciare su DB già configurato |
| `release.json` | Versione, hash SHA-256 degli artefatti, configurazione e migrazioni; non contiene segreti |

Release applicativa attesa: **`cf-staging-2026-10-27.2`**. Schema atteso: **6**. `source_base_commit` indica la base git prima dell'assemblaggio; gli hash identificano esattamente gli artefatti da caricare.

I sorgenti modificabili restano in `worker/`, `web/`, `migrations/`. `npm run check` rigenera il pacchetto e verifica tutto. Questi comandi sono per il tecnico, **non devono essere richiesti ad Andrea**.

## Confini di autorizzazione

- Account autorizzato: `be2a6531623a2d7500aabcf3a6efe5ce`.
- Solo risorse nuove dedicate: Worker **`volley-control-dev`**, D1 **`volley-control-dev-db`**. Se esistono già, accertarne la proprietà e lo stato prima di modificarle; non cancellarle per ripartire automaticamente.
- **Vietato** usare o modificare Worker con nome `salone-pronto*` e database `salone-pronto-db`, UUID `517101b6-f33f-4c68-b082-66f1e751aa1e`.
- Nessuna sottoscrizione, upgrade, fatturazione a consumo, dominio a pagamento, Workers AI, KV, Queue o R2.
- Verifica del piano Free e quote condivise affidata alla chat di pubblicazione. Il campo `usage_model:standard` non prova che il piano sia gratuito. L'assenza di permessi sulla fatturazione va dichiarata, senza abilitare un piano a pagamento.
- Pubblicare solo staging. **La versione definitiva non è autorizzata.** Nessun merge automatico su main o spegnimento Streamlit.

## Configurazione D1 tramite connettore

1. Leggere la specifica delle operazioni del connettore e l'inventario dell'account. Conservare come controllo i nomi/versioni dei Worker preesistenti, senza leggerne o modificarne i segreti e i dati.
2. Creare il nuovo D1 dedicato dopo la verifica economica. Preferire giurisdizione UE, quando disponibile nel piano senza sovrapprezzo; non promettere una residenza non verificata.
3. Annotare il nuovo UUID e controllare che il nome sia esattamente `volley-control-dev-db` e che non sia quello vietato di Salone Pronto.
4. Verificare DB vuoto. Leggere `cloudflare/d1-statements.json` da GitHub e applicare le **41 istruzioni nell'ordine indicato** usando l'endpoint D1 query del connettore. Se il batch non è supportato, eseguirle singolarmente; non spezzare i trigger sulle loro virgole o sui punti e virgola interni. Il JSON fornisce già i blocchi SQL completi. Usare al massimo 15 operazioni per batch tecnico.
5. Verificare: `max(version)` in `schema_migrations` uguale a 6; tre squadre configurate; zero gare, zero persone e zero prenotazioni. I dati pubblici delle gare si acquisiscono successivamente dalle fonti vere.
6. Non rieseguire lo schema consolidato se le migrazioni sono state già applicate. Un errore a metà applicazione richiede ispezione dello stato prima di riprendere, non ripetizione cieca.

## Worker e secrets tramite connettore

Caricare `cloudflare/worker.mjs` come singolo modulo ESM `worker.mjs`, metadata `main_module: "worker.mjs"`, `compatibility_date: "2026-10-01"`.

Binding richiesti:

| Nome | Tipo | Valore |
|---|---|---|
| `DB` | `d1` | UUID del nuovo `volley-control-dev-db` |
| `ENVIRONMENT` | `plain_text` | `staging` |
| `REGISTRATION_ENABLED` | `plain_text` | `false` inizialmente |
| `FREE_PLAN_VERIFIED` | `plain_text` | `true` solo dopo verifica documentata; altrimenti `false` |
| `PASSWORD_PEPPER` | `secret_text` | chiave casuale forte, nuova e privata |
| `PATTY_HASH` | `secret_text` | hash generato con `passwordHash` del sorgente e lo stesso pepper |

Non utilizzare le password di Salone Pronto. Non ricavare o esportare i secrets di altri Worker. Non mettere password, hash reali, cookie o pepper in GitHub, commenti, log o risposte pubbliche. `release.json` contiene soltanto segnaposti, **che non devono essere caricati come credenziali effettive**. La configurazione riservata va completata nella chat di pubblicazione con il canale sicuro disponibile; non chiedere ad Andrea terminali o elaborazione manuale degli hash.

La funzione `passwordHash` è in `worker/index.mjs`: PBKDF2-HMAC-SHA512 100000 iterazioni su HMAC con pepper, salt casuale per account. Il Worker pronto non espone endpoint pubblici per generare password o diventare amministratore. Senza i secrets l'accesso PATTY restituisce un errore esplicito 503 e non si apre con password predefinite.

La pubblicazione deve usare il multipart del connettore; i normali binding pubblici sono metadati, le credenziali sono secrets. Configurare soltanto `workers.dev` dello staging. Nessun dominio di produzione, cron o migrazione di dati personali esistenti.

## Collaudo da effettuare dopo il deploy

1. Aprire l'URL **effettivamente restituito** da Cloudflare, non dichiarare funzionante un indirizzo soltanto costruito.
2. `GET /api/health` deve rispondere 200 con `release: cf-staging-2026-10-27.2`, `schema_version: 6`, `environment: staging`, `persistent: true`.
3. Verificare che senza autenticazione le API PATTY e backup rispondano 403, e che un POST da origine diversa sia respinto.
4. Accedere a PATTY con configurazione sicura, usare **Aggiorna tutti i calendari**. Il pulsante richiede un job per ogni girone/campionato; `POST /api/admin/sync` restituisce `job_id`, poi `/api/admin/sync/step` elabora due gare a richiesta fino a `done:true`. Non abbandonare il collaudo al solo avvio del job.
5. Controllare FIPAV Ottolina U15, FIPAV Pinuccè U17 e PGS Ardor Giussano U11 con gare, date, orari, palestre, risultati e parziali effettivamente restituiti. Ripetere l'aggiornamento per controllare idempotenza e conservazione delle correzioni. Provare anche **Aggiorna tutti i risultati**.
6. Controllare la home (sole gare casalinghe scoperte della settimana corrente), le linguette blu, l'apertura di una settimana con tutte le gare e il pulsante **Vedi scheda**. Desktop: fasce circa 87px; telefono 375px: lista circa 36px per i nomi brevi approvati, comitato visibile, nessuna sovrapposizione. Telefono fisico solo se disponibile, altrimenti dichiararlo mancante. L'eventuale browser si usa per la **nuova app Volley Control**, mai per ritentare l'accesso al pannello Cloudflare.
7. Per il solo collaudo si possono aprire temporaneamente le registrazioni con `REGISTRATION_ENABLED=true`: account chiaramente fittizi e email `@example.invalid`, mai dati di persone reali. Verificare approvazione PATTY, due ruoli, nomi e cognomi, concorrenza sul medesimo posto, sovrapposizioni, annullamento e assegnazioni FISSE. Dichiarare i dati di test come tali e ripulire soltanto i record di prova identificati al termine; non presentare le prenotazioni fittizie come uso reale.
8. Le gare senza data/ora vanno completate solo con dati confermati; per testare date arbitrarie usare esclusivamente un DB di collaudo isolato e record marcati TEST. Non inventare orari per le gare vere per far sembrare superato il test.
9. Eseguire export backup privato e ripristino su DB di recupero separato. Verificare persistenza attraverso nuovo deploy dello stesso Worker/riapertura e mantenimento del medesimo D1; non simulare quattro giorni con un'attesa bloccante.
10. Misurare CPU e query reali, in particolare il feed PGS ampio. I test locali non dimostrano il rispetto dei 10ms CPU del piano Free. Conservare errori e casi non collaudati nel rapporto.
11. Consegnare URL, versione, report delle verifiche realmente riuscite, limiti residui e spese verificate. Chiedere ad Andrea l'approvazione prima della versione definitiva.

## Stato consegnato da questa chat

- **33 test JavaScript superati**, inclusi runtime Cloudflare workerd/D1 locale, percorsi frontend → API, test 20 squadre con entrambi gli incarichi FISSI e backup/ripristino fino a 650 gare tramite SQL privato.
- **19 test Python originali superati** nel controllo precedente; i sorgenti Python non sono stati modificati.
- Pacchetto pronto e D1 schema verificato localmente. Il database remoto non è stato creato da questa chat.
- Nessun tentativo browser Cloudflare effettuato dopo il divieto di Andrea.
- Nessuna modifica a Salone Pronto e nessuna pubblicazione definitiva.
- Lavoro pronto per la chat del connettore; la pubblicazione online e il collaudo visivo restano attività distinte da dichiarare dopo esecuzione.
