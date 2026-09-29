// Checks for the light and the look: the day and night cycle, the three styles, the lamps and the water.
// Usage: node build.mjs, then PORT=5228 node test/light.mjs. Exit code 1 on any failure.
// Every check has a positive case (the thing happens) and a negative one (it does not when it must not).
import { startServer, launch, open } from './harness.mjs';
import { sunAt, moonAt, nightAmount, parseHours, wrapHours } from '../src/sun.js';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- the sun model, straight in Node ----------
{
  const noon = sunAt(12.5, 44.43, {}), morning = sunAt(8, 44.43, {}), evening = sunAt(17.5, 44.43, {}), midnight = sunAt(0, 44.43, {});
  check('sun: high at noon, in the east in the morning, in the west in the evening, under the horizon at midnight',
    noon.elev > 35 && morning.x > 0.5 && evening.x < -0.5 && midnight.elev < -30, { noon: noon.elev, morning: morning.x, evening: evening.x, midnight: midnight.elev });
  check('sun: 17:30 is golden hour (a low sun, 5 to 12 degrees)', evening.elev > 5 && evening.elev < 12, evening.elev);
  check('sun: the moon is up in the middle of the night and down at noon', moonAt(0, 44.43, {}).elev > 30 && moonAt(12.5, 44.43, {}).elev < 0, [moonAt(0, 44.43, {}).elev, moonAt(12.5, 44.43, {}).elev]);
  check('night amount: 0 by day, 1 in the dark, in between at dusk', nightAmount(43) === 0 && nightAmount(-36) === 1 && nightAmount(-1) > 0.2 && nightAmount(-1) < 0.9, [nightAmount(43), nightAmount(-36), nightAmount(-1)]);
  check('clock: 17:30, 17.5 and 41.5 are the same hour; nonsense is ignored', parseHours('17:30') === 17.5 && parseHours('17.5') === 17.5 && wrapHours(41.5) === 17.5 && parseHours('abc') === null && parseHours(null) === null, {});
}

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  // ---------- the clock and the sun in the game ----------
  {
    const page = await open(browser, 'shot=perch&time=12', errors, 640, 360);
    let r = await page.evaluate(async () => {
      const g = window.__game;
      await g.env.ready;
      const dir = () => g.gfx.csm.lightDirection.toArray().map((v) => Math.round(v * 100) / 100);
      const light = () => g.gfx.csm.lights[0];
      g.env.setTime(12);
      g.advance(0.2);
      const noon = { night: g.env.night, dir: dir(), intensity: light().intensity, skySun: g.env.sky.material.uniforms.uSun.value.y };
      g.env.setTime(9);
      const nine = dir();
      g.env.setTime(16);
      const four = dir();
      g.env.setTime(22);
      g.advance(0.2);
      const night = { night: g.env.night, dir: dir(), intensity: light().intensity, blue: light().color.b > light().color.r, skySun: g.env.sky.material.uniforms.uSun.value.y, fogDark: g.scene.fog.color.r + g.scene.fog.color.g + g.scene.fog.color.b };
      return { noon, nine, four, night };
    });
    check('setTime: noon is day (uNight 0), the sun is high and strong, and the sky dome agrees', r.noon.night === 0 && r.noon.dir[1] < -0.6 && r.noon.intensity > 2 && r.noon.skySun > 0.6, r.noon);
    check('setTime: the sun crosses the sky (light travels west in the morning, east in the afternoon)', r.nine[0] < -0.3 && r.four[0] > 0.3, [r.nine, r.four]);
    check('setTime: 22:00 is night (uNight 1), the light is the dim blue moon and the fog is dark', r.night.night === 1 && r.night.intensity < 1.5 && r.night.blue && r.night.skySun < 0 && r.night.fogDark < 0.1, r.night);

    // Dusk and dawn: uNight passes through the middle, monotonically.
    r = await page.evaluate(() => {
      const g = window.__game;
      const seq = [];
      for (const h of [15, 17, 18, 18.4, 18.8, 19.3, 20]) (g.env.setTime(h), seq.push(Math.round(g.env.night * 100) / 100));
      return seq;
    });
    check('setTime: uNight rises through dusk and never goes back down', r.every((v, i) => i === 0 || v >= r[i - 1]) && r[0] === 0 && r.at(-1) === 1 && r.some((v) => v > 0.05 && v < 0.95), r);

    // Physical: the environment map, the specular repair and the Poly Haven skies.
    r = await page.evaluate(async () => {
      const g = window.__game;
      await g.env.ready;
      g.env.setTime(12);
      const dayInt = g.scene.environmentIntensity;
      g.env.setTime(23);
      return { repaired: g.env.specularRepaired, hdris: Object.keys(g.env.maps.hdris), keys: g.env.maps.targets.length, dayInt, nightInt: g.scene.environmentIntensity, hasEnv: !!g.scene.environment };
    });
    check('the specular light works again under CSM, the four Poly Haven skies loaded, six environment maps baked', r.repaired === true && r.hdris.length === 4 && r.keys === 6 && r.hasEnv, r);
    check('the ambient light follows the hour (dimmer at night than at noon)', r.nightInt < r.dayInt, [r.dayInt, r.nightInt]);
    await page.close();
  }

  // ---------- ?time fixes the hour, ?cycle=off stops the cycle, the cycle runs otherwise ----------
  {
    const fixed = await open(browser, 'shot=perch&time=21:15', errors, 480, 270);
    const a = await fixed.evaluate(() => {
      const g = window.__game;
      const before = g.env.hours;
      g.simulate(60, 1 / 30);
      return { before, after: g.env.hours, running: g.env.running };
    });
    check('?time=21:15 fixes the hour: it is 21.25 and stays there', a.before === 21.25 && a.after === 21.25 && a.running === false, a);
    await fixed.close();

    const off = await open(browser, 'shot=perch&cycle=off', errors, 480, 270);
    const b = await off.evaluate(() => {
      const g = window.__game;
      const before = g.env.hours;
      g.simulate(90, 1 / 30);
      return { before, after: g.env.hours };
    });
    check('?cycle=off: the hour stays at the start (17.5) after 90 s of play', b.before === 17.5 && b.after === 17.5, b);
    await off.close();

    const on = await open(browser, 'shot=perch', errors, 480, 270);
    const c = await on.evaluate(() => {
      const g = window.__game;
      const before = g.env.hours;
      g.simulate(60, 1 / 30);
      return { before, after: g.env.hours };
    });
    check('the cycle runs by default: a day lasts 24 real minutes, so 60 s move the clock by an hour', near(c.before, 17.5, 0.01) && near(c.after - c.before, 1, 0.01), c);

    const onTime = await open(browser, 'shot=perch&time=9&cycle=on', errors, 480, 270);
    const d = await onTime.evaluate(() => {
      const g = window.__game;
      g.simulate(30, 1 / 30);
      return g.env.hours;
    });
    check('?time=9&cycle=on starts at 9 and then runs', near(d, 9.5, 0.03), d);
    await onTime.close();

    // The voice: a line at dusk and at dawn when the clock gets there, none when the clock is set by hand.
    const said = await on.evaluate(() => {
      const g = window.__game;
      const calls = [];
      g.voice.say = (k) => calls.push(k); // the real one would speak
      g.env.setTime(15);
      g.env.setTime(23);
      g.env.setTime(12);
      const jumped = calls.slice();
      g.env.setTime(18.2);
      g.simulate(50, 1 / 30);
      const dusk = calls.slice();
      g.env.setTime(5.8);
      g.simulate(90, 1 / 30);
      return { jumped, dusk, all: calls };
    });
    check('voice: night is announced at dusk and morning at dawn, once each, and not when the clock is set by hand', said.jumped.length === 0 && said.dusk.join() === 'night' && said.all.join() === 'night,morning', said);
    await on.close();
  }

  // ---------- each style renders, and they look different ----------
  {
    const shots = {};
    for (const id of ['a', 'b', 'c']) {
      const before = errors.length;
      const page = await open(browser, `shot=perch&time=17:30&style=${id}`, errors, 640, 360);
      shots[id] = await page.evaluate(() => {
        const g = window.__game;
        g.advance(1);
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const x = c.getContext('2d');
        x.drawImage(g.renderer.domElement, 0, 0, 64, 36);
        const d = x.getImageData(0, 0, 64, 36).data;
        const n = 64 * 36;
        const mean = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += d[i + k] / n;
        let v = 0;
        const colors = new Set();
        for (let i = 0; i < d.length; i += 4) {
          for (let k = 0; k < 3; k++) v += (d[i + k] - mean[k]) ** 2 / (n * 3);
          colors.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
        }
        return { style: g.env.style, mean: mean.map((m) => Math.round(m)), std: Math.round(Math.sqrt(v)), colors: colors.size };
      });
      shots[id].newErrors = errors.slice(before);
      await page.close();
    }
    for (const id of ['a', 'b', 'c']) {
      const s = shots[id];
      check(`style ${id.toUpperCase()}: renders a real picture without console errors`, s.style === id && s.std > 25 && s.colors > 40 && s.newErrors.length === 0, s);
    }
    const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]));
    check('the three styles do not look alike (pairwise colour distance)', dist(shots.a.mean, shots.b.mean) > 6 && dist(shots.b.mean, shots.c.mean) > 6 && dist(shots.a.mean, shots.c.mean) > 6,
      { ab: dist(shots.a.mean, shots.b.mean), bc: dist(shots.b.mean, shots.c.mean), ac: dist(shots.a.mean, shots.c.mean) });
  }

  // ---------- the style is saved and restored ----------
  {
    const page = await open(browser, 'shot=perch&time=12', errors, 480, 270);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('webswing.v1') || '{}').style);
    let r = await page.evaluate(() => window.__game.env.style);
    check('the default style is A', r === 'a', r);
    await page.keyboard.press('KeyB');
    r = { now: await page.evaluate(() => window.__game.env.style), saved: await stored() };
    check('key B goes to the next style and saves it', r.now === 'b' && r.saved === 'b', r);
    await page.evaluate(() => window.__game.env.setStyle('c'));
    check('setStyle saves the choice', (await stored()) === 'c', await stored());
    await page.reload();
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
    r = await page.evaluate(() => window.__game.env.style);
    check('after a reload the saved style is back', r === 'c', r);
    await page.goto(page.url().replace(/&?style=[^&]*/, '') + '&style=b');
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
    r = { now: await page.evaluate(() => window.__game.env.style), saved: await stored() };
    check('?style=b beats what was saved, and becomes the saved choice', r.now === 'b' && r.saved === 'b', r);
    await page.goto(page.url().replace(/&?style=[^&]*/, '') + '&style=zzz');
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
    r = { now: await page.evaluate(() => window.__game.env.style), saved: await stored() };
    check('an unknown ?style is ignored: the saved one stays', r.now === 'b' && r.saved === 'b', r);
    r = await page.evaluate(() => {
      const g = window.__game;
      g.env.setStyle('nope');
      return g.env.style;
    });
    check('setStyle with an unknown id changes nothing', r === 'b', r);
    // The pause menu has the three buttons and they switch the look.
    r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#style-pick button')];
      btns[0].click();
      return { count: btns.length, now: window.__game.env.style, pressed: btns.map((b) => b.getAttribute('aria-pressed')).join() };
    });
    check('the pause menu shows A, B and C and the buttons switch the style', r.count === 3 && r.now === 'a' && r.pressed === 'true,false,false', r);
    await page.close();
  }

  // ---------- switching does not leak, and it is cheap ----------
  {
    const page = await open(browser, 'shot=perch&time=17:30', errors, 1280, 720);
    const mem = () =>
      page.evaluate(() => {
        const g = window.__game;
        g.advance(0.1);
        const i = g.renderer.info;
        return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length, passes: g.gfx.composer.passes.length };
      });
    // Let the streaming of the city settle first, so only the style switches can move the counters.
    await page.evaluate(async () => {
      const g = window.__game;
      await g.env.ready;
      let last = -1, same = 0;
      for (let i = 0; i < 60 && same < 3; i++) {
        g.advance(1, 1 / 20);
        await new Promise((r) => setTimeout(r, 250));
        const n = g.renderer.info.memory.geometries + g.state().loaded * 1000;
        same = n === last ? same + 1 : 0;
        last = n;
      }
    });
    const before = await mem();
    for (let i = 0; i < 10; i++) await page.evaluate((id) => window.__game.env.setStyle(id), ['b', 'c', 'a'][i % 3]);
    const after = await mem();
    check('10 style switches leak nothing (geometries, textures, programs and passes unchanged)', before.geometries === after.geometries && before.textures === after.textures && before.programs === after.programs && before.passes === after.passes, { before, after });

    // Cost. CPU: the env system per tick. GPU: timer queries around whole frames, in turn for the picture without
    // the grade pass, then A, B and C, interleaved so that the other work on a shared GPU hits all of them alike.
    const cost = await page.evaluate(async () => {
      const g = window.__game;
      const env = g.systems.get('env');
      const gl = g.renderer.getContext();
      const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const out = { cpu: {}, gpu: null };
      for (const id of ['a', 'b', 'c']) {
        g.env.setStyle(id);
        g.env.setTime(19.5);
        for (let i = 0; i < 30; i++) env.update(1 / 60);
        const t0 = performance.now();
        for (let i = 0; i < 2000; i++) env.update(1 / 60);
        out.cpu[id] = Math.round(((performance.now() - t0) / 2000) * 1000) / 1000;
      }
      if (!timer) return out;
      const pass = g.gfx.composer.passes.find((p) => p.effects?.some((e) => e.name === 'GradeEffect'));
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // 12 frames inside one timer query, so that a hiccup from other GPU work is spread thin.
      const batch = async () => {
        const q = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
        for (let i = 0; i < 12; i++) g.advance(0);
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        for (let i = 0; i < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) await sleep(2);
        const bad = gl.getParameter(timer.GPU_DISJOINT_EXT);
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 12;
        gl.deleteQuery(q);
        return bad ? NaN : ms;
      };
      const modes = { off: () => (pass.enabled = false), a: () => ((pass.enabled = true), g.env.setStyle('a')), b: () => ((pass.enabled = true), g.env.setStyle('b')), c: () => ((pass.enabled = true), g.env.setStyle('c')) };
      // Rounds of off, A, B, C, off: a style is measured against the mean of the two "off" batches around it.
      const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      const diffs = { a: [], b: [], c: [] };
      const offs = [];
      g.env.setTime(17.5);
      for (const k of Object.keys(modes)) (modes[k](), await batch());
      for (let round = 0; round < 8; round++) {
        const r = {};
        for (const k of ['off', 'a', 'b', 'c', 'off2']) {
          modes[k === 'off2' ? 'off' : k]();
          await batch();
          r[k] = await batch();
        }
        const base = (r.off + r.off2) / 2;
        offs.push(base);
        for (const id of ['a', 'b', 'c']) if (!Number.isNaN(r[id] - base)) diffs[id].push(r[id] - base);
      }
      out.spread = Math.round(((Math.max(...offs) - Math.min(...offs)) / med(offs)) * 100) / 100;
      out.gpu = { off: Math.round(med(offs) * 100) / 100 };
      for (const id of ['a', 'b', 'c']) out.gpu[id] = Math.round(med(diffs[id]) * 100) / 100;
      pass.enabled = true;
      return out;
    });
    const extra = cost.gpu;
    console.log('COST  ms per tick of the env system:', JSON.stringify(cost.cpu), ' GPU ms per frame without the grade pass, and the extra ms of each style over it (median of 8 rounds, 1280x720, GPU shared with other work):', JSON.stringify(cost.gpu));
    check('the env system costs under 0.5 ms per tick in every style', ['a', 'b', 'c'].every((id) => cost.cpu[id] < 0.5), cost.cpu);
    // With other work on the GPU the frame time swings by more than the cost we measure: then the number is only printed.
    const steady = cost.gpu && cost.spread < 0.15;
    if (cost.gpu && !steady) console.log(`NOTE  the GPU is too busy for a reliable measure (the "off" batches differ by ${Math.round(cost.spread * 100)}%): the ceiling is not checked`);
    check('the whole look (haze, tone map, bloom, toon, outlines) costs under 3 ms of GPU per frame in every style', !steady || ['a', 'b', 'c'].every((id) => extra[id] < 3), { ...extra, steady });
    await page.close();
  }

  // ---------- lamps and water ----------
  {
    const page = await open(browser, 'shot=perch&time=12', errors, 640, 360);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      await g.env.ready;
      const out = {};
      g.env.setTime(12);
      g.advance(0.6);
      out.dayLit = g.env.lamps.lit;
      g.env.setTime(22);
      g.advance(0.6);
      out.nightFound = g.env.lamps.found;
      out.nightLit = g.env.lamps.lit;
      const wu = g.city.mats.water.userData.light;
      out.water = [];
      for (const id of ['a', 'b', 'c']) (g.env.setStyle(id), out.water.push(wu.uWaterStyle.value));
      return out;
    });
    check('street lamps: none lit at noon, a handful lit at 22:00 around the camera', r.dayLit === 0 && r.nightFound >= 3 && r.nightLit === r.nightFound, r);
    check('the water material carries the look of each style (realistic, stylised, cartoon)', r.water.join() === '0,1,2', r.water);
    await page.close();
  }

  // ---------- Brasov: its own air, and the same tools ----------
  {
    const page = await open(browser, 'city=brasov&shot=perch&time=17:30', errors, 480, 270);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.advance(0.5);
      return { far: g.scene.fog.far, hours: g.env.hours, style: g.env.style };
    });
    check('Brasov loads with the light system and clearer air than Bucharest (fog reaches farther)', r.far > 9000 && r.hours === 17.5, r);
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
check('no console errors or page errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
