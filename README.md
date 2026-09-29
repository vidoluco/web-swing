# Web Swing: Bucarest

A web-swinging game in the browser over the real Bucharest, rebuilt from the OHMO.AI reel and then taken further: the whole city from OpenStreetMap, traffic you can steal, and bars where you can drink beer or țuică. three.js, runs locally.

![Swinging down a Bucharest boulevard](docs/screenshots/swing-boulevard.jpg)

| | |
|---|---|
| ![Herăstrău and the northern lakes from above](docs/screenshots/herastrau-aerial.jpg) | ![Stealing a car on a boulevard](docs/screenshots/steal-a-car.jpg) |
| The north of the city, from Herăstrău to the lakes | Any car in traffic can be stolen (F) |
| ![Swinging along the Dâmbovița](docs/screenshots/dambovita-swing.jpg) | ![View from a tower over the parks](docs/screenshots/tower-view.jpg) |
| Swinging along the Dâmbovița | A tower roof over the parks |
| ![Drinks in front of Big Ben Pub](docs/screenshots/bar-pickups.jpg) | ![Drunk: double vision and a line in Romanian](docs/screenshots/drunk.jpg) |
| A beer and a țuică outside a real bar | Double vision, and a line in Romanian with an Italian subtitle |

Status: the hero is still the Spider-Man rig. The next round replaces it with Bunica, adds fights, crimes, police and missions, and a second city (Brașov, with its real hills). The design is in `docs/specs/2026-09-29-gameplay-design.md`.

| | |
|---|---|
| Play | `npm run play` (builds, serves on http://127.0.0.1:5178/ and opens the browser) |
| Demo (autopilot) | http://127.0.0.1:5178/?demo |
| Tests | `node test/physics.mjs`: 12 scripted checks in headless Chromium, exit code 1 on failure |
| Videos | `node test/showcase.mjs` → `shots/showcase.mp4`; `node test/record.mjs 30` → `shots/preview.mp4` |
| Frame rate | `node test/perf.mjs demo 30` (real-time, on the GPU) |

## Controls

| Key | Action |
|---|---|
| Mouse | look (click to capture the pointer, Esc to pause) |
| W A S D | run, steer while swinging, climb walls; drive a car |
| Shift or left click, held | web and swing; hold to chain swings. In a car: jump out and swing |
| Space | jump, jump off a wall, release a swing with a boost. In a car: handbrake |
| E or right click | zip to the point under the crosshair |
| F | steal the car next to you, or get out |
| 1 to 9, 0 | Piața Unirii, Parliament, Ateneu, Piața Victoriei, Arcul de Triumf, Herăstrău, Sky Tower, Casa Presei, Arena Națională, Drumul Taberei |
| V, M, R | suit, minimap zoom, back to the start roof |

Walk over the drinks in front of bars and kiosks (yellow dots on the minimap): a beer counts one, a țuică two, and it wears off in a few minutes. Stealing, drinking and crashing get a line in Romanian, with an Italian subtitle, spoken by the system's Romanian voice when there is one (Ioana on macOS).

## What is in it

| Area | How |
|---|---|
| City | 212,734 buildings, 65,736 road pieces, water, parks and 346,000 trees inside 44.33–44.54 N, 25.96–26.23 E; streamed in 400 m chunks within about 2 km, a box per building beyond that, and a land-use map of the whole city on the far ground |
| Heights | OSM `height` and levels first, then the median of tagged neighbours, then the footprint; tagging errors capped |
| Traffic | Up to 60 cars on the OSM roads around you, on the right-hand lane, turning where roads meet, queueing and stopping for you |
| Drinks | 1,925 real places: 295 bars and pubs (beer and țuică) and kiosks or non-stops (beer), each with its name on a sign |
| Movement | pendulum on an inelastic rope, anchors on building faces, wall crawl and vault, zip, water respawn |
| Rendering | CSM shadows, N8AO, ACES tone mapping, SMAA, interior-mapped windows, PBR ground, double vision when drunk |

URL flags: `?lowq` for weaker GPUs, `?fps` for the frame rate, `?cars=N` for traffic density, `?spot=0..9` to start at a place, `?city=center` for the smaller centre-only build.

## Rebuilding the city

```
curl -L -o data/pbf/romania.osm.pbf https://download.geofabrik.de/europe/romania-latest.osm.pbf
cd data/pbf
osmium extract -s smart -b 25.96,44.33,26.23,44.54 romania.osm.pbf -o buc.osm.pbf --overwrite
osmium tags-filter buc.osm.pbf nwr/building nwr/building:part w/highway nwr/natural nwr/waterway nwr/leisure nwr/landuse w/railway w/man_made=bridge nwr/amenity=bar,pub,biergarten,nightclub nwr/shop=alcohol,beverages,kiosk,convenience -o buc-f.osm.pbf --overwrite
osmium export buc-f.osm.pbf -c export.json -f geojsonseq -x print_record_separator=false -o buc.geojsonseq --overwrite
cd ../.. && node --max-old-space-size=12000 tools/osm-build.mjs bucharest data/pbf/buc.geojsonseq
```

`export.json` is `{ "attributes": { "type": true, "id": true } }`. The build takes about 10 seconds and writes `public/city/bucharest/`. `tools/osm-fetch.mjs` still works for small areas through Overpass.

## Credits

| Asset | Source and licence |
|---|---|
| Map data | © OpenStreetMap contributors, ODbL, via Geofabrik |
| Cars | Kenney Car Kit, CC0 |
| Hero | Mixamo X Bot, from the three.js examples |
| Textures | ambientCG, CC0; water normals from the three.js examples |
