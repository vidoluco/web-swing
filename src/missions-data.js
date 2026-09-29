// The missions of each city, as data for src/missions.js. Coordinates are game metres (x east, z
// south, from the city origin). Every point comes from the built city data, never from a guess: the
// place from the OSM name or landmark (cities.js spots, index.json landmarks, docs/brasov-landmarks.md),
// snapped to open ground (out of every footprint and the water, next to a street or footway) with
// tools/city-data.mjs. Heights are not stored: the runtime asks city.groundAt.
//
// A mission: { id, title, where, start {x, z}, giver {name, line}, time (seconds, 0 = none),
//   wanted (stars set at the start), reward {respect}, steps [...] }. Missions unlock in order.
// Step types (src/missions.js):
//   goto     { at, r, text, say, carry (label picked up here), drop (the carried thing is left here) }
//   deliver  { points [{x, z}], r, text }: checkpoints in order, counted as they are taken (race is the same step)
//   defeat   { foes [{key, kind, at, variant, hp, scale}], guard (key of one to keep alive), text }
//   tie      { refs [keys of earlier foes], text }: every one tied (or knocked out)
//   chase    { foes, refs, flee [{ref, route [[x, z]], speed, alert}], text }: like tie, but they run
//   steal    { car {type, x, z, yaw}, text }: take that parked car
//   tail     { quarry {type, x, z}, catchR, catchT, then {key, kind, variant}, text }: keep close to a
//            car driven by the traffic until it gives up, and its driver runs off
//   destroy  { targets [{x, y, z, nx, nz}], text }: speakers on facades, silenced with G once close
//   escort   { actor {key, kind, at, fur}, to, r, text }: an animal that follows her to a place
// `say` on any step is a subtitle shown when it begins. `noStars` fails the mission if the police
// stars rise, `noHit` (a key) fails it if that actor is hit.

const p = (x, z) => ({ x, z });

export const MISSIONS = {
  bucharest: {
    campaign: 'Campagna Pensia',
    missions: [
      {
        id: 'pensia',
        title: 'Pensia furată',
        where: 'Piața Unirii',
        start: p(-20, 75), // footway on the south side of the fountains
        giver: { name: 'Doamna Cristina, la poștă', line: 'Bunica, uno scippatore ti ha strappato la pensione davanti alla posta! Prendilo!' },
        time: 0,
        reward: { respect: 60 },
        steps: [
          {
            type: 'chase',
            text: 'Ferma lo scippatore: papuc (clic o Q), poi legalo con C',
            say: 'Bunica: "Non mi scappi, ladro!"',
            foes: [{ key: 'thief', kind: 'thug', variant: 'hood', at: p(-29, 87.9), hp: 40 }],
            flee: [{ ref: 'thief', route: [[-94, 59.7], [-165, -35], [-175, -140], [-90, -190]], speed: 6.4, alert: Infinity }],
          },
        ],
      },
      {
        id: 'obor',
        title: 'Coada la Obor',
        where: 'Piața Obor',
        start: p(2102, -2385), // open ground between Hala Obor and the tower blocks
        giver: { name: 'Nea Costel, la piață', line: 'Tutta la coda aspetta la tua zacusca! Cinque barattoli in giro per la città, e il tempo corre.' },
        time: 330,
        reward: { respect: 90 },
        steps: [
          {
            type: 'deliver',
            text: 'Consegna i borcane di zacuscă',
            unit: 'borcane',
            r: 8,
            // Poșta Română, Unirii View, Piața Unirii, Ateneul Român, then the plaza short of Piața Victoriei (its race starts there).
            points: [p(1194.2, -1909.2), p(563.1, -436.5), p(30, -95), p(-442, -1606), p(-1340, -2800)],
          },
        ],
      },
      {
        id: 'nepotul',
        title: 'Nepotul',
        where: 'Parcul Herăstrău',
        start: p(-1285, -5139), // lakeside, between Taverna Racilor and Pescobar Sushi
        giver: { name: 'Andreea, la telefono', line: 'Bunica, Matei è circondato da una banda sul lungolago! Corri, ti prego!' },
        time: 0,
        reward: { respect: 110 },
        steps: [
          {
            type: 'defeat',
            text: 'Sconfiggi la banda intorno a Matei',
            say: 'Bunica: "Lasciate stare il ragazzino, delinquenti!"',
            foes: [
              { key: 'nephew', kind: 'civilian', variant: 'cap', at: p(-1269, -5145), scale: 0.7, hp: 60 },
              { key: 'g1', kind: 'thug', variant: 'hood', at: p(-1263, -5140) },
              { key: 'g2', kind: 'thug', variant: 'beanie', at: p(-1275, -5140) },
              { key: 'g3', kind: 'thug', variant: 'hood', at: p(-1262, -5133) },
              { key: 'g4', kind: 'thug', variant: 'beanie', at: p(-1276, -5133) },
              { key: 'g5', kind: 'thug', variant: 'hood', at: p(-1269, -5130) },
            ],
            guard: 'nephew',
          },
          { type: 'goto', at: p(-1269, -5145), r: 4, text: 'Abbraccia Matei', say: 'Matei: "Nonna, sei un’eroina!"' },
        ],
      },
      {
        id: 'aparatul',
        title: 'Aparatul stricat',
        where: 'Gara de Nord',
        start: p(-2129, -2102), // footway beside the station forecourt
        giver: { name: 'Doamna Aurica, pensionata', line: 'Il tassista col tassametro "rotto" mi ha spillato duecento lei! Ruba un taxi e fermalo!' },
        time: 300,
        reward: { respect: 130 },
        steps: [
          { type: 'steal', car: { type: 'taxi', x: -2139, z: -2127, yaw: 1.57 }, text: 'Ruba il taxi al posteggio (F)' },
          {
            type: 'tail',
            text: 'Insegui il tassista truffatore, tienilo a tiro',
            say: 'Bunica: "Tassametro rotto, eh? Adesso te lo aggiusto io!"',
            quarry: { type: 'taxi', x: -2137.3, z: -2114.7 },
            catchR: 9,
            catchT: 2.5,
            then: { key: 'driver', kind: 'thug', variant: 'beanie', hp: 40, speed: 6.4 },
          },
          { type: 'tie', refs: ['driver'], text: 'Lega il tassista, poi scendi dall’auto (F)' },
        ],
      },
      {
        id: 'manele',
        title: 'Manele la etajul 4',
        where: 'Drumul Taberei',
        start: p(-6091.1, 793.4),
        giver: { name: 'Domnul Ion, vicino di casa', line: 'Da tre ore le manele fanno tremare il palazzo. Tre casse sui balconi: spegnile tutte!' },
        time: 300,
        reward: { respect: 150 },
        steps: [
          {
            type: 'destroy',
            text: 'Spegni le casse sui balconi (arrampicata, poi G)',
            // Bl. TD35 south face, Bl. TD33 west face, Bl. TD32 north face, fourth floor.
            targets: [
              { x: -6096, y: 11.5, z: 760.8, nx: 0.09, nz: 1 },
              { x: -6165.6, y: 11.5, z: 780.7, nx: -1, nz: 0.09 },
              { x: -6174.3, y: 11.5, z: 783.9, nx: -0.09, nz: -1 },
            ],
          },
        ],
      },
      {
        id: 'casa',
        title: 'Casa Poporului',
        where: 'Palatul Parlamentului',
        start: p(-935, -55),
        giver: { name: 'Comisarul Dobre', line: 'Il capo della banda che ruba le pensioni è al Palazzo del Parlamento. La polizia cerca anche te, Bunica: tre stelle!' },
        time: 420,
        wanted: 3,
        reward: { respect: 300 },
        steps: [
          { type: 'goto', at: p(-1010, -25), r: 10, text: 'Raggiungi il prato davanti al Palazzo' },
          {
            type: 'defeat',
            text: 'Sconfiggi i quattro scagnozzi del capo',
            say: 'Il capo: "Bunica?! Ragazzi, fatela a pezzi!"',
            foes: [
              { key: 'boss', kind: 'thug', variant: 'hood', at: p(-1022, -25), hp: 200, scale: 1.12 },
              { key: 'h1', kind: 'thug', variant: 'beanie', at: p(-1010, -33) },
              { key: 'h2', kind: 'thug', variant: 'hood', at: p(-1010, -17) },
              { key: 'h3', kind: 'thug', variant: 'beanie', at: p(-1000, -30) },
              { key: 'h4', kind: 'thug', variant: 'hood', at: p(-1000, -20) },
            ],
            only: ['h1', 'h2', 'h3', 'h4'],
          },
          {
            type: 'chase',
            text: 'Il capo scappa: raggiungilo e legalo (C)',
            refs: ['boss'],
            flee: [{ ref: 'boss', route: [[-1060, 40], [-1130, 90], [-1100, -160]], speed: 6.2, alert: Infinity }],
          },
        ],
      },
    ],
  },

  brasov: {
    campaign: 'Vacanță la Brașov',
    missions: [
      {
        id: 'litera',
        title: 'Litera căzută',
        where: 'Scritta sulla Tâmpa',
        start: p(40, 660), // foot of the slope below the Weavers' Bastion
        giver: { name: 'Domnul Gheorghe, paznic', line: 'La Ș della scritta BRAȘOV è caduta! Riportala su prima che i turisti se ne accorgano.' },
        time: 300,
        reward: { respect: 100 },
        steps: [
          // The letter lies on the fall line below its slot in the row (docs/brasov-landmarks.md: row centre (404.3, 883.1), letters 20 m apart, Ș fourth from the B).
          { type: 'goto', at: p(345, 830), r: 5, text: 'Sali sul pendio fino alla Ș caduta', carry: 'Ș', say: 'Bunica: "Che lettera pesante, Signore!"' },
          { type: 'goto', at: p(394.7, 885.8), r: 6, text: 'Porta la Ș al suo posto sulla scritta', drop: true },
        ],
      },
      {
        id: 'sforii',
        title: 'Strada Sforii',
        where: 'Strada Sforii',
        start: p(12.8, 380), // the south east mouth of the street
        giver: { name: 'Una turista italiana', line: 'Mi ha rubato il portafoglio ed è sparito in Strada Sforii! Lei è veloce, signora!' },
        time: 0,
        reward: { respect: 120 },
        steps: [
          {
            type: 'chase',
            text: 'Insegui il borseggiatore nella via più stretta e legalo (C)',
            foes: [{ key: 'pick', kind: 'thug', variant: 'beanie', at: p(12.2, 374.5), hp: 40 }],
            // Strada Sforii runs (14.9, 378.0), (12.2, 374.5), (-12.4, 344.3), then the lane on to (-30.0, 322.6).
            flee: [{ ref: 'pick', route: [[-12.4, 344.3], [-30, 322.6], [-52.9, 307.1]], speed: 6.4, alert: Infinity }],
          },
        ],
      },
      {
        id: 'ursul',
        title: 'Ursul din Răcădău',
        where: 'Strada Aluniș, Răcădău',
        start: p(1215, 1175),
        giver: { name: 'Doamna Rodica, di Răcădău', line: 'Un orso sta frugando nei cassonetti! Non farlo arrabbiare: riportalo nel bosco, senza far arrivare la polizia.' },
        time: 0,
        reward: { respect: 160 },
        noStars: true,
        steps: [
          {
            type: 'escort',
            text: 'Guida l’orso lungo Strada Aluniș fino al bosco',
            say: 'Bunica: "Su, orsacchiotto, torna a casa tua!"',
            actor: { key: 'bear', kind: 'bear', at: p(1234, 1201) },
            // Strada Aluniș runs from (1233.7, 1200.0) down to the forest edge at (1267.6, 1274.8).
            to: p(1272, 1282),
            r: 12,
            noHit: 'bear',
          },
        ],
      },
    ],
  },
};
