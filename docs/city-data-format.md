# City data format and how to build a city

A city is a folder `public/city/<cityId>/` written by `tools/osm-build.mjs` (and `tools/dem.mjs` for the terrain). The runtime (`src/osmcity.js`) reads only these files. Bucharest (flat) and Brasov (real terrain) are built with the same tools.

## Coordinates

- Game space: x east, y up, z south, metres. The origin is the point given as `origin` in `index.json` (lat/lon). Bucharest: Piata Unirii, 44.4268 N 26.1025 E. Brasov: Piata Sfatului, 45.6427 N 25.5887 E.
- Projection (equirectangular around the origin): `x = (lon - lon0) * cos(lat0) * 111320`, `z = -(lat - lat0) * 110574`. Coordinates in chunks are rounded to 0.1 m.
- y is the height above the ground at the origin. A flat city (no `dem`) has the ground at y = 0 everywhere. With a `dem`, the ground height at (x, z) is `dem` sampled as below and every building is already at its final y.
- Chunks are 400 m squares, keyed by `cx_cz` with `cx = floor(x / 400)`, `cz = floor(z / 400)`. Only non empty chunks exist.

## index.json

| Field | Meaning |
|---|---|
| `origin` | `{ lat, lon }` of game (0, 0) |
| `chunk` | chunk size in metres (400) |
| `chunks` | `[{ k, cx, cz, nb, lod: [start, count] }]`: key, indices, number of buildings, slice of `lod.bin` |
| `dem` | terrain grid, only for cities with relief (see below). Absent means flat |
| `map` | far ground map `{ file, x0, z0, x1, z1, w, h }`: `ground.png` covers the box x0..x1, z0..z1 (the city box), north at the top |
| `landmarks` | Bucharest: `[{ name, x, z, h }]`, named buildings taller than 45 m or on a list. Brasov: `[{ key, name, x, z, y }]`, named places from `tools/city-config.mjs`, with `y` the ground height |

## Chunk file `<cx>_<cz>.json`

`{ b, r, w, g, t, rl, p }`. All coordinate arrays are flat `[x0, z0, x1, z1, ...]`.

| Field | Content |
|---|---|
| `b` | Buildings, one array each: `[style, colour, y0, y1, roof, seed, outer, holes, name]`. `style` 0 glass, 1 brick, 2 stone, 3 ribbon, 4 panel block, 5 plaster. `colour` is `#rrggbb`. The prism runs from `y0` to `y1` over the footprint `outer` minus `holes` (an array of flat rings). `roof` 1 for a pitched roof. `seed` is 0 to 999. `name` may be empty |
| `r` | Lines: `{ cls, w, pts, oneway, major, bridge }`. `cls` is `road` (cars), `foot` (footway, path, cycleway, steps, track), `ped` (pedestrian street) or `river` (`{ cls, w, pts }` only). `w` is the width in metres. `major` is true for motorway to tertiary. Streets, trails and rivers keep x, z only: the runtime drapes them on the terrain |
| `w` | Water polygons `[outer, holes]` |
| `g` | Green and paved areas `[kind, outer, holes]`. Kinds: `wood`, `grass`, `pitch`, `sand`, `cemetery`, `plaza`. Polygons larger than a chunk are cut into per chunk tiles |
| `t` | Trees, `[x, z, ...]`, x, z only |
| `rl` | Railways `{ tram, pts }` |
| `p` | Places to drink `[x, z, kind, name]`, kind 0 bar or pub, 1 kiosk or non-stop, 2 supreme bar (100% drunk on entering, from `tools/extra-pois.json`) |

Building heights in the tags are above the local ground. With a `dem`, `osm-build` bakes the terrain in: `y0` is the lowest ground under the footprint (plus `min_height` for a raised part), `y1` is the highest ground under the footprint plus the building height. The ground is sampled on the vertices, along every edge each metre, at the centroid and on every terrain grid node inside the footprint. `tools/check-city.mjs` verifies it independently: on Brasov 37,598 of 37,605 buildings have `y0` within 0.05 m of the lowest ground and the other 7 are `min_height` parts held up by their building. Without a `dem` the values are the OSM heights, as before.

## Extra places: tools/extra-pois.json

Places that the OSM extract does not tag as bars are added by the builder from `tools/extra-pois.json`, keyed by city: `{ "bucharest": { "places": [...], "rejected": [...] } }`. A place has `name`, `kind` (2 for a supreme bar), `lat`, `lon`, `street`, `address`, `position` (where the coordinate comes from) and `sources` (`[{ url, says }]`). The build stops with an error unless the sources are on at least two different sites, the street is a named `highway` in the input and a street piece runs within 60 m. An OSM place of the same name within 30 m is replaced (Ironic Taproom is an ordinary bar in OSM). `rejected` lists candidates left out and why. `EXTRA_POIS=path` reads another file, for tests. Only the `p` list of the chunk that holds the place changes: on Bucharest three chunk files differ from the build without extras, every other file is byte identical. Bucharest has three: Anagram, Hop Hooligans, Ironic Taproom.

## lod.bin

Float32 little endian, 11 values per building, in the order of `chunks[].lod` slices: `cx, cz, halfU, halfV, angle, y0, y1, r, g, b, 0`. One oriented box per building for the far view. `y0`, `y1` are the same baked heights as in the chunk.

## dem.bin and `index.dem`

```
"dem": { "file": "dem.bin", "w": 936, "h": 1034, "x0": -6915, "z0": -8550, "step": 15, "min": -80.7, "max": 870.04, "base": 591.05 }
```

- `dem.bin` is `w * h` Float32 little endian, row major. Sample `[j * w + i]` sits at `x = x0 + i * step`, `z = z0 + j * step`. Rows run in increasing z (south), columns in increasing x (east).
- Values are metres relative to the ground at the origin. `base` is that origin's elevation above sea level (591.05 m for Brasov), so `y + base` is the elevation above sea level. `min` and `max` are the extremes of the file.
- `x0`, `z0` are multiples of `step`; the grid covers the whole city box (`BBOX`) plus less than one step.
- Sampling, to be used for `groundAt(x, z)` exactly (it is what `tools/dem-lib.mjs` does): `u = clamp((x - x0) / step, 0, w - 1)`, `v = clamp((z - z0) / step, 0, h - 1)`, `i = min(floor(u), w - 2)`, `j = min(floor(v), h - 2)`, bilinear between the four nodes `(i, j) (i+1, j) (i, j+1) (i+1, j+1)`. Outside the grid the edge value holds. A flat city returns 0.

### How the terrain was made

Source: Copernicus GLO-30 (30 m), tile N45 E025, a Cloud Optimized GeoTIFF from `https://copernicus-dem-30m.s3.amazonaws.com/`, public, no account. It is a surface model (DSM, buildings and canopy included) and the tile is `PixelIsPoint`: sample `(i, j)` sits exactly at `lon0 + i/3600`, `lat0 - j/3600`. At 45.6 N that is 21.6 m east-west and 30.9 m north-south between samples.

`tools/dem.mjs` samples it bilinearly on a regular 15 m grid in game coordinates, then applies a separable Gaussian blur with sigma 22 m (about 1.5 cells, radius 3 sigma), computed on a padded grid so the border is not biased. There is no building or forest mask: the correction is the blur alone. Measured on the Brasov streets (5 m steps along 10,256 minor and 2,626 major road pieces):

| sigma | p95 bump over 5 m | p99.9 bump | summit of the Tampa above the origin |
|---|---:|---:|---:|
| 0 (raw, bilinear only) | 0.23 m | 1.05 m | 359.3 m |
| 15 m | 0.12 m | 0.69 m | 353.5 m |
| 22 m (used) | 0.09 m | 0.64 m | 349.0 m |
| 30 m | 0.07 m | 0.62 m | 343.4 m |

The bump is the absolute second difference of the ground along a street, so 0.09 m means the ground bends by less than 9 cm over 5 m on 95% of the street samples. The price of the blur is about 10 m off the sharpest summit. Against the elevations in OSM (`ele` tags, plus the 1030 m usually quoted for Poiana Brasov), read back from the built city by `check-city.mjs`: Tampa summit 940 m against 960, top cable car station 940 against 960, bottom station 639 against 640, Poiana Brasov 1026 against about 1030. The DSM is below those values, not above, so there is no sign of a canopy bias in the forest and no forest correction was applied.

The range in the Brasov box is -80.7 to +870.0 m, not the -30 to +430 of the town alone: the box (45.58 to 45.72 N, 25.50 to 25.68 E) also holds the Postavaru massif in the south (highest sample at x = -1560, z = 6075, 1461 m above sea level) and the plain in the north (lowest at 510 m). The Tampa summit is at +349, Poiana Brasov at +435, the buildings stand between -78.9 and +579.

## Rebuilding a city end to end

Needs `osmium` (Homebrew `osmium-tool`) and Node (tested with 24) with `npm install` done (the `geotiff` package is a dev dependency). `data/` is git ignored; everything below writes there except the last step.

```
# 0. once: the Romania extract (Geofabrik) and the osmium export config
mkdir -p data/pbf && curl -L -o data/pbf/romania.osm.pbf https://download.geofabrik.de/europe/romania-latest.osm.pbf
echo '{ "attributes": { "type": true, "id": true } }' > data/pbf/export.json

# 1. cut the city box (osmium wants west,south,east,north) and keep the tags the builder reads
cd data/pbf
osmium extract -s smart -b 25.50,45.58,25.68,45.72 romania.osm.pbf -o brasov.osm.pbf --overwrite
osmium tags-filter brasov.osm.pbf nwr/building nwr/building:part w/highway nwr/natural nwr/waterway nwr/leisure nwr/landuse w/railway w/man_made=bridge nwr/amenity=bar,pub,biergarten,nightclub nwr/shop=alcohol,beverages,kiosk,convenience nwr/natural=peak,wood w/highway=path,footway,steps,track nwr/aerialway nwr/place=square,suburb,village nwr/tourism=attraction,viewpoint nwr/historic nwr/railway=station -o brasov-f.osm.pbf --overwrite
osmium export brasov-f.osm.pbf -c export.json -f geojsonseq -x print_record_separator=false -o brasov.geojsonseq --overwrite
cd ../..

# 2. terrain: downloads the GLO-30 tile(s) the box needs into data/dem/ and writes data/dem/brasov/dem.bin
node tools/dem.mjs brasov

# 3. the city: chunks, lod.bin, ground.png, index.json, and dem.bin copied next to them
node --max-old-space-size=12000 tools/osm-build.mjs brasov data/pbf/brasov.geojsonseq

# 4. checks
node tools/check-city.mjs brasov
node build.mjs && PORT=5213 node test/physics.mjs      # the runtime still has to load Bucharest
```

- The first three lines of the filter are the Bucharest filter of the README. `nwr/natural=peak,wood` and `w/highway=path,footway,steps,track` are already covered by `nwr/natural` and `w/highway`; they are listed to make the mountain needs explicit. The last five terms only feed the named places (`aerialway`, squares, suburbs, attractions, historic sites, stations); the builder drops everything it does not draw.
- `ground-map.mjs` has no command of its own: `osm-build.mjs` calls it and writes `ground.png`. It is a plain land use map (woods, parks, pitches, water, streets) with no baked lighting on purpose, so the runtime can light the ground it drapes it on and change it with the time of day. At 5.6 m per pixel Brasov is 2502 x 2765 and 0.36 MB.
- Timing on a laptop for Brasov: extract 3 s, filter and export under 1 s, dem 1 s, osm-build 2 s. The export config above gives the same output as the longer one in use on the Bucharest machine (`linear_tags`, `area_tags`), byte for byte, for both cities.
- Bucharest is rebuilt with the README command and gives byte identical files (SHA-256 of all chunk files unchanged): `node --max-old-space-size=12000 tools/osm-build.mjs bucharest data/pbf/buc.geojsonseq`.

### Adding a third city

1. Add an entry to `CITIES` in `tools/city-config.mjs`: `origin` (`"lat,lon"`), `bbox` (`"south,west,north,east"`), optionally `landmarks` (a rule on named buildings), `places` (named OSM elements by id, for spawn points), `trees` (m2 per tree by green kind, needed for forests of many km2) and `elevations` (surveyed heights for `check-city`). Or skip the entry and pass `ORIGIN="lat,lon" BBOX="south,west,north,east"` in the environment; a city name with neither stops with an error instead of falling back to Bucharest.
2. Run steps 1 to 4 above with its box. For a city inside a GLO-30 tile no download is needed beyond the automatic one; for a flat city skip step 2 (no `dem`, the ground is 0).
3. Open `?city=<cityId>` and read the console.

## Credits to add to the README

- Terrain: Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Free of charge, no account.
- Map data: (c) OpenStreetMap contributors, ODbL, via Geofabrik.
