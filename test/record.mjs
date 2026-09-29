// Records the autopilot demo to shots/preview.mp4 (GPU headless, fixed 30 fps timestep).
// Usage: node test/record.mjs [seconds] [query]
import { startServer, launch, open } from './harness.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const seconds = +(process.argv[2] || 30);
const query = process.argv[3] || 'demo';
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, query, errors);
  rmSync('shots/frames', { recursive: true, force: true });
  mkdirSync('shots/frames', { recursive: true });
  const n = seconds * 30;
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__game.advance(1 / 30));
    await page.screenshot({ path: `shots/frames/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
    if (i % 150 === 0) console.log(`frame ${i}/${n}`, JSON.stringify(await page.evaluate(() => window.__game.state())));
  }
} finally {
  await browser.close();
  srv.kill();
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', 'shots/frames/f%04d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', 'shots/preview.mp4']);
rmSync('shots/frames', { recursive: true, force: true });
console.log('shots/preview.mp4');
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
