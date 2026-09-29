// The comparison of the three style directions: the same four viewpoints in A (realistic), B (Pixar) and
// C (cartoon), plus a night set in the default style, and the static page shots/directions/index.html to look at them.
// Usage: node build.mjs, then PORT=5228 node test/directions.mjs [view ...]   (no view: all of them, and the page)
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

const OUT = 'shots/directions';
const W = 1600, H = 900;
const STYLES = [
  ['a', 'A', 'Realistico', 'Il PBR di oggi spinto: grading filmico, aria e foschia in profondità, sole caldo con ombre lunghe, riflessi veri sull’acqua.'],
  ['b', 'B', 'Pixar', 'Colori saturi e caldi, ombre morbide, luce di contorno sui bordi, bagliore delicato e un cielo un po’ esagerato.'],
  ['c', 'C', 'Cartoon', 'Luce a fasce piatte, contorni a inchiostro su edifici ed eroina, colori pieni e nuvole di carta.'],
];

// Each view: how to put the game in place (runs in the page), and the words for the page.
const VIEWS = [
  {
    id: 'unirii',
    title: 'Piața Unirii dall’alto',
    note: '17:30, ora d’oro. Il viale verso il Parlamento e il sole basso a sinistra.',
    query: 'shot=perch&time=17:30',
    setup: async () => {
      const g = window.__game;
      await g.goTo(0);
      g.advance(5);
      g.aerial(430, 250, 470, -80, -60);
      g.advance(4);
    },
  },
  {
    id: 'swing',
    title: 'Uno swing lungo il Bd. Unirii',
    note: '17:30. Verso il Parlamento, con il sole in faccia.',
    query: 'shot=street&time=17:30',
    setup: () => {
      const g = window.__game;
      const p = g.player;
      p.reset();
      p.pos.set(-250, 30, 6);
      p.vel.set(-28, 4, 0);
      p.mode = 'air';
      g.look(Math.PI / 2, -0.12);
      g.setInput({ moveY: 1, swing: true });
      for (const t of [0.9, 0.6, 0.7]) g.advance(t);
    },
  },
  {
    id: 'taberei',
    title: 'Un blocco di Drumul Taberei da vicino',
    note: '17:30. I palazzoni a pannelli con la luce radente sulla facciata ovest.',
    query: 'shot=perch&time=17:30',
    setup: async () => {
      const g = window.__game;
      await g.goTo(9);
      g.advance(3);
      g.player.reset();
      g.player.pos.set(-6140, 0, 856);
      g.player.groundBox = null;
      g.player.facing.set(0.9, 0, -0.4);
      g.look(-0.98, 0.42);
      g.rig.dist = 5.5;
      g.hero.root.visible = false;
      g.advance(4);
    },
  },
  {
    id: 'brawl',
    title: 'Rissa in strada',
    note: '17:30. Tre teppisti, due passanti e un poliziotto sull’asfalto vicino all’Ateneo.',
    query: 'shot=perch&time=17:30',
    setup: async () => {
      const g = window.__game;
      const A = g.actors;
      await g.goTo(2);
      g.advance(3);
      const px = g.player.pos.x + 6, pz = g.player.pos.z + 0;
      g.player.reset();
      g.player.pos.set(px, 0, pz);
      g.player.groundBox = null;
      g.player.facing.set(1, 0, 0);
      g.look(-Math.PI / 2 + 0.2, 0.1);
      g.rig.dist = 5;
      const at = (kind, dx, dz, o = {}) => A.spawn(kind, { x: px + dx, z: pz + dz }, { exact: true, persist: true, ...o });
      const t1 = at('thug', 4.5, -2.2, { yaw: Math.PI / 2, variant: 'hood' });
      const t2 = at('thug', 6, 1.8, { yaw: Math.PI / 2 + 0.4, variant: 'beanie' });
      const t3 = at('thug', 2.6, -4.6, { yaw: Math.PI / 2 - 0.5, variant: 'hood' });
      const c1 = at('civilian', 9, 3, { yaw: -Math.PI / 2, variant: 'scarf' });
      const c2 = at('civilian', 1, 5, { yaw: Math.PI, variant: 'cap' });
      const cop = at('cop', 10, -3.5, { yaw: Math.PI / 2 });
      for (const a of [t1, t2, t3]) a && A.walkTo(a, px, pz, 4.5);
      c1 && A.walkTo(c1, px + 30, pz + 6, 4.2);
      c2 && A.walkTo(c2, px - 20, pz + 10, 4.2);
      cop && A.walkTo(cop, px + 3, pz - 1, 4);
      g.advance(0.7);
    },
  },
];

// The night set, in the default style (A).
const NIGHT = [
  { id: 'night-unirii', title: 'Piața Unirii di notte', query: 'shot=perch&time=22', view: VIEWS[0] },
  { id: 'night-street', title: 'Il viale sotto i lampioni', query: 'shot=street&time=22', view: VIEWS[3] },
  { id: 'night-swing', title: 'Swing nella notte', query: 'shot=street&time=21', view: VIEWS[1] },
];

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const srv = await startServer();
const browser = await launch();
const errors = [];

async function clean(page) {
  await page.addStyleTag({ content: '#hud, #mapwrap, #hud-top, #hud-bottom, #crosshair, #osm, #toast { display: none !important; }' });
}
async function shoot(page, file) {
  await page.evaluate(() => window.__game.advance(0));
  await page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 90 });
  console.log(file);
}

try {
  for (const v of VIEWS) {
    if (only.length && !only.includes(v.id)) continue;
    const page = await open(browser, v.query, errors, W, H);
    await clean(page);
    await page.evaluate(() => window.__game.env.ready);
    await page.evaluate(`(${v.setup.toString()})()`);
    for (const [id] of STYLES) {
      await page.evaluate((s) => window.__game.env.setStyle(s), id);
      await shoot(page, `${v.id}-${id}`);
    }
    await page.close();
  }
  for (const n of NIGHT) {
    if (only.length && !only.includes(n.id)) continue;
    const page = await open(browser, n.query, errors, W, H);
    await clean(page);
    await page.evaluate(() => window.__game.env.ready);
    await page.evaluate(`(${n.view.setup.toString()})()`);
    await page.evaluate(() => window.__game.env.setStyle('a'));
    await shoot(page, n.id);
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}

if (!only.length) {
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cell = (file, label) => `<figure><a href="${file}.jpg"><img src="${file}.jpg" loading="lazy" alt="${esc(label)}" width="${W}" height="${H}"></a><figcaption>${esc(label)}</figcaption></figure>`;
  const rows = VIEWS.map(
    (v) => `<section><h2>${esc(v.title)}</h2><p class="note">${esc(v.note)}</p><div class="row">${STYLES.map(([id, L, name]) => cell(`${v.id}-${id}`, `${L} · ${name}`)).join('')}</div></section>`
  ).join('\n');
  const nights = `<section><h2>Di notte, nello stile predefinito</h2><p class="note">Finestre e lampioni accesi, luna, stelle, pozze di luce calda sotto i lampioni.</p><div class="row">${NIGHT.map((n) => cell(n.id, n.title)).join('')}</div></section>`;
  const legend = STYLES.map(([, L, name, text]) => `<div><b>${L} · ${esc(name)}</b><span>${esc(text)}</span></div>`).join('');
  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tre direzioni di stile · Web Swing</title>
<style>
  :root { color-scheme: dark; --ink: #f2f4f8; --dim: #a9b1bf; --line: #2a3140; --accent: #ff9f4a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0c0f14; color: var(--ink); font: 16px/1.5 "Helvetica Neue", system-ui, sans-serif; }
  header, section { max-width: 1900px; margin: 0 auto; padding: 24px 20px 8px; }
  h1 { margin: 0 0 6px; font-size: clamp(26px, 4vw, 40px); letter-spacing: 0.01em; }
  h2 { margin: 26px 0 2px; font-size: clamp(20px, 2.6vw, 28px); }
  .lead { color: var(--dim); max-width: 70ch; margin: 0; }
  .legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
  .legend div { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #121722; }
  .legend b { display: block; color: var(--accent); font-size: 18px; }
  .legend span { color: var(--dim); font-size: 15px; }
  .note { color: var(--dim); margin: 0 0 12px; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  figure { margin: 0; }
  figure a { display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: #121722; }
  figure img { display: block; width: 100%; height: auto; aspect-ratio: ${W} / ${H}; }
  figcaption { margin: 6px 2px 0; font-weight: 800; font-size: 17px; }
  footer { max-width: 1900px; margin: 0 auto; padding: 28px 20px 48px; color: var(--dim); font-size: 15px; }
  #zoom { position: fixed; inset: 0; z-index: 10; display: none; align-items: center; justify-content: center; background: rgba(4,6,10,0.94); cursor: zoom-out; }
  #zoom.on { display: flex; }
  #zoom img { max-width: 100vw; max-height: 100vh; object-fit: contain; }
  #zoom span { position: fixed; left: 16px; bottom: 14px; font-weight: 800; font-size: 17px; text-shadow: 0 1px 4px #000; }
  @media (max-width: 900px) { .row, .legend { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Tre direzioni di stile</h1>
  <p class="lead">Le stesse quattro inquadrature dal gioco vero, con lo stesso codice, cambiando solo lo stile (tasto B, o ?style=a|b|c). Tocca un’immagine per ingrandirla. Sotto, la notte nello stile predefinito.</p>
  <div class="legend">${legend}</div>
</header>
${rows}
${nights}
<footer>Immagini prese dal gioco a ${W}×${H}, senza interfaccia. Cielo, luce, ombre, acqua e post-processing sono del sistema di luce; edifici e strade sono quelli di oggi e cambieranno con il lavoro sulla città.</footer>
<div id="zoom" role="dialog" aria-label="Immagine ingrandita"><img alt=""><span></span></div>
<script>
  const z = document.getElementById('zoom'), zi = z.querySelector('img'), zs = z.querySelector('span');
  document.querySelectorAll('figure a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    zi.src = a.href;
    zs.textContent = a.parentElement.querySelector('figcaption').textContent;
    z.classList.add('on');
  }));
  z.addEventListener('click', () => z.classList.remove('on'));
  addEventListener('keydown', (e) => e.key === 'Escape' && z.classList.remove('on'));
</script>
</body>
</html>
`
  );
  console.log(`${OUT}/index.html`);
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
