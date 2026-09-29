# Bunica: dal giro in città a un gioco

Data: 29/09/2026. Design discusso e approvato a pezzi il 28/09/2026 (sessione `7f3885ff`), scritto qui prima di partire.

## Perché

Il 28/09 Ludovico ha giocato la versione su tutta Bucarest e il giudizio è stato: "non è divertente ancora, è abbastanza limitato". Alla domanda su cosa annoiasse ha indicato tre cose: **niente da fare**, **città morta**, **grafica ancora povera**. Lo swing invece va bene e non si tocca.

Le sue scelte:

- Tipo di divertimento: tutto insieme (caos alla GTA, supereroe di quartiere, missioni con storia, sfide).
- Protagonista al posto di Spider-Man: **Bunica**, la nonna col basma che si lancia col filo del bucato e mena col papuc.
- Modelli 3D: niente Meshy a pagamento, ma nemmeno "roba fatta base": il miglior risultato ottenibile gratis.
- Git locale in questa cartella: sì, senza remote e senza push.

## Cosa resta com'è

La città da OSM, lo streaming a chunk, la fisica dello swing, del muro e dello zip, il traffico rubabile, i bar con birra e țuică, i tasti 1-0. I 12 controlli di `test/physics.mjs` devono continuare a passare per tutto il lavoro.

## Pezzo 1: Bunica e il giro di gioco

Struttura a mappa aperta alla Spider-Man PS4: si gira liberamente, e la città offre sempre qualcosa da fare entro un minuto di swing.

**Bunica.** Basma in testa, vestito a fiori, golfino, calze spesse e papuci. Si lancia col filo del bucato (con mollette e qualche panno appeso) al posto della ragnatela. Nel giro 1 è l'X Bot di oggi ridipinto dallo shader in bind pose, come adesso è dipinto il costume di Spider-Man; il modello definitivo arriva nel giro 2. Il tasto V cambia il colore del basma. Le battute passano a Bunica: stesse situazioni (furto d'auto, bevute, schianti), riscritte al femminile e con la sua voce, più battute nuove per le lotte, le missioni e la polizia. **La voce** (29/09, Ludovico: "la voce fa cagare, è troppo robotica"): la voce di sistema del Mac (Ioana) si abbandona. Tutte le battute si generano prima, una volta sola, con una voce neurale romena gratuita (edge-tts). **Scelta di Ludovico il 29/09, dopo aver ascoltato i campioni: la 3 e la 4, usate a turno.** Voce A: `ro-RO-AlinaNeural` con `--rate=-35% --pitch=-18Hz` (campione `3-alina-ubriaca`). Voce B: `ro-RO-EmilNeural` con i valori di base (campione `4-emil-maschio`). Ogni battuta viene generata con tutte e due le voci (`<id>.a.mp3` e `<id>.b.mp3`) e a runtime si alternano: la battuta successiva usa sempre l'altra voce, così non ne escono due di fila con la stessa. Le voci 0, 1 e 2 sono scartate e si salvano come file audio compressi in `public/audio/voice/<id>.mp3`, uno per battuta, con un manifest `lines.json` che li lega ai testi e ai sottotitoli italiani. Con la sbronza alta la battuta si riproduce un po' più lenta (`playbackRate` fino a 0,85), senza una terza versione da generare. A runtime niente sintesi nel browser (`speechSynthesis`): si riproducono i file, con code e priorità (una battuta importante interrompe una minore) e senza sovrapposizioni. Attenzione: edge-tts usa un servizio Microsoft non ufficiale, va bene per un progetto personale in un repo privato; prima di rendere pubblico il repo si controlla la licenza oppure si rigenerano i file con un'altra voce. Lo script `tools/make-voice.py` rigenera tutto da `src/lines.js`, così una battuta nuova costa un comando.

**Combattimento.**

| Tasto | Azione |
|---|---|
| Clic sinistro | a terra con un nemico entro 5 m: colpo di papuc, fino a una combo di 4; in aria resta lo swing di oggi |
| Q | lancia il papuc: stordisce da lontano, poi torna in mano |
| C | lega un nemico stordito col filo del bucato (a un muro, a un palo o a terra): è fuori gioco |
| Spazio | schivata quando un nemico sta per colpire (il colpo è annunciato da un segnale sopra la testa) |

Bunica ha una barra della salute che si ricarica fuori dal combattimento. A zero sviene e riparte dal tetto sicuro più vicino, con una perdita di Respect.

**Nemici.** Golani a piedi, alcuni con la mazza. Macchina a stati semplice: si avvicinano, annunciano il colpo, colpiscono, barcollano, cadono, scappano quando restano soli.

**Crimini a caso.** Ogni 45-90 secondi ne compare uno fra 300 e 600 m, segnato in rosso sulla minimappa:

- **Scippo**: un tipo scappa con la borsa di una signora; lo si raggiunge e lo si lega.
- **Rapina al non-stop**: da 3 a 5 golani davanti a un chiosco o non-stop vero, presi dai 1.925 posti OSM che il gioco ha già.
- **Fuga in auto**: rapinatori in macchina; si fermano colpendoli col papuc lanciato, saltandoci sopra, o speronandoli con un'auto rubata.

**Poliția, da 0 a 5 stelle.** Le stelle salgono se Bunica colpisce un passante, ruba un'auto davanti alla polizia, sperona una volante o guida ubriaca sotto gli occhi di un agente. Dalla prima stella arrivano volanti che inseguono; dalla terza anche agenti a piedi con reti e taser, e posti di blocco sulle strade grandi. Le stelle scendono restando fuori vista per un po': sui tetti è più facile, ma le volanti tagliano la strada e le sirene si sentono. Se la prendono ("Te-am prins, mamaie!") si riparte davanti alla secție più vicina con meno Respect.

**Campagna "Pensia"**, 6 missioni in posti veri, sbloccate una dopo l'altra, ognuna con chi la affida, un obiettivo sulla minimappa e un checkpoint:

| # | Titolo | Dove | Cosa si fa |
|---|---|---|---|
| 1 | Pensia furată | Piața Unirii | uno scippatore ruba la pensione a Bunica fuori dalla posta: inseguimento e combo di papuc (tutorial) |
| 2 | Coada la Obor | Piața Obor | consegna 5 borcane di zacuscă per la città entro il tempo (swing e zip) |
| 3 | Nepotul | Parcul Herăstrău | il nipote è circondato da una banda sul lungolago: combattimento |
| 4 | Aparatul stricat | Gara de Nord | un tassista truffa una pensionata: rubare il taxi e inseguirlo |
| 5 | Manele la etajul 4 | Drumul Taberei | una festa nel blocco: spegnere 3 casse sui balconi di facciate diverse (muro e arrampicata) |
| 6 | Casa Poporului | Palatul Parlamentului | il capo della banda che ruba le pensioni, con la polizia a 3 stelle: tutto insieme |

**Sfide.** 5 gare a checkpoint fra i monumenti con tempi oro, argento e bronzo, e 50 borcane di zacuscă nascosti su tetti e monumenti da raccogliere.

**Bonus speciali: tutte le bottiglie in PET** (idea di Ludovico, 29/09: "bottiglie in PET tipo Neumarkt da 2,5 litri, e tutte quelle in PET, non solo Neumarkt"). Come in ogni chiosco rumeno, non solo la birra: bottiglie di plastica di ogni tipo e misura, sparse per la città come raccoglibili rari, con una luce del colore del contenuto che le rende riconoscibili da lontano. Stanno su tetti, davanti ai non-stop e ai chioschi veri dei dati OSM, dietro le missioni e sopra i monumenti (una ventina in tutto per città, deterministiche e tutte raggiungibili). Sei tipi, ognuno con il suo effetto per 30 secondi:

| PET | Contenuto | Effetto | Sbronza |
|---|---|---|---|
| Bere 2,5 L (la "Neumarkt") | birra bionda dorata | **Turbo**: swing più veloce, salto più alto, papuc doppio | +2 |
| Vin la PET 2 L | vino rosso di casa | **Scut**: metà dei danni | +2 |
| Țuică la PET 1,5 L | țuică trasparente | **Foc**: il papuc lanciato è infuocato e scaraventa i nemici | +3 |
| Cola 2 L | cola scura | **Energie**: corsa e arrampicata più veloci | 0 |
| Apă plată 1,5 L | acqua | **Trezire**: azzera la sbronza, cura un quarto della salute | azzera |
| Suc de portocale 2 L | succo | cura metà della salute | 0 |

Il brindisi della țuică (suggerimento di un amico rumeno di Ludovico) è fisso: ogni volta che si beve țuică, al bar o dalla PET, Bunica dice **"Să trăiască Bucureștiul!"** (a Brașov **"Să trăiască Brașovul!"**), sempre presente fra le varianti e con una probabilità più alta delle altre. La birra e il vino sono i più comuni, la țuică è rara. I modelli sono costruiti nel codice (bottiglia alta con la base a petali, tappo, etichetta, misure diverse), con etichette **inventate** dai colori che ricordano quelle vere, mai il nome o il logo di una marca vera. Ogni tipo ha la sua battuta (`pet.beer`, `pet.wine`, `pet.tuica`, `pet.cola`, `pet.water`, `pet.juice`; per la birra "Bere la PET: patrimoniu național!"). Un contatore nell'HUD, salvato sotto `pet` con il conteggio per tipo; ogni 10 bottiglie raccolte sbloccano un colore del basma e Respect extra. Le PET sono un raccoglibile a parte dai borcane di zacuscă.

**Respect.** Punti da crimini fermati, missioni, sfide e borcane; 10 livelli. I livelli sbloccano un filo più lungo, più salute, il doppio lancio del papuc e nuovi colori del basma. I progressi restano salvati nel browser.

**HUD.** Salute, livello e barra del Respect, stelle, obiettivo corrente, icone sulla minimappa (crimini rossi, missioni gialle, sfide blu, borcane). Testo mai sotto i 13 px, numeri chiave grandi, nessuna sovrapposizione a nessuna larghezza della finestra.

## Pezzo 2: città viva

- **Passanti** su marciapiedi, vie pedonali e piazze (i dati OSM hanno già `foot` e `ped`): scappano dalle risse, applaudono Bunica, qualcuno la filma col telefono; se investiti cadono e le stelle salgono.
- **Tram** sulle linee vere (i chunk hanno già le rotaie `tram`): corrono, si fermano alle fermate, suonano la campanella, e ci si può salire sul tetto.
- **Traffico con più carattere**: taxi gialli come quelli di Bucarest, volanti di pattuglia. Le Dacia vere arrivano nel giro 2.
- **Locali supremi** (aggiunto il 29/09 da Ludovico): **Anagram**, **Hop Hooligans** e **Ironic** (Ironic Taproom, Strada Domnița Anastasia 4, già in OSM) sono i posti dove ci si ubriaca al 100%. Sono locali speciali, non bar qualunque: davanti alla porta compare un boccale più grande con l'insegna, ed entrare nel cerchio porta la sbronza direttamente al massimo (oggi il massimo si raggiunge solo bevendo a lungo), con una battuta dedicata per ciascuno e musica dal locale mentre si è vicini. Sulla minimappa hanno un'icona propria. Ironic ha le coordinate in OSM; Anagram e Hop Hooligans non sono nell'estratto, quindi l'agente ne cerca l'indirizzo vero sul web, lo verifica su una strada esistente dei dati OSM e li aggiunge come punti manuali (file `extra-pois.json` per città, letto dal builder). Niente coordinate a occhio: se un indirizzo non si conferma con due fonti, resta fuori e lo segnala. Ci sono anche il test (entrare nel cerchio porta a 100% e la sbronza poi cala) e un tasto numero per teletrasportarsi a ciascuno. Se a Brașov c'è un posto del genere, lo indica Ludovico.
- **Maidanezi**: branchi di cani randagi vicino a parchi e blocchi, che inseguono abbaiando; un papuc lanciato li fa scappare.
- **Piccioni** a Piața Unirii e a Universitate, che si alzano in volo quando ci si avvicina.
- **Suoni**: brusio del traffico, clacson, campanella del tram, campane all'ora, manele dalle auto che passano, cani. Tutti posizionali, da pacchetti CC0 o sintetizzati come quelli di oggi.
- **Giorno e notte**: una giornata dura 24 minuti; di notte si accendono le finestre, i lampioni lungo le strade e le insegne dei bar. `?time=` fissa l'ora per test e screenshot.

## Pezzo 3: grafica

**Barra di qualità (29/09, Ludovico: "deve essere super bello, ora fa ancora ridere").** La grafica di oggi è il punto più debole e conta più delle funzioni: uno screenshot casuale del gioco deve sembrare un gioco vero, non una demo tecnica. Gli screenshot in `docs/screenshots/` sono la linea di partenza da battere. Ogni agente che tocca l'aspetto giudica il proprio lavoro guardando le immagini (a piedi, in swing, in auto, di notte, dall'alto) e non si ferma alla prima versione che "funziona". Il criterio di uscita è visivo e lo decide Ludovico sugli screenshot, non i test. Ludovico, 29/09: "deve essere con grafica spettacolare, non questa cagata attuale". Per questo la grafica non si fa più solo con shader e forme generate dal codice: si usano asset veri e gratuiti (texture fotografiche PBR, cieli HDRI, alberi e arredo urbano modellati, da Poly Haven, ambientCG, Kenney e Quaternius, solo CC0 o CC-BY, con i crediti in `assets/CREDITS.md`), con due agenti dedicati e più impegno (città, e luce con stili). Limite dichiarato: la fotografia da satellite in 3D come Google Earth non è disponibile (Google Photorealistic 3D Tiles non sono servite con fatturazione UE), quindi il tetto realistico è un gioco molto curato con edifici estrusi da OSM ma ricchi di dettaglio, non una copia fotografica della città. Gli screenshot di confronto fra tre stili servono proprio a fargli scegliere la direzione prima del lavoro di rifinitura.

- **Facciate e tetti procedurali** per tipo di edificio: blocuri a pannelli coi balconi chiusi in PVC tutti diversi, condizionatori, parabole, cisterne e antenne sui tetti; palazzi interbellici; uffici di vetro.
- **Tre direzioni di stile**, da far scegliere a Ludovico con screenshot veri, non da una descrizione: **A** realistico (il PBR di oggi spinto), **B** stilizzato alla Pixar (colori saturi, ombre morbide, luce di contorno), **C** cartoon (toon a fasce e contorni). Si attivano con `?style=a|b|c`; stesse 4 inquadrature per tutte (Piața Unirii dall'alto, uno swing sul Bd. Unirii, un blocco di Drumul Taberei da vicino, una rissa in strada), raccolte in una pagina di confronto `shots/directions/index.html` aperta nel suo browser.
- Nel giro 2, dopo la scelta: Bunica definitiva, monumenti (Casa Poporului, Ateneul, Arcul de Triumf) e passanti definitivi, tutti nello stile scelto.

## Pezzo 4: Brașov e la scelta della mappa

Aggiunto il 29/09 su richiesta di Ludovico ("metti anche Brașov, non solo Bucarest", "devi mettere che puoi selezionare la mappa").

**Scelta della mappa.** All'avvio, al posto del solo "clicca per giocare", una schermata con le due città, ognuna con un'immagine vera presa dal gioco: **București** e **Brașov**. La stessa scelta si apre dalla pausa. `?city=bucharest|brasov` salta la schermata (per test e link diretti). Respect, livelli e borcane sono condivisi fra le due città; ogni città tiene le sue missioni e i suoi record.

**La città.** Ritaglio dall'estratto della Romania già su disco, nel riquadro 45,58–45,72 N, 25,50–25,68 E: tutta Brașov con Centrul Vechi, Schei, Răcădău, Tractorul, Bartolomeu e, a sud-ovest, Poiana Brașov. Origine delle coordinate in Piața Sfatului (45,6427 N, 25,5887 E). Il builder oggi ha l'origine fissa su Piața Unirii: diventa un parametro per città, come il riquadro.

**Il rilievo.** Brașov senza montagne non è Brașov: il centro sta a circa 580 m, la Tâmpa arriva a 960 m e la Poiana a circa 1.000. Il terreno viene dal modello Copernicus GLO-30 (30 m, gratuito, senza account, attribuzione nei crediti), tessera N45 E025. Il gioco passa da "il suolo è a quota 0" a una funzione unica `city.groundAt(x, z)`, usata da fisica, traffico, passanti, bar e minimappa. Per Bucarest resta piatta e restituisce 0, quindi niente cambia e i 12 controlli devono continuare a passare. Gli edifici poggiano sul terreno, le strade lo seguono, i boschi della Tâmpa hanno gli alberi, e ci si può oscillare dai palazzi del centro su per il pendio.

**Cosa c'è di Brașov.**

- La scritta **BRAȘOV** sulla Tâmpa, costruita nel codice, a cui ci si può aggrappare.
- Tasti 1-0 sui luoghi di Brașov, con coordinate dai dati OSM: Piața Sfatului, Biserica Neagră, Strada Sforii, Scritta sulla Tâmpa, Turnul Alb, Bastionul Țesătorilor, Poarta Schei, Gara Brașov, Parcul Central, Poiana Brașov.
- **Urși**: gli orsi che scendono a frugare nei cassonetti di Schei e Răcădău, come i maidanezi a Bucarest. Il papuc li spaventa, ma un orso arrabbiato insegue.
- Tre missioni **"Vacanță la Brașov"**: *Litera căzută* (la Ș della scritta è caduta: riportarla su prima che la vedano i turisti, arrampicata sul pendio), *Strada Sforii* (inseguire un borseggiatore nella via più stretta), *Ursul din Răcădău* (riportare un orso nel bosco senza far salire le stelle).
- Una gara in discesa dalla Poiana al centro, fra le sfide.
- Crimini, polizia, passanti, cani, giorno e notte funzionano anche qui, perché leggono i dati della città e non Bucarest. Brașov non ha più tram, quindi niente tram (i dati non hanno rotaie `tram` attive).

## Pezzo 5: modelli gratis e due giri

**Da dove vengono i modelli (giro 2).**

- **Sketchfab**, licenza CC-BY: [Dacia 1300](https://sketchfab.com/3d-models/dacia-1300-inspired-f2ff7b13806f49ffbc62ce237ed26fe0), [Dacia 1310](https://sketchfab.com/3d-models/dacia-1310-4968679c9e664b7b9e2f598bad74a781), e un modello della Casa Poporului se ce n'è uno scaricabile. CC-BY chiede l'attribuzione: va nei crediti del README.
- **TRELLIS.2** di Microsoft, licenza MIT, gratis su Hugging Face: da un'immagine fa un modello 3D con le texture. Serve per Bunica e per quello che su Sketchfab manca. L'immagine di partenza di Bunica si genera con Canva.
- **Mixamo** (account Adobe gratuito): rig e animazioni per Bunica e per i passanti.
- **Poly Haven** e **Kenney**, CC0: texture, cielo, oggetti di strada, suoni.

Due correzioni rispetto a quanto detto il 28/09: **Hunyuan3D 2.1 non si può usare**, perché la sua licenza esclude l'Unione Europea, il Regno Unito e la Corea del Sud, e la Romania è in UE; al suo posto c'è TRELLIS.2. E **Google Photorealistic 3D Tiles resta escluso**: dall'8 luglio 2025 non viene servito ai progetti con fatturazione in UE.

**Giro 1 (ora), senza account esterni:** tutto il pezzo 1, tutto il pezzo 2 con i modelli di oggi (X Bot ricolorato per i passanti, tram, cani e orsi costruiti nel codice), tutto il pezzo 4 (Brașov col rilievo e la scelta della mappa), le facciate e i tetti procedurali, le tre direzioni di stile come screenshot. Finisce con la scelta dello stile da parte di Ludovico.

**Giro 2 (dopo la scelta):** Bunica definitiva, Dacie, monumenti, passanti definitivi, rifinitura nello stile scelto. Servono tre account gratuiti suoi: token Sketchfab in `.sketchfab-key`, token Hugging Face in `.hf-key`, login Adobe per Mixamo. I file con le chiavi sono già esclusi da git.

## Come si verifica

Niente è "fatto" senza prove:

- **Test automatici** per ogni sistema, sul modello dei 12 di `test/physics.mjs` e con gli stessi hook `window.__game` (con `advance`/`simulate` il ciclo del browser resta fermo, per non rileggere l'input di test). Ognuna delle 6 missioni di Bucarest e delle 3 di Brașov, ogni tipo di crimine, le stelle che salgono e scendono, una gara e un borcan raccolto hanno un test che li porta a termine davvero. Su Brașov in più: si sta in piedi sul pendio della Tâmpa senza sprofondare né galleggiare, e un'auto guidata in salita resta sulla strada.
- **Casi positivi e negativi**: il crimine compare e poi sparisce quando è risolto; le stelle salgono e poi scendono a zero; il passante investito cade e le stelle salgono, quello non toccato no.
- **Frame rate** con `node test/perf.mjs demo 30`, con tutti i sistemi attivi e la GPU libera (il gioco non aperto nel browser). Base misurata il 29/09 prima di iniziare: circa 118 fps, p50 8,3 ms, p95 9,2 ms. Soglia per il giro 1, in tutte e due le città: p50 non oltre 11 ms e p95 non oltre 16,7 ms, cioè mai sotto i 60 fps; con `?lowq` gli stessi numeri o meglio.
- **Screenshot** di ogni sistema e un **video** finale di un minuto (`test/showcase.mjs`) che mostra una missione, un crimine, un inseguimento della polizia e la città di notte.
- **Nessun errore** in console o di pagina.

## Regole di lavoro

- Gli agenti del giro girano su Sonnet 5.5 (richiesta di Ludovico del 29/09).
- Prima di tutto una fondazione, fatta da un solo agente: `main.js` diventa un registro di sistemi (ognuno con init, update, HUD e hook di test sotto `__game`), con bus di eventi, azioni di input nuove, salvataggio, marker della minimappa, configurazione per città e `city.groundAt`. Poi i sistemi si costruiscono in parallelo senza pestarsi i piedi, ognuno nel suo worktree e con la sua porta per i test.
- Git solo locale, su `main` in questa cartella. Ogni agente lavora su un suo branch o worktree e fa commit locali; l'integrazione avviene in locale. Il push è bloccato fisicamente nel repo (hook `pre-push` e `pushInsteadOf`); `gh` non va usato per niente che scriva.
- Nessun commit con firme o trailer di AI.
- Nessun account, chiave o servizio a pagamento nel giro 1.
- `README.md` aggiornato con comandi, tasti e crediti a fine giro.
