// Downloads OpenStreetMap features for a bbox from Overpass and caches the raw JSON.
// Usage: node tools/osm-fetch.mjs <name> <south> <west> <north> <east>
import { writeFileSync, existsSync } from 'node:fs';

const [name, s, w, n, e] = process.argv.slice(2);
const out = `data/raw/${name}.json`;
if (existsSync(out) && !process.argv.includes('--force')) {
  console.log(`${out} already cached`);
  process.exit(0);
}
const q = `[out:json][timeout:600][maxsize:1073741824][bbox:${s},${w},${n},${e}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["building:part"];
  relation["building:part"]["type"="multipolygon"];
  way["highway"];
  way["natural"="water"];
  relation["natural"="water"];
  way["waterway"~"riverbank|river|canal"];
  way["leisure"~"park|garden|pitch|playground|stadium"];
  relation["leisure"~"park|garden"];
  way["landuse"~"grass|forest|cemetery|recreation_ground|village_green|meadow"];
  relation["landuse"~"forest|grass|cemetery"];
  way["natural"~"wood|scrub|grassland"];
  relation["natural"~"wood"];
  way["railway"~"rail|tram|light_rail"];
  node["natural"="tree"];
  way["natural"="tree_row"];
  way["man_made"~"bridge"];
);
out geom qt;`;
const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
for (const ep of endpoints) {
  try {
    const t0 = Date.now();
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'User-Agent': 'web-swing/0.1 (personal hobby game)', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const txt = await res.text();
    const j = JSON.parse(txt);
    writeFileSync(out, txt);
    console.log(`${out}: ${j.elements.length} elements, ${(txt.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s via ${ep}`);
    process.exit(0);
  } catch (err) {
    console.log(`${ep} failed: ${err.message}`);
  }
}
process.exit(1);
