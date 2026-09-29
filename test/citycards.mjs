// Takes the picture on each map selection card from the game itself: an aerial view without the HUD,
// written to public/ui/city-<id>.jpg (run node build.mjs afterwards).
// Usage: node test/citycards.mjs [city ...]   (default: every city on the selection screen)
import { mkdirSync, writeFileSync } from 'node:fs';
import { CITIES } from '../src/cities.js';
import { startServer, launch, open } from './harness.mjs';

const ids = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(CITIES).filter((id) => CITIES[id].menu !== false);
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  mkdirSync('public/ui', { recursive: true });
  for (const id of ids) {
    const page = await open(browser, `city=${id}&shot=perch`, errors, 960, 480);
    await page.addStyleTag({ content: '#hud, #mapwrap, #osm, #hud-top, #hud-bottom, #crosshair { display: none !important; }' });
    // cardView: camera x y z and the point it looks at (x z), metres from the city origin.
    const view = CITIES[id].cardView || [500, 260, 500, 0, 0];
    await page.evaluate(async (v) => {
      const g = window.__game;
      await g.city.streamAround(0, 0, 1400);
      g.aerial(...v);
      g.advance(1);
    }, view);
    writeFileSync(`public/ui/city-${id}.jpg`, await page.screenshot({ type: 'jpeg', quality: 82 }));
    console.log(`public/ui/city-${id}.jpg`);
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
