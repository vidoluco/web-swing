// Screenshots at chosen moments. Usage: node test/shoot.mjs '[{"q":"shot=perch","steps":[[1,"perch"]],"look":[yaw,pitch]}]'
import { startServer, launch, open } from './harness.mjs';

const plan = JSON.parse(process.argv[2] || '[]');
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  for (const { q, steps, look, js } of plan) {
    const t0 = Date.now();
    const page = await open(browser, q, errors);
    console.log(`loaded ${q} in ${Date.now() - t0} ms`);
    if (js) await page.evaluate(js);
    if (look) await page.evaluate(([y, p]) => window.__game.look(y, p), look);
    for (const [t, name] of steps) {
      const st = await page.evaluate((s) => window.__game.advance(s), t);
      await page.screenshot({ path: `shots/${name}.png` });
      console.log(name, JSON.stringify(st));
    }
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
