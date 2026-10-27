# Pubblicazione — vincoli per il tecnico

- Ramo esclusivo: `cloudflare-migrazione`; non effettuare merge su main o dismettere Streamlit senza approvazione.
- Account: `be2a6531623a2d7500aabcf3a6efe5ce`. Verificare Free e quote aggregate PRIMA del deploy. Il campo `usage_model:standard` non è prova di Free.
- Risorse nuove: `volley-control-dev`, `volley-control-dev-db`. Nessuna mutazione su altri nomi. ID Salone Pronto vietato: `517101b6-f33f-4c68-b082-66f1e751aa1e`.
- Nessuna sottoscrizione, upgrade, Workers AI, KV, R2, Queue o altro servizio obbligatorio. Solo Worker e D1 dopo verifica economica.
- `wrangler.jsonc` non è ancora collegato a un DB remoto. Usare il nuovo ID D1 verificato, mai l'ID di un DB preesistente.
- `PASSWORD_PEPPER`: random forte, secret. `PATTY_HASH`: hash generato con il medesimo KDF di `worker/index.mjs`, secret. Nessuna password in chiaro nelle variabili pubbliche, nei log o in git. Custodia separata del pepper da predisporre prima di utenti reali.
- Variabili non segrete: `ENVIRONMENT=staging`, `REGISTRATION_ENABLED=false` inizialmente, `FREE_PLAN_VERIFIED=true` soltanto dopo verifica documentata. `RECOVERY_MODE` esclusivamente per un Worker di recupero distinto.
- Build: `npm ci`, `npm run check`; il pacchetto già assemblato è `cloudflare/worker.mjs`, singolo modulo ESM senza import esterni; `cloudflare/d1-statements.json` contiene le 41 istruzioni D1 ordinate. Gli asset HTML/CSS/JS sono incorporati nel Worker. Non pubblicare `node_modules`, `.dev.vars`, database locali o report con credenziali.
- Il simulatore richiede Node >=22.13; test effettuati con Node 24.22.1. Il file `scripts/local-network-fallback.cjs` è soltanto un adattamento del locale per ambienti che non consentono enumerazione delle interfacce; non è caricato nel Worker pubblicato.
- Endpoint di verifica: `/api/health` riporta release, ambiente e accesso allo schema. Non contiene segreti. L'URL finale va aperto nel browser cloud e collaudato, non soltanto costruito dal nome del Worker.
- Tutti gli aggiornamenti avvengono mediante i due pulsanti PATTY; niente cron/warmup obbligatori. La pagina pubblica legge soltanto D1.

In questa chat non va avviato alcun deploy remoto. Andrea ha affidato collegamento, verifica economica e pubblicazione dello staging separatamente alla chat con connettore. Non tentare ulteriori accessi al pannello Cloudflare tramite browser. La consegna operativa completa è `CLOUDFLARE_CONNETTORE_CONSEGNA.md`.
