# Magic Fantaleague — accesso admin e PWA

L'app pubblica legge `/api/players`. I dati di base restano in `data.json`; le modifiche a `convocato` sono salvate per nome univoco in Netlify Blobs e riapplicate alle letture. Gli altri campi non sono modificabili tramite API. I salvataggi sono immediati; se due admin modificano lo stesso giocatore prevale l'ultimo salvataggio. Mantieni i nomi univoci e identici quando aggiorni `data.json`: una rinomina richiede anche la migrazione della chiave in Blobs.

Le chiavi sono `player-name/<nome codificato con encodeURIComponent>`, per esempio `player-name/Bowie`. Il nome conserva maiuscole, spazi e accenti. La lettura considera soltanto le chiavi per nome; le vecchie chiavi `player/<id>` sono conservate come archivio e non alimentano l'app. La migrazione con `migrateLegacyOverrides` copia i valori senza cancellare le vecchie chiavi e senza sovrascrivere valori già presenti per nome. Anche le pagine admin precedenti che inviano ancora un ID salvano ora sotto la chiave per nome. Il build blocca i nomi vuoti o duplicati.

## Attivazione su Netlify

1. Pubblica questo progetto con un deploy Netlify che esegua il build e includa le Functions (collegamento Git oppure Netlify CLI; il solo trascinamento dei file statici non basta).
2. Nelle variabili d'ambiente del sito, con scope **Functions**, configura `ADMIN_PASSWORD` (almeno 16 caratteri) e `ADMIN_SESSION_SECRET` (segreto casuale di almeno 32 caratteri). Non inserirle in Git o nel frontend. Per generare il segreto: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Usa credenziali e `CONVOCATI_STORE` diversi nei contesti di preview e produzione. Il nome dello store predefinito è `fantaleague-convocati`; senza override gli ambienti dello stesso sito condividono i valori.
4. Esegui un nuovo deploy. `netlify.toml` configura build `npm run build`, cartella pubblica `dist` e Functions in `netlify/functions`. Verifica nel log del deploy l'applicazione del rate limit dell'accesso admin.
5. Apri `/admin.html`, accedi, cerca un giocatore e modifica **Convocato**. Ricarica l'app pubblica per verificare badge e conteggi aggiornati. Le pagine già aperte aggiornano i dati alla ricarica.

La password unica è pensata per l'admin iniziale; la sessione dura 8 ore. Ruotare la password o il segreto invalida le sessioni esistenti. Nessun account, recupero password o gestione ruoli è previsto in questa prima versione.

## Smartphone

Il sito HTTPS è installabile come PWA. Su iPhone usa Safari → Condividi → Aggiungi alla schermata Home; su Android usa il menu di Chrome → Installa app/Aggiungi alla schermata Home. La PWA apre l'app pubblica, da cui si entra in **Admin**. La shell può essere memorizzata offline; lettura dati, accesso e salvataggio richiedono Internet. Le API e `data.json` non sono memorizzati dal service worker.

## Verifica locale

`npm ci`, `npm test`, `npm run build`.

Per usare anche le Functions in locale, usa Netlify Dev con le variabili segrete configurate. Un server statico permette solo l'anteprima dell'app pubblica, che in assenza dell'endpoint (404) legge il JSON originale. Gli override già salvati prevalgono sul valore nel JSON nei deploy successivi. Conserva un backup degli override se devi migrare a un altro sito Netlify.

Riferimenti: [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Functions](https://docs.netlify.com/build/functions/overview/), [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
