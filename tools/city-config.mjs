// Per-city build parameters shared by osm-build.mjs, dem.mjs, check-city.mjs and the reports.
// A new city is one entry here (or ORIGIN and BBOX in the environment, see docs/city-data-format.md).
//
// Game coordinates: x east, z south, metres, origin at the city origin. The projection is the
// same equirectangular one the runtime data was always built with.

// origin: "lat,lon" of the game (0,0). bbox: "south,west,north,east" in degrees (the area that is
// built; osmium wants the same box as west,south,east,north).
// landmarks: which named buildings go to index.json "landmarks" (b = { h, t: tags }).
// places: extra named things (any OSM element, by id) that go to "landmarks" with their ground height.
// trees: m2 per tree by green kind (wood, grass, cemetery), planted per chunk tile. Without it the older
// per-polygon rule applies, which is far too sparse for the forests of a mountain city.
// elevations: [place key, metres above sea level in OSM (ele tag or a survey), tolerance] for check-city.mjs.
export const CITIES = {
  bucharest: {
    origin: '44.4268,26.1025', // Piata Unirii
    bbox: '44.33,25.96,44.54,26.23',
    landmarks: (b) => b.h > 45 || /Palatul Parlamentului|Ateneul|Arcul de Triumf|Casa Presei|Sky Tower|Palatul CEC|Intercontinental/i.test(b.t.name),
  },
  brasov: {
    origin: '45.6427,25.5887', // Piata Sfatului
    bbox: '45.58,25.50,45.72,25.68',
    // ref is the OSM element (n node, w way, r relation), name the label used in the game.
    places: [
      { key: 'piata-sfatului', name: 'Piața Sfatului', ref: 'r9620387' },
      { key: 'biserica-neagra', name: 'Biserica Neagră', ref: 'w866090450' },
      { key: 'strada-sforii', name: 'Strada Sforii', ref: 'w219555764' },
      { key: 'turnul-alb', name: 'Turnul Alb', ref: 'w560348172' },
      { key: 'bastionul-tesatorilor', name: 'Bastionul Țesătorilor', ref: 'w37576374' },
      { key: 'poarta-schei', name: 'Poarta Schei', ref: 'w39201270' },
      { key: 'gara-brasov', name: 'Gara Brașov', ref: 'w27751534' },
      { key: 'parcul-central', name: 'Parcul Central (Nicolae Titulescu)', ref: 'w555937769' },
      { key: 'poiana-brasov', name: 'Poiana Brașov', ref: 'n116185315' },
      { key: 'tampa-summit', name: 'Vârful Tâmpa', ref: 'n296454793' },
      { key: 'tampa-telecabina-sus', name: 'Telecabina Tâmpa (stația de sus)', ref: 'w243966777' },
      { key: 'telecabina-brasov-jos', name: 'Telecabina Tâmpa (stația de jos)', ref: 'w243966776' },
      { key: 'scritta-brasov', name: 'Scritta BRAȘOV', ref: 'n11151033893' },
    ],
    trees: { wood: 150, grass: 420, cemetery: 90 },
    elevations: [['tampa-summit', 960, 25], ['tampa-telecabina-sus', 960, 25], ['telecabina-brasov-jos', 640, 25], ['poiana-brasov', 1030, 25]],
  },
};
CITIES.center = CITIES.bucharest;

// Resolves the parameters of a city. ORIGIN="lat,lon" and BBOX="south,west,north,east" in the
// environment override the entry; a city without an entry must give both, so nothing is ever
// silently built around the wrong place.
export function cityParams(name) {
  const c = CITIES[name] || {};
  const origin = process.env.ORIGIN || c.origin;
  const bbox = process.env.BBOX || c.bbox;
  if (!origin || !bbox) throw new Error(`Unknown city "${name}": add it to tools/city-config.mjs or set ORIGIN="lat,lon" and BBOX="south,west,north,east"`);
  const [lat, lon] = origin.split(',').map(Number);
  const box = bbox.split(',').map(Number);
  if ([lat, lon, ...box].some((v) => !Number.isFinite(v)) || box.length !== 4) throw new Error(`Bad ORIGIN or BBOX: ${origin} | ${bbox}`);
  return { name, origin: { lat, lon }, bbox: box, landmarks: c.landmarks, places: c.places, trees: c.trees, elevations: c.elevations };
}

// Metres per degree at the origin. Longitude is scaled by the latitude of the origin.
export function projection(origin) {
  const KX = Math.cos((origin.lat * Math.PI) / 180) * 111320;
  const KZ = 110574;
  return {
    KX,
    KZ,
    toXZ: (lon, lat) => [(lon - origin.lon) * KX, -(lat - origin.lat) * KZ],
    toLonLat: (x, z) => [origin.lon + x / KX, origin.lat - z / KZ],
  };
}
