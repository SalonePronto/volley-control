# NOVAVISION — aggiornamento automatico nello stesso comando FIPAV

Decisione funzionale del 27 ottobre 2026.

## Comportamento obbligatorio
- Il comando PATTY «Aggiorna tutti i calendari» gestisce PVI NOVAVISION (Serie D femminile 2026/27) senza alcun comando, finestra, incolla manuale o riepilogo dedicato.
- Il comando «Aggiorna tutti i risultati» segue il medesimo criterio.
- Le 12 squadre FIPAV già collegate non cambiano percorso; le 8 PGS rimangono invariate.
- NOVAVISION può usare una sorgente diversa **solo dietro le quinte**. Non usare la clipboard del browser: l'accesso agli appunti richiede permesso/interazione e non soddisfa il requisito.
- Riutilizzare la pipeline esistente di normalizzazione, chiavi stabili per gara, deduplicazione, override, prenotazioni, incarichi fissi, controllo assenze e segnalazione degli errori. Non marcare scomparse partite quando la fonte regionale è irraggiungibile o incompleta.
- UI: soltanto messaggio generale di avanzamento/completamento. Avviso generico se qualche calendario fallisce; dettaglio tecnico registrato in area amministrativa senza richiedere operazioni aggiuntive.

## Fonte regionale da verificare, prima dell'attivazione
- Portale campionati regionale: https://lombardia.federvolley.it/rest_api/article?category_id=42
- Applicativo regionale consultabile pubblicamente: https://lombardia.fipavwebmanager.it/
- Occorre verificare in modo riproducibile la *pagina o endpoint con le gare 2026/27*, il girone reale, il nome ufficiale della squadra e ID stabili delle gare prima di importare.
- **Non è confermato** un endpoint dati corretto né sono stati verificati identificativi ufficiali per NOVAVISION. Non impostare URL/ID dedotti o calendari dimostrativi nel database reale.
- La fonte FIPAV Como `data.fipavonline.it/api/v2/calendar/0/{group_id}` è diversa dalla fonte regionale: non sostituirla senza prove.

## Stato
- 27/10/2026: implementato nel ramo `cloudflare-migrazione` il messaggio generale della UI al posto del riepilogo per singola squadra (`web/app.js`).
- Integrazione regionale NOVAVISION **non implementata**: blocco esterno sull'identificazione/verifica della fonte pubblica effettivamente interrogabile. Nessun deployment.
- Prima di attivare: prova con calendario reale, import ripetuto senza duplicati, cambio orario/data con prenotazioni già presenti, risultati, errore/assenza della fonte, verifica che le 12 FIPAV e le 8 PGS continuino a funzionare.
