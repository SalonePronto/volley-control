# Backup e recupero — procedura per il responsabile tecnico

Queste istruzioni sono per il tecnico; Andrea non deve eseguire comandi.

## Export

Da PATTY, `Esporta backup riservato` chiama `/api/admin/backup` con sessione amministrativa. Il JSON contiene schema applicativo versione 1, dati e timestamp; non contiene sessioni né il pepper. Conservarlo in archivio privato esterno a D1, separato dal secret `PASSWORD_PEPPER`. Nessun backup personale va nel repository pubblico. La copia locale dentro un DB di recupero serve a eseguire l'importazione e non sostituisce il file di backup esterno.

## Recupero isolato

1. Verificare piano gratuito/quote disponibili e autorizzazione allo spazio necessario. Creare esclusivamente un nuovo DB `volley-control-recovery-*` ed eventualmente un Worker `volley-control-recovery-*`. Mai usare risorse Salone Pronto o il DB attivo per provare un ripristino.
2. Applicare tutte le migrazioni. Impostare `RECOVERY_MODE=true` nel solo Worker di recupero; associare il nuovo DB. Questo impedisce consultazione calendari, iscrizioni e prenotazioni su quell'ambiente.
3. Configurare secrets amministrativi del recupero con il canale sicuro. Non copiare password tramite chat, log o repository. Per rendere verificabili gli accessi ripristinati servirà il pepper originale, da recuperare dalla custodia privata autorizzata.
4. Accedere a PATTY attraverso l'API di recupero e conservare cookie/CSRF solo nel client tecnico sicuro. Inviare il JSON a `POST /api/admin/restore`. Richiede DB vuoto salvo configurazioni iniziali. Il servizio salva temporaneamente il payload nel nuovo DB, rimuove le quattro guardie durante il solo import e restituisce un job ID. L'ambiente resta isolato.
5. Ripetere `POST /api/admin/restore/step` con `{job_id}` finché `done:true`. Ogni richiesta carica al massimo 20 record, entro il budget query Free; l'ultimo passo ricrea i trigger e controlla le chiavi esterne. Non inoltrare due step contemporaneamente.
6. Confrontare conteggi, contenuti delle gare, override e assegnazioni con il backup; provare un tentativo non autorizzato e la prevenzione dei duplicati. Non rendere questo DB quello attivo senza verifica e autorizzazione esplicita.
7. Se l'import si interrompe con un errore d'integrità, lasciare il recupero isolato e usare un nuovo DB di recupero dopo analisi. Non abilitare consultazione/booking di un import parziale.

Il servizio limita il payload di richiesta a circa 1MB e il singolo job salvato a 1,5 milioni di caratteri. Per archivi più grandi è disponibile `scripts/backup-to-sql.mjs`: converte il JSON privato in SQL senza inviarlo in rete, rifiuta destinazioni dentro il repository e crea il file con permessi privati. Il tecnico può importarlo tramite connettore D1 su un database di recupero vuoto con schema applicato, controllando prima nome e UUID. Il percorso SQL è testato localmente con 650 gare, apostrofi e stringhe ostili; import e ripristino D1 remoti vanno ancora collaudati. Il percorso attuale è testato localmente con 400 gare; il ripristino D1 remoto resta da collaudare.

Time Travel D1 sul Free conserva 7 giorni secondo la documentazione consultata. Non sostituisce l'export privato e non è stato provato su un DB remoto di Volley Control, che non è ancora creato.
