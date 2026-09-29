// Checks for the game foundation: event bus, save, systems registry, hud, minimap markers, input actions,
// per-city plumbing and the map selection screen. Usage: PORT=5211 node test/core.mjs. Exit code 1 on any failure.
import { startServer, launch, open, PORT } from './harness.mjs';
import { Events } from '../src/events.js';
import { Save } from '../src/save.js';
import { mulberry32 } from '../src/config.js';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const URL0 = `http://127.0.0.1:${PORT}/`;

// ---------- event bus and save, straight in Node ----------
{
  const ev = new Events();
  const got = [];
  const off = ev.on('x', (p) => got.push(['a', p]));
  ev.on('x', (p) => got.push(['b', p]));
  const log = console.error;
  console.error = () => {};
  ev.on('y', () => {
    throw new Error('listener bug');
  });
  ev.on('y', (p) => got.push(['after-throw', p]));
  ev.emit('y', 1);
  console.error = log;
  ev.emit('x', { n: 1 });
  off();
  ev.emit('x', { n: 2 });
  ev.emit('nobody', 3);
  check('events: payload reaches every listener, off() stops one, a throwing listener does not block the rest', JSON.stringify(got) === JSON.stringify([['after-throw', 1], ['a', { n: 1 }], ['b', { n: 1 }], ['b', { n: 2 }]]), got);
}
{
  const setStorage = (v) => Object.defineProperty(globalThis, 'localStorage', { value: v, configurable: true, writable: true });
  const store = new Map();
  setStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
  const a = new Save('t');
  a.set('city', 'brasov');
  a.set('respect', { level: 3, xp: [1, 2] });
  const b = new Save('t');
  const back = b.get('respect');
  back.level = 99;
  b.set('other', 1);
  const c = new Save('t');
  check('save: values round trip through storage, get returns copies, a second writer keeps the others', c.get('city') === 'brasov' && c.get('respect').level === 3 && c.get('other') === 1 && c.get('none', 'fallback') === 'fallback', { stored: store.get('t') });
  a.set('city', undefined);
  check('save: setting undefined removes the name', new Save('t').get('city', 'gone') === 'gone', {});
  setStorage({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  });
  const m = new Save('t');
  m.set('k', [1]);
  const noStorageOk = m.get('k')[0] === 1;
  delete globalThis.localStorage;
  const n = new Save('t');
  n.set('k', 2);
  check('save: falls back to memory when storage throws or is missing', noStorageOk && n.get('k') === 2, {});
}

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  // ---------- the game on Bucharest ----------
  const page = await open(browser, 'lowq&seed=7', errors);

  let r = await page.evaluate(() => {
    const g = window.__game;
    const keys = ['scene', 'camera', 'renderer', 'params', 'cityId', 'city', 'player', 'hero', 'traffic', 'drinks', 'drunk', 'voice', 'input', 'events', 'actors', 'hud', 'save', 'minimap', 'sfx', 'time', 'rng'];
    return {
      missing: keys.filter((k) => !(k in g)),
      hasActors: !!g.actors && typeof g.actors.spawn === 'function',
      cityId: g.cityId,
      cityCityId: g.city.cityId,
      origin: g.city.origin,
      ground: [g.city.groundAt(0, 0), g.city.groundAt(-1200, 500)],
      rng: [g.rng(), g.rng(), g.rng()],
      mapselectHidden: document.getElementById('mapselect').classList.contains('hidden'),
      lastCity: g.save.get('city'),
    };
  });
  const rng7 = mulberry32(7);
  check('game object carries the shared contract, including a working game.actors', r.missing.length === 0 && r.hasActors && r.cityId === 'bucharest', r);
  check('city knows its id and origin, groundAt is flat', r.cityCityId === 'bucharest' && Math.abs(r.origin.lat - 44.4268) < 1e-6 && r.ground.every((v) => v === 0), { id: r.cityCityId, origin: r.origin, ground: r.ground });
  check('rng is seeded (?seed=7 gives mulberry32(7))', JSON.stringify(r.rng) === JSON.stringify([rng7(), rng7(), rng7()]), r.rng);
  check('?city=bucharest skips the map selection and the city is remembered', r.mapselectHidden && r.lastCity === 'bucharest', { hidden: r.mapselectHidden, last: r.lastCity });

  r = await page.evaluate(() => {
    const g = window.__game;
    const t0 = g.time;
    g.advance(2);
    return { dt: g.time - t0 };
  });
  check('game.time advances with the ticks', Math.abs(r.dt - 2) < 0.1, r);

  // Systems: init once, update every tick in list order, onCityChange with the city, dispose on remove, a throwing one is isolated.
  r = await page.evaluate(() => {
    const g = window.__game;
    const n0 = g.systems.list.length;
    const log = [];
    const probe = (name) => ({ name, inits: 0, updates: 0, dt: 0, city: null, disposed: false,
      init() { this.inits++; log.push(name + '.init'); },
      update(dt) { this.updates++; this.dt += dt; if (this.updates === 1) log.push(name); },
      onCityChange(id) { this.city = id; log.push(name + '.city'); },
      dispose() { this.disposed = true; } });
    const a = g.systems.add(probe('probeA'));
    const bad = g.systems.add({ name: 'bad', update() { throw new Error('boom'); } });
    const b = g.systems.add(probe('probeB'));
    g.advance(1, 1 / 30);
    const during = { a: a.updates, b: b.updates, dt: Math.round(a.dt * 100) / 100 };
    g.systems.remove('probeA');
    g.advance(0.5, 1 / 30);
    return { n0, n1: g.systems.list.length, log, during, aInits: a.inits, aCity: a.city, aDisposed: a.disposed, aAfter: a.updates, bAfter: b.updates, bad: g.systems.get('bad').name, everyStarted: g.systems.list.every((x) => g.systems.started.has(x)), get: g.systems.get('probeB') === b, cleanup: (g.systems.remove('bad'), g.systems.remove('probeB'), g.systems.list.length) };
  });
  const boom = errors.filter((e) => /system bad\.update/.test(e));
  for (const e of boom) errors.splice(errors.indexOf(e), 1);
  check('systems: init once, then onCityChange, update every tick in list order', r.aInits === 1 && r.aCity === 'bucharest' && r.during.a >= 30 && r.during.a <= 31 && r.during.b === r.during.a && Math.abs(r.during.dt - 1) < 0.04 && r.log.join() === 'probeA.init,probeA.city,probeB.init,probeB.city,probeA,probeB', r);
  check('systems: remove() calls dispose and stops updates', r.aDisposed && r.aAfter === r.during.a && r.bAfter > r.during.b + 13 && r.n1 === r.n0 + 2 && r.cleanup === r.n0, r);
  check('systems: one that throws is logged once and does not stop the others', boom.length === 1 && r.during.b >= 30, { logged: boom.length });
  check('systems: everything in systems-list.js has started', r.everyStarted, {});

  // HUD.
  r = await page.evaluate(() => {
    const g = window.__game, $ = (id) => document.getElementById(id);
    const shown = (id) => getComputedStyle($(id)).opacity === '1' || (!$(id).classList.contains('hidden') && getComputedStyle($(id)).display !== 'none');
    g.hud.toast('Piața Unirii');
    const toastOn = $('toast').textContent === 'Piața Unirii' && $('toast').classList.contains('show');
    g.advance(2.5);
    const toastOff = !$('toast').classList.contains('show');
    g.hud.setObjective('Raggiungi Piața Unirii');
    const objOn = shown('objective') && $('objective').textContent === 'Raggiungi Piața Unirii';
    g.hud.setObjective(null);
    const objOff = $('objective').classList.contains('hidden');
    let calls = 0, sawGame = false;
    const panels0 = $('hud-panels').children.length; // the systems' own panels are there already
    const late = g.hud.add('late', { order: 5, render(el, game) { calls++; sawGame = game === g; el.textContent = 'late ' + calls; } });
    const early = g.hud.add('early', { order: 1, render(el) { el.textContent = 'early'; } });
    const span = document.createElement('span');
    span.textContent = 'element';
    const raw = g.hud.add('raw', span);
    g.advance(1);
    // Panels of the real systems (health, respect, ...) are in the row too: look only at this test's own.
    const own = (e) => ['raw', 'early', 'late'].includes(e.dataset.id);
    const order = [...$('hud-panels').children].filter(own).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left || x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((e) => e.dataset.id);
    const res = { toastOn, toastOff, objOn, objOff, calls, sawGame, order, rawHas: raw.contains(span), parent: early.parentElement.id, texts: [early.textContent, late.textContent] };
    g.hud.remove('late');
    g.hud.remove('early');
    g.hud.remove('raw');
    res.removed = [...$('hud-panels').children].filter(own).length;
    return res;
  });
  check('hud: toast shows and fades, objective line sets and clears', r.toastOn && r.toastOff && r.objOn && r.objOff, r);
  check('hud: panels are ordered, render() gets the game about ten times a second, an element can be added, remove() takes it out', r.order.join() === 'raw,early,late' && r.calls >= 8 && r.calls <= 14 && r.sawGame && r.rawHas && r.parent === 'hud-panels' && r.removed === 0, r);

  // Minimap markers, read back from the canvas pixels.
  r = await page.evaluate(() => {
    const g = window.__game, mm = g.minimap, c = document.getElementById('minimap');
    const s = mm.scale * (c.width / 200), p = g.player.pos;
    // Read through a copy made for reading, so the canvas itself does not warn about repeated readbacks.
    const copy = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }).getContext('2d', { willReadFrequently: true });
    const px = (x, y) => {
      copy.drawImage(c, 0, 0);
      return Array.from(copy.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    };
    const magenta = ([r, gg, b]) => r > 235 && gg < 25 && b > 235;
    const cx = c.width / 2, cy = c.height / 2;
    const draw = () => mm.draw(1, p, 0, null);
    const owners0 = mm.markers.size; // the systems' own markers are there already
    const res = {};
    mm.setMarkers('t1', [{ x: p.x + 50, z: p.z, color: '#ff00ff', shape: 'dot' }, { x: p.x, z: p.z + 40, color: '#ff00ff', shape: 'square' }, { x: p.x - 50, z: p.z, color: '#ff00ff', shape: 'ring', label: 'Test' }]);
    draw();
    res.dot = magenta(px(cx + 50 * s, cy));
    res.square = magenta(px(cx, cy + 40 * s));
    res.ringHole = !magenta(px(cx - 50 * s, cy));
    res.ringEdge = magenta(px(cx - 50 * s + 4.5 * 2 * 1.2, cy));
    mm.setMarkers('t2', [{ x: p.x + 20000, z: p.z, color: '#ff00ff', shape: 'dot' }]);
    draw();
    const [er, eg, eb] = px(c.width - 16, cy);
    res.edge = er > 190 && eg < 60 && eb > 190; // drawn a little faded
    res.ownersCoexist = res.dot && magenta(px(cx + 50 * s, cy));
    mm.setMarkers('t1', [{ x: p.x + 50, z: p.z + 60, color: '#ff00ff', shape: 'dot' }]);
    draw();
    res.replacedOld = !magenta(px(cx + 50 * s, cy));
    res.replacedNew = magenta(px(cx + 50 * s, cy + 60 * s));
    mm.setMarkers('t1', []);
    mm.setMarkers('t2', null);
    draw();
    res.cleared = !magenta(px(cx + 50 * s, cy + 60 * s)) && !magenta(px(c.width - 16, cy)) && mm.markers.size === owners0;
    return res;
  });
  check('minimap: markers draw by shape, off-map ones stick to the edge, an owner replaces or clears its own set', Object.values(r).every(Boolean), r);

  // Input actions.
  r = await page.evaluate(() => {
    const g = window.__game, i = g.input, cv = document.getElementById('game');
    const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const names = ['attackPressed', 'throwPressed', 'tiePressed', 'interactPressed', 'pausePressed'];
    const snap = () => Object.fromEntries(names.map((n) => [n, !!i.state[n]]));
    const res = { idle: snap() };
    for (const [code, n] of [['KeyJ', 'attackPressed'], ['KeyQ', 'throwPressed'], ['KeyC', 'tiePressed'], ['KeyG', 'interactPressed'], ['KeyP', 'pausePressed']]) {
      fire('keydown', code);
      const on = snap();
      fire('keyup', code);
      i.endFrame();
      res[code] = on[n] && names.every((m) => m === n || !on[m]) && !snap()[n];
    }
    i.locked = true;
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    res.click = { attack: i.state.attackPressed, swingStill: i.state.swingPressed && i.state.swing };
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    i.endFrame();
    i.locked = false;
    fire('keydown', 'KeyF');
    res.carKeyKept = i.state.carPressed && !i.state.attackPressed;
    fire('keyup', 'KeyF');
    i.endFrame();
    return res;
  });
  check('input: J, Q, C, G, P and left click report their action, swing keeps its meaning, presses clear each frame', Object.values(r.idle).every((v) => !v) && ['KeyJ', 'KeyQ', 'KeyC', 'KeyG', 'KeyP'].every((k) => r[k]) && r.click.attack && r.click.swingStill && r.carKeyKept, r);

  // HUD layout: nothing overlaps and nothing is under 13 px, on a desktop and a phone-sized window.
  const layout = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    return page.evaluate(async () => {
      const g = window.__game, $ = (id) => document.getElementById(id);
      $('overlay').classList.add('hidden');
      g.hud.setObjective('Riporta la Ș sulla scritta prima che la vedano i turisti');
      g.hud.toast('Respect +50');
      g.hud.add('health', { order: 1, render(el) { el.textContent = 'Salute 100 / 100'; } });
      g.hud.add('level', { order: 2, render(el) { el.textContent = 'Livello 4 · Respect 1250 / 2000'; } });
      g.hud.add('stars', { order: 3, render(el) { el.textContent = 'Polizia ★★★☆☆'; } });
      g.voice.say('crash', 0.9);
      $('hint').textContent = 'F scendi · Shift salta fuori · Spazio freno a mano';
      $('hint').classList.add('show');
      g.drunk.beers = 3;
      g.drunk.tuicas = 2;
      g.advance(0.2);
      await new Promise((ok) => setTimeout(ok, 350));
      const boxes = [];
      for (const sel of ['#hud', '#mapwrap', '#osm', '#objective', '#toast', '.hud-item', '#say', '#hint']) {
        for (const el of document.querySelectorAll(sel)) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || +cs.opacity === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0) boxes.push({ id: el.id || el.dataset.id, l: r.left, t: r.top, r: r.right, b: r.bottom });
        }
      }
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if ((a.id === 'objective' && b.id === 'toast') || (a.id === 'toast' && b.id === 'objective')) continue; // one line by design, the toast covers the objective for a moment
          if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlaps.push([a.id, b.id]);
        }
      }
      const outside = boxes.filter((x) => x.l < -0.5 || x.t < -0.5 || x.r > innerWidth + 0.5 || x.b > innerHeight + 0.5).map((x) => x.id);
      let smallest = 99;
      for (const el of document.querySelectorAll('#hud, #hud-top *, #hud-bottom *, #osm')) {
        const cs = getComputedStyle(el);
        if (cs.display !== 'none' && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) smallest = Math.min(smallest, parseFloat(cs.fontSize));
      }
      const res = { boxes: boxes.length, overlaps, outside, smallest };
      for (const id of ['health', 'level', 'stars']) g.hud.remove(id);
      g.hud.setObjective(null);
      $('hint').classList.remove('show');
      $('say').classList.remove('show');
      $('toast').classList.remove('show');
      return res;
    });
  };
  for (const [w, h] of [[1280, 720], [800, 600], [390, 844], [844, 390]]) {
    r = await layout(w, h);
    check(`hud at ${w}x${h}: ${r.boxes} boxes, none overlap or leave the window, text 13 px or more`, r.boxes >= 9 && r.overlaps.length === 0 && r.outside.length === 0 && r.smallest >= 13, r);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // The start overlay: city name, places from the city config, Cambia mappa.
  r = await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    $('overlay').classList.remove('hidden');
    const vis = (id) => { const b = $(id).getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    let smallest = 99;
    for (const el of document.querySelectorAll('#overlay *')) if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) smallest = Math.min(smallest, parseFloat(getComputedStyle(el).fontSize));
    return { sub: $('overlay-sub').textContent, spots: $('keys-spots').textContent, map: vis('overlay-map'), cta: vis('overlay-cta'), smallest, title: document.title };
  });
  check('start overlay names the city, lists its places, offers Cambia mappa, text 13 px or more', r.sub.startsWith('București') && r.spots.includes('Piața Unirii') && r.map && r.cta && r.smallest >= 13 && r.title === 'Web Swing · București', r);

  // Save in the real localStorage, across a reload.
  await page.evaluate(() => window.__game.save.set('core-test', { n: 5, tags: ['a'] }));
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  r = await page.evaluate(() => {
    const g = window.__game;
    const raw = JSON.parse(localStorage.getItem('webswing.v1'));
    const res = { back: g.save.get('core-test'), raw: raw['core-test'], city: raw.city, fallback: g.save.get('never-set', 42) };
    g.save.set('core-test', undefined);
    res.gone = !('core-test' in JSON.parse(localStorage.getItem('webswing.v1')));
    return res;
  });
  check('save: a value set in one page load is there after a reload, under "webswing.v1"', r.back?.n === 5 && r.back.tags[0] === 'a' && r.raw?.n === 5 && r.city === 'bucharest' && r.fallback === 42 && r.gone, r);

  // Pause: Cambia mappa leads back to the selection.
  r = await page.evaluate(() => {
    document.dispatchEvent(new Event('pointerlockchange'));
    const b = document.getElementById('overlay-map').getBoundingClientRect();
    return { title: document.getElementById('overlay-title').textContent, mapButton: b.width > 0, overlayShown: !document.getElementById('overlay').classList.contains('hidden') };
  });
  check('pause screen shows PAUSA and the Cambia mappa button', r.title === 'PAUSA' && r.mapButton && r.overlayShown, r);
  await Promise.all([page.waitForURL((u) => !u.search.includes('city=')), page.click('#overlay-map')]);
  await page.waitForSelector('#mapcards .card');
  r = await page.evaluate(() => ({ url: location.search, selectVisible: !document.getElementById('mapselect').classList.contains('hidden'), game: typeof window.__game, cards: document.querySelectorAll('.card').length }));
  check('Cambia mappa goes back to the selection and keeps the other flags', r.selectVisible && r.game === 'undefined' && r.cards === 2 && r.url.includes('lowq') && r.url.includes('seed=7') && !r.url.includes('city='), r);
  await page.close();

  // ---------- map selection screen ----------
  const sel = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const selErrors = [];
  sel.on('console', (m) => ['error', 'warning'].includes(m.type()) && selErrors.push(m.text()));
  sel.on('pageerror', (e) => selErrors.push(e.message));
  await sel.goto(`${URL0}?lowq`);
  await sel.waitForSelector('#mapcards .card');
  await sel.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const selInfo = () =>
    sel.evaluate(() => ({
      visible: !document.getElementById('mapselect').classList.contains('hidden'),
      loadingHidden: document.getElementById('loading').classList.contains('hidden'),
      game: typeof window.__game,
      cards: [...document.querySelectorAll('.card')].map((c) => ({ id: c.dataset.city, name: c.querySelector('.card-name').textContent, href: c.getAttribute('href'), pic: c.querySelector('img').naturalWidth, badge: !!c.querySelector('.card-last') })),
    }));
  r = await selInfo();
  check('a plain start lists București and Brașov with a picture each, before anything is loaded', r.visible && r.loadingHidden && r.game === 'undefined' && r.cards.map((c) => c.name).join() === 'București,Brașov' && r.cards.every((c) => c.pic > 0) && r.cards[0].href === '?lowq=&city=bucharest' && r.cards[1].href === '?lowq=&city=brasov' && !r.cards.some((c) => c.badge), r);
  const fit = async (w, h) => {
    await sel.setViewportSize({ width: w, height: h });
    return sel.evaluate(() => {
      const rects = [...document.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
      let smallest = 99;
      for (const el of document.querySelectorAll('#mapselect *')) if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) smallest = Math.min(smallest, parseFloat(getComputedStyle(el).fontSize));
      const a = rects[0], b = rects[1];
      return { noSideScroll: document.documentElement.scrollWidth <= innerWidth, inside: rects.every((x) => x.left >= 0 && x.right <= innerWidth), apart: a.right <= b.left + 0.5 || a.bottom <= b.top + 0.5, fitsHeight: document.getElementById('mapselect').scrollHeight <= innerHeight + 1, smallest };
    });
  };
  for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
    r = await fit(w, h);
    check(`selection at ${w}x${h}: cards inside the window, apart, no scroll, text 13 px or more`, r.noSideScroll && r.inside && r.apart && r.fitsHeight && r.smallest >= 13, r);
  }
  await sel.setViewportSize({ width: 1280, height: 720 });
  // The click saves the choice; the navigation is held back here so the check can read it.
  await sel.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault(), true);
    document.querySelector('.card[data-city="brasov"]').click();
  });
  r = await sel.evaluate(() => JSON.parse(localStorage.getItem('webswing.v1')).city);
  check('choosing a card saves the city', r === 'brasov', r);
  await sel.reload();
  await sel.waitForSelector('#mapcards .card');
  r = await selInfo();
  check('the last chosen city is marked on the selection', r.cards.find((c) => c.id === 'brasov').badge && !r.cards.find((c) => c.id === 'bucharest').badge, r.cards);
  await Promise.all([sel.waitForURL(/city=bucharest/), sel.click('.card[data-city="bucharest"]')]);
  await sel.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  r = await sel.evaluate(() => ({ city: window.__game.cityId, select: document.getElementById('mapselect').classList.contains('hidden'), saved: JSON.parse(localStorage.getItem('webswing.v1')).city, title: document.title }));
  check('clicking the București card loads București', r.city === 'bucharest' && r.select && r.saved === 'bucharest', r);
  await sel.close();

  // ?shot and ?demo links skip the selection too; ?city=center still opens the small build.
  const shot = await browser.newPage({ viewport: { width: 640, height: 360 } });
  shot.on('pageerror', (e) => errors.push('shot page: ' + e.message));
  await shot.goto(`${URL0}?shot=perch&lowq`);
  await shot.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  r = await shot.evaluate(() => ({ city: window.__game.cityId, select: document.getElementById('mapselect').classList.contains('hidden') }));
  check('?shot=perch without a city opens București, no selection', r.city === 'bucharest' && r.select, r);
  await shot.close();
  const centre = await open(browser, 'city=center&lowq', errors, 640, 360);
  r = await centre.evaluate(() => ({ city: window.__game.city.cityId, state: window.__game.state().city, title: document.title, chunks: window.__game.city.recs.size }));
  check('?city=center keeps working (small Bucharest build)', r.city === 'center' && r.state === 'center' && r.title.includes('centro'), r);
  await centre.close();

  // ---------- a city that cannot load ----------
  const bad = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const badErrors = [];
  bad.on('console', (m) => m.type() === 'error' && badErrors.push(m.text()));
  await bad.goto(`${URL0}?city=nowhere`);
  await bad.waitForSelector('#loading a.btn');
  r = await bad.evaluate(() => ({ text: document.getElementById('loading-text').textContent, href: document.querySelector('#loading a.btn').getAttribute('href'), link: document.querySelector('#loading a.btn').textContent }));
  check('an unknown city says so and offers Cambia mappa', /sconosciuta/.test(r.text) && r.link === 'Cambia mappa' && !r.href.includes('city='), r);
  await bad.route('**/city/bucharest/index.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await bad.goto(`${URL0}?city=bucharest`);
  await bad.waitForSelector('#loading a.btn');
  r = await bad.evaluate(() => ({ text: document.getElementById('loading-text').textContent }));
  check('a city whose data is missing says so instead of hanging', /non disponibile/.test(r.text) && /București/.test(r.text), r);
  await Promise.all([bad.waitForURL((u) => !u.search.includes('city=')), bad.click('#loading a.btn')]);
  await bad.waitForSelector('#mapcards .card');
  await bad.close();

  // ---------- events from the game itself ----------
  const street = await open(browser, 'shot=street&lowq', errors, 640, 360);
  r = await street.evaluate(() => {
    const g = window.__game;
    const got = [];
    g.events.on('car:stolen', (e) => got.push(e));
    for (let i = 0; i < 8; i++) g.advance(1, 1 / 30);
    const before = got.length;
    const c = g.traffic.nearest(g.player.pos, 400);
    g.player.pos.set(c.x + Math.cos(c.yaw) * 2, 0, c.z - Math.sin(c.yaw) * 2);
    g.setInput({ carPressed: true });
    g.simulate(1 / 30, 1 / 30);
    g.setInput(null);
    return { before, after: got.length, sameCar: got[0]?.car === g.driving() && !!g.driving() };
  });
  check('stealing a car emits car:stolen with the car, and not before', r.before === 0 && r.after === 1 && r.sameCar, r);
  await street.close();
} finally {
  await browser.close();
  srv.kill();
}
check('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
