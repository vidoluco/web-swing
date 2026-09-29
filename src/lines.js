// What Bunica says. One entry per kind, each a list of [romanian, italian subtitle, options?].
//   options.w     pick weight, 1 when missing (the toast of the țuică is heavier than the rest)
//   options.city  the line is only said in that city (cities.js id)
// The index of a line inside its kind is its file name: public/audio/voice/<kind>-<n>.a.mp3 and .b.mp3,
// so new lines go at the END of a list, otherwise the audio of every line after it is regenerated.
// Each line has to fit in about 4 seconds of the slow voice A, which is roughly 25 characters.
// The voice is a grandmother: feminine forms in both languages (beată, nevinovată, ubriaca, presa).
export const LINES = {
  // ---------- stealing a car ----------
  steal: [
    ['Mașina e a nepotului.', 'L’auto è di mio nipote. Lui ancora non lo sa.'],
    ['Ți-o aduc înapoi, poate!', 'Te la riporto... forse!'],
    ['Merge și fără ITP?', 'Va anche senza revisione?'],
    ['Are și brăduț parfumat!', 'Ha pure l’alberello profumato!'],
    ['Fără listă de așteptare!', 'Senza lista d’attesa, come ai tempi della Dacia!'],
    ['Am și eu carnet. Cred.', 'Anch’io ho la patente. Credo.'],
    ['Merg cu ea la piață!', 'La porto al mercato!'],
  ],
  stealtaxi: [
    ['Acum sunt taximetristă!', 'Taxi! Ah, adesso la tassista sono io!'],
    ['Aparatul e stricat!', 'Il tassametro è rotto!'],
    ['Până la Obor, 200 de lei!', 'Fino a Obor, 200 lei!'],
    ['Cursa e gratis, dragă!', 'La corsa è gratis, cara!'],
  ],
  stealpolice: [
    ['Acte la control, băiete!', 'Documenti, ragazzo!'],
    ['Poliția sunt eu acum!', 'La polizia adesso sono io!'],
    ['Brigada Bunicilor, stați!', 'Brigata Nonne, fermi tutti!'],
  ],
  stealdrunk: [
    ['Șoferița desemnată: eu!', 'L’autista designata: io!'],
    ['Două drumuri? Mijlocul!', 'Vedo due strade. Prendo quella in mezzo!'],
    ['Frâna? Care frână?', 'Il freno? Quale freno?'],
  ],

  // ---------- drinking ----------
  beer: [
    ['Noroc!', 'Salute!'],
    ['Una rece, ca acasă!', 'Una fresca, come a casa!'],
    ['Apă cu spumă, dragă!', 'Acqua con la schiuma, cara!'],
    ['Cu pensia, doar una!', 'Con la pensione, solo una!'],
    ['Bere și telenovelă!', 'Birra e telenovela!'],
    ['Plec la Vama Veche!', 'Parto per Vama Veche!'],
  ],
  tuica: [
    ['Să trăiască Bucureștiul!', 'Viva Bucarest!', { w: 6, city: 'bucharest' }],
    ['Să trăiască Brașovul!', 'Viva Brașov!', { w: 6, city: 'brasov' }],
    ['Țuică făcută în cadă!', 'Țuică fatta nella vasca da bagno!'],
    ['Arde până-n papuci!', 'Brucia fino alle pantofole!'],
    ['Medicament, nu băutură!', 'È una medicina, non una bevanda!'],
    ['Văd două Parlamente!', 'Vedo due Parlamenti!'],
  ],
  wasted: [
    ['Vă iubesc pe toți!', 'Voglio bene a tutti!'],
    ['Pământul se mișcă!', 'La terra si muove!'],
    ['Cine a mutat casa?', 'Chi ha spostato la casa?'],
    ['Nu-s beată, sunt fericită!', 'Non sono ubriaca, sono felice!'],
  ],
  crash: [
    ['Cine a pus blocul aici?!', 'Chi ha messo il palazzo qui?!'],
    ['Tinichigiul mă știe!', 'Il carrozziere mi conosce!'],
    ['Parcare ca la București!', 'Parcheggio alla bucarestina!'],
    ['RCA-ul nu mai plătește!', 'L’assicurazione non paga più!'],
  ],
  sunk: [
    ['Am parcat în lac!', 'Ho parcheggiato nel lago!'],
    ['Bine că era apă!', 'Meno male che c’era l’acqua!'],
    ['Spălat auto gratuit!', 'Autolavaggio gratis!'],
    ['Sâmbătă nu mai fac baie!', 'Sabato niente bagno, allora!'],
  ],

  // ---------- fighting ----------
  punch: [
    ['Ia papucul!', 'Prendi la pantofola!'],
    ['Asta e pentru pensia mea!', 'Questo è per la mia pensione!'],
    ['Marș acasă, obraznicule!', 'A casa, screanzato!'],
    ['Poftim, un papuc!', 'Ecco qua, una pantofola!'],
  ],
  hurt: [
    ['Au, spatele meu!', 'Ahi, la mia schiena!'],
    ['Atenție, am 70 de ani!', 'Attento, ho 70 anni!'],
    ['Vai de mine!', 'Povera me!'],
    ['Doare ca factura la gaze!', 'Fa male come la bolletta del gas!'],
  ],
  knockout: [
    ['Somn ușor, băiete!', 'Sogni d’oro, ragazzo!'],
    ['Un papuc și gata!', 'Una pantofola e via!'],
    ['N-am pierdut mâna!', 'Non ho perso la mano!'],
  ],
  tie: [
    ['Legat ca un cârnat!', 'Legato come un salame!'],
    ['Sfoara de rufe nu iartă!', 'Il filo del bucato non perdona!'],
    ['Te las la uscat!', 'Ti lascio ad asciugare!'],
    ['Două cleme și gata!', 'Due mollette e via!'],
  ],
  thrown: [
    ['Papuc zburător!', 'Pantofola volante!'],
    ['Prinde, dacă poți!', 'Prendila, se ci riesci!'],
    ['Ținta: capul tău!', 'Bersaglio: la tua testa!'],
  ],
  dodge: [
    ['Nu mă prinzi tu pe mine!', 'Non mi prendi!'],
    ['Prea încet, băiete!', 'Troppo lento, ragazzo!'],
    ['Am reflexe de pisică!', 'Ho i riflessi di un gatto!'],
  ],

  // ---------- crimes and the police ----------
  crimeStart: [
    ['Hoții! Din nou hoții!', 'Ladri! Di nuovo ladri!'],
    ['Trebuie să intervin eu!', 'Devo intervenire io!'],
    ['Iar mă cheamă datoria!', 'Ancora il dovere che chiama!'],
  ],
  crimeDone: [
    ['Dreptate s-a făcut!', 'Giustizia è fatta!'],
    ['Merit o cafea!', 'Mi merito un caffè!'],
    ['Mă întorc la telenovelă.', 'Torno alla telenovela.'],
  ],
  wanted1: [
    ['Vine poliția!', 'Arriva la polizia!'],
    ['M-a văzut și vecina!', 'Mi ha vista anche la vicina!'],
    ['Eu? Nevinovată!', 'Io? Innocente!'],
  ],
  wanted3: [
    ['Toată poliția e după mine!', 'Tutta la polizia mi cerca!'],
    ['Prea multe sirene, mamă!', 'Troppe sirene, mamma!'],
    ['Îmi trebuie un avocat!', 'Mi serve un avvocato!'],
  ],
  wanted5: [
    ['Nici Securitatea nu era așa!', 'Nemmeno la Securitate era così!'],
    ['Pensia mea e pierdută!', 'La mia pensione è perduta!'],
    ['Elicopter? Pentru mine?', 'Un elicottero? Per me?'],
  ],
  busted: [
    ['M-au prins! Vai de mine!', 'Mi hanno presa! Povera me!'],
    ['Măcar mă duceți acasă?', 'Almeno mi portate a casa?'],
    ['Avocatul meu e nepotul!', 'Il mio avvocato è mio nipote!'],
  ],
  escaped: [
    ['Ha! Nu mă prind ei!', 'Ah! Non mi prendono!'],
    ['M-am ascuns după bloc.', 'Mi sono nascosta dietro il palazzo.'],
    ['Uf, am scăpat!', 'Uff, ce paura, mi sono salvata!'],
  ],

  // ---------- missions and levels ----------
  missionStart: [
    ['Am o treabă de făcut!', 'Ho un lavoro da fare!'],
    ['Să mă pun pe treabă!', 'Mettiamoci al lavoro!'],
    ['Pentru pensie, la luptă!', 'Per la pensione, all’attacco!'],
  ],
  missionDone: [
    ['Treabă făcută la cheie!', 'Lavoro fatto a regola d’arte!'],
    ['Merit un cozonac!', 'Mi merito un panettone!'],
    ['Bravo mie!', 'Brava me!'],
  ],
  missionFail: [
    ['Vai, s-a stricat totul!', 'Ahimè, è andato tutto storto!'],
    ['Nu mi-a ieșit, dragă.', 'Non mi è riuscita, cara.'],
    ['Bătrânețea nu iartă!', 'La vecchiaia non perdona!'],
  ],
  levelUp: [
    ['Am urcat de nivel!', 'Sono salita di livello!'],
    ['Mai respectată ca ieri!', 'Più rispettata di ieri!'],
    ['Bătrână, dar tare!', 'Vecchia, ma tosta!'],
  ],
  collect: [
    ['Zacuscă! Comoara mea!', 'Zacuscă! Il mio tesoro!'],
    ['Iarna e salvată!', 'L’inverno è salvo!'],
    ['Încă unul!', 'Un altro!'],
    ['Ca la Obor, dar gratis!', 'Come a Obor, ma gratis!'],
  ],

  // ---------- city life ----------
  tram: [
    ['Tramvaiul 41 întârzie!', 'Il tram 41 è in ritardo!'],
    ['Bilet? Ce bilet?', 'Biglietto? Quale biglietto?'],
    ['Dă-te, tramvai, că trec!', 'Fatti in là, tram, che passo!'],
  ],
  bear: [
    ['Urs! Vai de mine!', 'Un orso! Povera me!'],
    ['Ursule, marș la pădure!', 'Orso, via nel bosco!'],
    ['Nu-ți dau zacusca!', 'La zacusca non te la do!'],
  ],
  dog: [
    ['Cățelule, nu mă mușca!', 'Cagnolino, non mordermi!'],
    ['Maidanezii nu mă iubesc.', 'I randagi non mi amano.'],
    ['Am cârnat în geantă!', 'Ho la salsiccia in borsa!'],
  ],
  pigeon: [
    ['Hai, porumbei, sus!', 'Forza, piccioni, su!'],
    ['Am pâine pentru voi!', 'Ho del pane per voi!'],
    ['Ce gălăgie, porumbei!', 'Che chiasso, piccioni!'],
  ],
  morning: [
    ['Dimineață, București!', 'Buongiorno, Bucarest!', { city: 'bucharest' }],
    ['Dimineață, Brașov!', 'Buongiorno, Brașov!', { city: 'brasov' }],
    ['Cafeaua și apoi piața!', 'Prima il caffè e poi il mercato!'],
    ['Piața se aglomerează!', 'Il mercato si affolla!'],
  ],
  night: [
    ['Noapte bună, cartier!', 'Buonanotte, quartiere!'],
    ['E târziu, la culcare!', 'È tardi, a letto!'],
    ['Telenovela mă așteaptă.', 'La telenovela mi aspetta.'],
    ['Lumină! Nu ca pe vremuri!', 'Luci! Non come una volta!'],
  ],

  // ---------- bottles in PET ----------
  'pet.beer': [
    ['Bere la PET: patrimoniu!', 'Birra in PET: patrimonio nazionale!'],
    ['2,5 litri de fericire!', '2,5 litri di felicità!'],
    ['Cu pensia, doar la PET!', 'Con la pensione, solo in PET!'],
  ],
  'pet.wine': [
    ['Vin roșu, ca la țară!', 'Vino rosso, come in campagna!'],
    ['Vin la PET, viață bună!', 'Vino in PET, bella vita!'],
    ['Nu-i Cotnari, dar merge!', 'Non è Cotnari, ma va!'],
    ['Un pahar pentru inimă!', 'Un bicchiere per il cuore!'],
  ],
  'pet.tuica': [
    ['Să trăiască Bucureștiul!', 'Viva Bucarest!', { w: 6, city: 'bucharest' }],
    ['Să trăiască Brașovul!', 'Viva Brașov!', { w: 6, city: 'brasov' }],
    ['Țuica bunicii, în PET!', 'La țuică della nonna, in bottiglia di plastica!'],
    ['O sticlă de foc!', 'Una bottiglia di fuoco!'],
  ],
  'pet.cola': [
    ['Doi litri de bule!', 'Due litri di bollicine!'],
    ['Băutura nepoților!', 'La bevanda dei nipoti!'],
    ['Alerg ca la 20 de ani!', 'Corro come a vent’anni!'],
  ],
  'pet.water': [
    ['Apă plată, cap limpede!', 'Acqua naturale, testa lucida!'],
    ['Mă trezesc, mamă!', 'Mi risveglio, mamma!'],
    ['Bine că nu-i țuică!', 'Meno male che non è țuică!'],
  ],
  'pet.juice': [
    ['Vitamine pentru bunica!', 'Vitamine per la nonna!'],
    ['Suc, să nu răcesc!', 'Succo, così non mi raffreddo!'],
    ['O portocală pe zi!', 'Un’arancia al giorno!'],
  ],

  // ---------- health ----------
  lowHealth: [
    ['Nu mai pot, mamă!', 'Non ce la faccio più!'],
    ['Tensiunea, vai de mine!', 'La pressione, povera me!'],
    ['Aduceți-mi tensiometrul!', 'Portatemi il misuratore di pressione!'],
  ],

  // ---------- the supreme bars: 100% drunk on the spot ----------
  'supreme.anagram': [
    ['Literele dansează, mamă!', 'Anagram! Le lettere ballano, mamma!'],
    ['Bere pe malul lacului!', 'Birra in riva al lago!'],
    ['Anagram, iubirea mea!', 'Anagram, amore mio!'],
  ],
  'supreme.hop': [
    ['Hop, hop, la huligani!', 'Hop, hop, dagli Hop Hooligans!'],
    ['Bunica huligană, prezent!', 'La nonna hooligan, presente!'],
    ['Hameiul mă ia pe sus!', 'Il luppolo mi porta in alto!'],
  ],
  'supreme.ironic': [
    ['Ironic? Beau serios!', 'Ironico? Bevo sul serio!'],
    ['Ironic Taproom, casa mea!', 'Ironic Taproom, casa mia!'],
    ['Beată la Ironic!', 'Ubriaca all’Ironic! Che ironia!'],
  ],
};

export const KINDS = Object.keys(LINES);

// The lines of a kind that may be said in a city, with their index (the audio file number) and weight.
export function candidates(kind, cityId) {
  const out = [];
  (LINES[kind] || []).forEach(([ro, it, o], n) => {
    if (o?.city && o.city !== cityId) return;
    out.push({ kind, n, ro, it, w: o?.w ?? 1 });
  });
  return out;
}
