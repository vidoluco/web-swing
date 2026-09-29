# Light and look log

Branch `feat/look-light`, 29/09/2026. Everything that is not building and street geometry: sky, sun, shadows, fog, water, grading, post-processing, the day and night cycle and the three style directions.

## What exists

| Piece | File |
|---|---|
| Shared night uniform, exactly `export const uniforms = { uNight: { value: 0 } };` | `src/uniforms.js` |
| The system: clock, lights, fog, styles, pause menu buttons, key B, saves | `src/env.js` (one line in `src/systems-list.js`) |
| Sun and moon positions, night amount, clock parsing (pure functions) | `src/sun.js` |
| Sky dome (gradient, sun glow, clouds, stars, moon) and the palette by sun height | `src/skydome.js` |
| Environment maps baked at six sun heights and blended, with the Poly Haven skies | `src/envmap.js` |
| Haze, tone mapping, grade, cartoon bands and ink, rim light, lamp pools, sun glare | `src/grade.js` |
| The three styles as numbers | `src/styles.js` |
| Water | `src/water.js` |
| Street lamp positions for the night pools | `src/lamps.js` |
| Tests, comparison shots | `test/light.mjs`, `test/directions.mjs` |

Hook in shared files: one line in `src/main.js` (`gfx: { composer, csm, sky }` on the game object, marked `// light:`), one line in `src/systems-list.js`, one row in the README credits table.

## How to use it

`game.env`: `hours`, `style` (`'a'`, `'b'`, `'c'`), `night` (same value as `uniforms.uNight.value`), `setTime(h)`, `setStyle(id)`, `cycleStyle()`, `running`, `ready` (promise, the Poly Haven skies are in), `lamps.found` and `lamps.lit`.

URL flags: `?time=17:30` fixes the hour (add `?cycle=on` to let it run from there), `?cycle=off` stops the clock, `?daymin=N` sets the length of a day in real minutes (default 24), `?style=a|b|c` (beats what was saved, and is saved), `?lowq` also turns off the bloom and bakes smaller environment maps. The game starts at 17:30. Key B cycles the style, the pause menu has three buttons. Saved under `style`.

The clock is local solar time (noon at 12.5), latitude per city (Bucharest 44.43, Brasov 45.65), declination of 29 September. Sunrise is about 6:45, sunset about 18:15. `uNight` goes from 0 to 1 while the sun is between +4 and -6 degrees, so it is about 0.5 at sunset. `voice.say('night')` and `voice.say('morning')` are called when the clock itself crosses dusk and dawn (not when a test sets the hour).

## The three styles

| | A realistic | B Pixar | C cartoon |
|---|---|---|---|
| Sun, fill | sun 1.0, fill 1.0 | sun 0.95, more fill and ambient, softer shadow edge (radius 2.8) | sun 1.0, strong ambient, hard shadow edge (radius 0.6) |
| Sky | physical-looking palette, thin clouds | more saturated, warmer horizon, puffier clouds | flat banded clouds with two tones |
| Grade | neutral and ACES mix, contrast 1.06, warm highlights, cool shadows | saturation 1.4, lifted violet shadows, softer curve | neutral curve, four light bands, saturation boost |
| Haze | full aerial perspective | 55% | 30% |
| Bloom | subtle | wide and gentle | none |
| Extra | sun glare, film-like dither | screen-space rim light on edges facing the sun | ink outlines from depth and colour steps, edge-preserving blur so texture grain does not flicker |
| Water | dark teal, sky mirror | teal, half the mirror, faint ripple lines | cyan, mostly flat, white ripple lines |

A switch is a set of uniforms, nothing is created, so it leaks nothing (checked in `test/light.mjs`: 10 switches, same geometries, textures, programs and passes).

## Decisions

- One grade shader with the style as a uniform, in one post pass together with the bloom, instead of one pass per style: a switch costs nothing and unused branches cost nothing.
- Environment light is baked once at six sun heights (-20, -6, 0, 8, 25, 60 degrees) and the two neighbours are blended pixel by pixel into one target, then turned toward the sun with `scene.environmentRotation`. No baking during play. The sun disc is left out of the bake (the directional light is the sun). The environment maps are shared by the three styles; the style tints the light and the grade instead.
- The four Poly Haven skies (midday, sunset, dusk, night; 1K, 5 MB in total) are mixed 35 to 55% into the matching bakes, turned so their sun sits where ours does and scaled to the brightness of the procedural sky. The visible sky stays procedural: 1K photos are too soft to look at.
- One shadow-casting light: the sun by day, the moon by night, each faded to nothing before they hand over. Its direction is kept at least 6 degrees above the horizon, so shadows are long, not endless.
- Fog colour equals the horizon colour of the sky, per city: Bucharest hazy and warm grey (fog 700 to 6200 m), Brasov clearer with blue distance (1800 to 13000 m). The depth haze in the grade pass adds height fog and a glow toward the sun. The fog values are not overridden by the tests' `aerial()` any more: `env` owns `scene.fog`.
- Street lamp pools at night are a post effect (no real lights, no shader recompile): up to 16 warm pools around the nearest lamps. The lamps come from `city.lamps` (`[{x, y, z}]`, y is the height of the light) when the city has that list, otherwise virtual lamps every 34 m along the drivable roads, alternating sides. **look-city: if you place real lamp posts, publish their light positions as `city.lamps` and the pools will sit under them.**

## Found on the way: no specular light under CSM

The CSM add-on replaces the `lights_fragment_begin` shader chunk with a copy written before three r186. The copy never looks up the DFG table (`material.dfg`) and never sets `multiScatteringCompensation`, so on every standard material all specular light was zero: no sun glints, no sky reflection on water, glass, cars or curtain walls (a mirror sphere rendered black). `src/env.js` puts the missing block back into the chunk (guarded, only if it is missing) and reports it as `game.env.specularRepaired`. It also damps the image based specular on rough surfaces (roughness above 0.55, down to 30% at 0.95), so asphalt and plaster do not shine like mirrors at grazing angles. Water, glass and paint keep the full reflection. Everything that looked flat and matt before now has the correct sheen; owners of materials may want to look at their roughness values.

## Cost

Measured with GPU timer queries at 1280x720 on a GPU that was shared with the other agents' browsers, so the absolute numbers are inflated and noisy. Extra frame time over having no grade pass at all (25th percentile of many batches): A about +2.2 ms, B about +2.3 ms, C about +2.3 ms. The old tone mapping and vignette pass that this replaces cost part of that, so the net extra is about 1.5 ms. CPU: `env.update` takes 0.001 to 0.005 ms per tick in every style (measured over 2000 calls); the environment blend is one small pass and runs about four times a second while the clock moves. Startup adds six environment bakes (a few tens of ms) and one rebake when the skies have loaded.

`test/light.mjs` prints both numbers on a `COST` line and fails if the CPU cost passes 0.5 ms per tick, or if a steady GPU shows more than 3 ms extra (with a busy GPU it prints a note and skips that ceiling).

## Comparison page and screenshots

`node build.mjs && PORT=5228 node test/directions.mjs` writes `shots/directions/index.html` and 15 JPEGs (four viewpoints times three styles, three night shots in style A). `shots/directions/` is the one folder of `shots/` that is not ignored by git.

Plan for the README screenshots table once a style is chosen (retake with the chosen style, same viewpoints, copy into `docs/screenshots/`): the Piata Unirii aerial (`unirii`), the swing toward the Parliament (`swing`), the night avenue (`night-avenue`), the walk under the lamps (`night-street`), the block at Drumul Taberei (`taberei`) and the street brawl (`brawl`). The current table (`swing-boulevard`, `herastrau-aerial`, `steal-a-car`, `dambovita-swing`, `tower-view`, `bar-pickups`, `drunk`) predates the light system and should be retaken by whoever owns the chosen style.

## Limits and not done

- No foam along the banks: the water polygons carry no distance to the bank and the river bed is at the same height, so there is nothing to compare with. Foam is a sparse pattern on the wave crests only. There is no CC0 foam or water texture in the game beyond the three.js normal map that was already there (ambientCG has no water surface material).
- No film grain or lens dirt overlay: they did not improve the picture. A tiny dither hides banding in the sky.
- Windows and interior lights are look-city's: they read `uNight` and are not lit by time yet in the building shader in this branch.
- Nothing in `osmcity.js` or `materials2.js` was touched. The water material of the city is restyled in place from `src/water.js` (it keeps the time uniform that `city.update` sets).
- The rim light of style B and the ink of style C come from the depth buffer, so they follow silhouettes and not inner detail.
