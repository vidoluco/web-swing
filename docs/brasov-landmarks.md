# Brasov: places, sign and bear streets

Coordinates are game space (x east, z south, metres) around Piata Sfatului, 45.6427 N 25.5887 E; `ground y` is the terrain height above the origin (add 591.05 for metres above sea level). Every number here comes from `public/city/brasov/` and is produced by `node tools/brasov-report.mjs` (places, sign, streets) and `node tools/check-city.mjs brasov`. The places are also in `public/city/brasov/index.json` under `landmarks`, with a `key`, and are defined by OSM id in `tools/city-config.mjs`.

## Places

| Place | x | z | ground y | roof y | OSM element and why |
|---|---:|---:|---:|---:|---|
| Piața Sfatului | 30.9 | 60.1 | -3.7 | - | relation r9620387 (`place=square`, pedestrian area), area centroid. The origin is 60 m north of it, at the top edge of the square |
| Biserica Neagră | -42.3 | 186.9 | 4.0 | 46.0 | way w866090450, "Biserica Neagră / Black Church" |
| Strada Sforii | -8.2 | 349.4 | 5.0 | - | way w219555764 (footway), middle of the line, the narrowest street. The `tourism=attraction` node n10694805645 is 7 m away |
| Turnul Alb | -172.9 | -18.1 | 39.7 | 55.4 | way w560348172, "Turnul Alb / White Tower", on the slope west of the old town |
| Bastionul Țesătorilor | 19.8 | 640.6 | 27.1 | 62.1 | way w37576374, "Bastionul Țesătorilor / Weavers' Bastion", at the foot of the Tampa |
| Poarta Schei | -182.0 | 392.2 | 8.5 | 16.4 | way w39201270, `historic=city_gate` |
| Gara Brașov | 1936.4 | -2044.3 | -25.3 | -10.1 | way w27751534, the station building (`building=train_station`); the `railway=station` node is 45 m away. 2.8 km north east of the origin |
| Parcul Central | 253.1 | -374.9 | -10.2 | - | way w555937769, "Parcul Nicolae Titulescu", the park in front of the Prefecture that people call the Central Park; its fountain is tagged "Parcul N. Titulescu (Central)". OSM also has a "Parcul Central Avantgarden" but that is a housing estate park 3 km west, not used |
| Poiana Brașov (centre) | -2530.2 | 5085.3 | 434.9 | - | node n116185315 (`place=village`). 5.7 km south south west of the origin, 1026 m above sea level |
| Tampa summit | 327.7 | 943.3 | 349.0 | - | node n296454793 (`natural=peak`, ele 960). The smoothed DEM gives 940 m, see `city-data-format.md` |
| Tampa cable car, top station | 640.9 | 785.0 | 349.3 | 361.5 | way w243966777 (`aerialway=station`, 3 levels). Stand on the roof at y 361.5; the terrace is at ground level 349.3 |
| Tampa cable car, bottom station | 349.1 | 414.2 | 47.8 | 61.7 | way w243966776 (ele 640) |
| BRAȘOV sign | 370.6 | 892.4 | 331.5 | - | node n11151033893, see below |

Suggested `SPOTS` for the number keys 1 to 0 in `src/cities.js` (name, x, z; the y comes from `groundAt`):

```
['Piața Sfatului', 30.9, 60.1], ['Biserica Neagră', -42.3, 186.9], ['Strada Sforii', -8.2, 349.4],
['Scritta sulla Tâmpa', 404.3, 883.1], ['Turnul Alb', -172.9, -18.1], ['Bastionul Țesătorilor', 19.8, 640.6],
['Poarta Schei', -182.0, 392.2], ['Gara Brașov', 1936.4, -2044.3], ['Parcul Central', 253.1, -374.9], ['Poiana Brașov', -2530.2, 5085.3]
```

An autopilot loop through the old town on flat streets: `[[0, 0], [-42, 187], [-182, 392], [-8, 349], [253, -375]]`.

Mountain trails exist in the OSM data: the box around the Tampa (x 0 to 1100, z 500 to 1500) holds 93 `foot` pieces (path, footway, steps, track) for 12.1 km, and the Postavaru and Poiana box (x -3500 to 0, z 2500 to 8000) holds 470 pieces for 85.9 km. Forest: 922 `wood` tiles; about 557,000 trees at one per 150 m2 in the woods (the `trees` table in `tools/city-config.mjs`; raise the number to thin them).

## The BRAȘOV sign on the Tampa

OSM has it. Two nodes are both named "Brașov sign": n11151033893 (`tourism=attraction`) at 45.63463 N 25.59346 E, and n295148065 (`disused:tourism=viewpoint`) 20 m to the west south west at 45.63459 N 25.59321 E, both about 55 m north and 30 m east of the Tampa peak node (45.63417 N 25.59291 E). I use the attraction node, game (370.6, 892.4), ground y 331.5 (922 m above sea level). The 45.6427 N of the origin is in the middle of the old town, 900 m north of the real sign.

Checked against the terrain rather than trusted:

- The ground there falls at 32.6 degrees towards compass 345 (north north west). The origin lies at compass 337 and 966 m away. So the slope faces the town and the sign is on the north west side of the Tampa, as it is in reality.
- Along the contour (compass 75, unit vector x 0.964, z -0.266) the ground is 303.8, 314.6, 323.2, 328.7, 331.1, 331.5, 331.2, 330.5, 330.2, 330.9, 332.2 m every 20 m from -100 to +100 m: a level bench from -20 to +100 m along the contour, falling away at the west end.

To place the letters: centre the row on the bench, 35 m along the contour from the node, at game (404.3, 883.1), ground y 330.8. From -25 to +95 m along the contour the ground stays between 330.2 and 331.8 (1.6 m), so a row up to 120 m long fits. The letters face downhill, towards the town, along (x -0.266, z -0.964). Seen from the town they read left to right from the east north east end to the west south west end, the B at contour +, the V at contour -, that is along (x -0.964, z 0.266).

## Streets where the bears can come down

Residential, living and unclassified named streets whose middle lies within 900 m of the centre of Schei (25.5815 E 45.6385 N) or of Racadau (25.603 E 45.630 N), at least 120 m long, ranked by mean grade (sum of the ground changes over the length, sampled every 10 m from `dem.bin`), keeping those that come within 100 m of a `wood` polygon. "Entry" is the point of the street closest to the forest, where a bear would appear.

| Street | District | length m | mean grade | steepest 10 m | ground y | wood distance m | entry x | entry z | entry ground y | OSM ways |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---|
| Strada Cibinului | Schei | 704 | 13% | 20% | 8.3 to 98.5 | 1 | -401 | 157 | 21.7 | w27335541 w275195967 |
| Strada Plăieșilor | Schei | 310 | 13% | 27% | 17.9 to 42.1 | 54 | -23 | 703 | 33.7 | w23486403 w23486766 w24213024 |
| Strada Petőfi Sándor | Schei | 526 | 11% | 55% | 42.1 to 75.4 | 0 | 33 | 702 | 49.9 | w23486771 w220324518 w221923826 |
| Strada Aluniș | Răcădău | 132 | 8% | 23% | 40.2 to 49.7 | 16 | 1268 | 1275 | 49.7 | w23257144 |
| Strada Fragilor | Răcădău | 128 | 7% | 36% | 35.6 to 42.8 | 25 | 1372 | 1188 | 42.8 | w23257163 |

I picked these five: Cibinului is the longest steep one, Plăieșilor and Petőfi Sándor sit at the foot of the Tampa slope next to the Bastion (bears coming down from the forest right into the old streets), Aluniș and Fragilor are the steepest short residential streets of Racadau. The populated part of Racadau is gentler than Schei (ground +35 to +70 m, 5 to 8% on average, 20 to 40% on short ramps); the steep ground there is the forest above it. Other candidates from the same ranking: Strada Stâncii and Strada Traian Demetrescu (Schei, 12% and 10%), Strada Jepilor and Strada Molidului (Racadau, long, 5% and 3 to 5%, forest at 18 m and 21 m).
