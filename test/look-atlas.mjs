// Saves the generated leaf atlas of the trees to shots/look/atlas.png for inspection.
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'shot=perch', errors);
  const url = await page.evaluate(() => window.__game.city.look.trees_.atlas.canvas.toDataURL('image/png'));
  mkdirSync('shots/look', { recursive: true });
  writeFileSync('shots/look/atlas.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('saved');
} finally {
  await browser.close();
  srv.kill();
}
