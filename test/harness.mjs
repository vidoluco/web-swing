// Shared helpers: serve dist/ and drive a headless Chromium (Metal GPU by default).
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

export const PORT = 5199;
export async function startServer() {
  const srv = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => srv.stdout.once('data', ok));
  return srv;
}
export async function launch() {
  const exe = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
  const gl = process.env.GL || 'metal';
  return chromium.launch({
    executablePath: exe,
    args: gl === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
  });
}
export async function open(browser, query, errors, w = 1280, h = 720) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver/.test(m.text())) errors.push(`[${query}] ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[${query}] pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/?${query}`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  return page;
}
