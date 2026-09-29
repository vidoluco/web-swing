// Scratch probe: node test/probe.mjs 'js expression evaluated in the page' [query]
import { startServer, launch, open } from './harness.mjs';
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, process.argv[3] || 'shot=perch', errors);
  console.log(JSON.stringify(await page.evaluate(process.argv[2]), null, 1));
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
