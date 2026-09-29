// Per-city configuration, keyed by the folder under public/city/. Coordinates are metres from the
// city origin (index.json "origin"): x east, z south.
//   spots      name and position of the places on the number keys 1 to 9 and 0, then Alt + 1 to 9 and 0 for the ones after the tenth
//   waypoints  route of the ?demo autopilot
//   spawnFacing  the start roof is chosen on the side of this point, looking at it
//   image      screenshot on the map selection card
//   cardView   camera for that screenshot, node test/citycards.mjs <id>: x y z, then the x z it looks at (and optionally its y)
//   spawn, sign, trees, atmosphere   optional, for a city with relief (see brasov)
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
    // The supreme bars, on Alt + 1 to 3 (coordinates: tools/extra-pois.json).
    ['Anagram', -5220, -3527.7],
    ['Hop Hooligans', 158.5, -1519.3],
    ['Ironic Taproom', -590.5, -795.4],
  ],
  // Palace of Parliament, Cismigiu, Universitate, Piata Unirii.
  waypoints: [[-1150, -60], [-860, -1150], [0, -960], [30, 0]],
  spawnFacing: [-1218, -68],
};

// Brasov (spec, Pezzo 4). Places and the sign from docs/brasov-landmarks.md. A fourth item in a spot is
// { r } the radius to look for a roof in (500 when missing), or { ground: true, face: [x, z] } to start
// on the ground looking that way instead of on a roof.
//   spawn   where the start roof is looked for, x z and radius: the flat roof beside Piata Sfatului
//   sign    the BRASOV letters on the Tampa (src/hillsign.js): row centre, the way they look, letter height
//   trees   crown and trunk colour, darker than the plane trees of Bucharest
//   atmosphere  cooler light and closer fog than Bucharest (main.js)
const brasov = {
  label: 'Brașov',
  tagline: 'Il Centrul Vechi sotto la Tâmpa, fra i monti',
  image: 'ui/city-brasov.jpg',
  cardView: [-150, 85, 300, 370, 880, 200], // from the old town up to the Tampa and its sign; the last number is the height it looks at
  spots: [
    ['Piața Sfatului', 30.9, 60.1, { r: 150 }],
    ['Biserica Neagră', -42.3, 186.9, { r: 150 }],
    ['Strada Sforii', -8.2, 349.4, { r: 150 }],
    ['Scritta sulla Tâmpa', 400, 867.7, { ground: true, face: [0.266, 0.964] }],
    ['Turnul Alb', -172.9, -18.1, { r: 150 }],
    ['Bastionul Țesătorilor', 19.8, 640.6, { r: 150 }],
    ['Poarta Schei', -182, 392.2, { r: 150 }],
    ['Gara Brașov', 1936.4, -2044.3, { r: 150 }],
    ['Parcul Central', 253.1, -374.9, { r: 150 }],
    ['Poiana Brașov', -2530.2, 5085.3, { r: 150 }],
  ],
  // Down from the Tampa slope through the old town: the sign, the Weavers' Bastion, Strada Sforii, the Black Church, Piata Sfatului, the park.
  waypoints: [[330, 800], [20, 640], [-8, 349], [-42, 187], [30, 60], [253, -375]],
  spawn: { x: 20, z: 36, r: 120 },
  spawnFacing: [327.7, 943.3], // the summit of the Tampa
  sign: { text: 'BRAȘOV', x: 404.3, z: 883.1, face: [-0.266, -0.964], height: 25 },
  trees: { crown: 0x86a57a, trunk: 0x4a3f34 }, // colours of the crowns and trunks of the woods
  atmosphere: { fogNear: 700, fogFar: 4200, fogColor: 0xaebfd2, sun: 3.0, sunColor: 0xe6edff, skyLight: 0xc4d8ff, turbidity: 2.4, rayleigh: 1.7 },
};

export const CITIES = {
  bucharest,
  brasov,
  // The smaller centre-only build of Bucharest (?city=center), not offered on the selection screen.
  center: { ...bucharest, label: 'București (centro)', menu: false },
};
