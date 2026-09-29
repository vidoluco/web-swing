// Per-city configuration, keyed by the folder under public/city/. Coordinates are metres from the
// city origin (index.json "origin"): x east, z south.
//   spots      name and position of the places on the number keys 1 to 9 and 0
//   waypoints  route of the ?demo autopilot
//   spawnFacing  the start roof is chosen on the side of this point, looking at it
//   image      screenshot on the map selection card
//   cardView   camera for that screenshot, node test/citycards.mjs <id>: x y z, then the x z it looks at
const bucharest = {
  label: 'București',
  tagline: 'Piața Unirii, il Parlamento e i viali fra i blocchi',
  image: 'ui/city-bucharest.jpg',
  cardView: [800, 240, 60, 350, 30], // along Bd. Unirii to the Palace of Parliament
  spots: [
    ['Piața Unirii', 0, 0],
    ['Palatul Parlamentului', -1218, -68],
    ['Ateneul Român', -420, -1606],
    ['Piața Victoriei', -1381, -2833],
    ['Arcul de Triumf', -1938, -4466],
    ['Parcul Herăstrău', -1049, -5167],
    ['Sky Tower', 177, -5658],
    ['Casa Presei Libere', -2498, -6021],
    ['Arena Națională', 3972, -1151],
    ['Drumul Taberei', -5643, 739],
  ],
  // Palace of Parliament, Cismigiu, Universitate, Piata Unirii.
  waypoints: [[-1150, -60], [-860, -1150], [0, -960], [30, 0]],
  spawnFacing: [-1218, -68],
};

export const CITIES = {
  bucharest,
  brasov: {
    label: 'Brașov',
    tagline: 'Il Centrul Vechi sotto la Tâmpa, fra i monti',
    image: 'ui/city-brasov.jpg', // PLACEHOLDER picture until the Brasov data exists: then node test/citycards.mjs brasov
    cardView: null,
    spots: [],
    waypoints: [],
    spawnFacing: null,
    note: 'TODO: spots, waypoints and spawnFacing come with the Brasov data (spec, Pezzo 4); origin is Piata Sfatului.',
  },
  // The smaller centre-only build of Bucharest (?city=center), not offered on the selection screen.
  center: { ...bucharest, label: 'București (centro)', menu: false },
};
