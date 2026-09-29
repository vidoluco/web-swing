// The three supreme bars (Anagram, Hop Hooligans, Ironic Taproom): the data the builder wrote, the rule that an
// unconfirmed place cannot get in, the golden mug and its circle, 100% drunk on entering, the minimap star and
// the Alt + digit keys. Usage: node build.mjs, then PORT=5223 node test/bars.mjs   Exit code 1 on any failure.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startServer, launch, open } from './harness.mjs';
import { LINES } from '../src/lines.js';
import { projection } from '../tools/city-config.mjs';

mkdirSync('shots', { recursive: true });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// ---------- the data: what the builder wrote for Bucharest ----------
const extra = JSON.parse(readFileSync('tools/extra-pois.json', 'utf8')).bucharest;
const index = JSON.parse(readFileSync('public/city/bucharest/index.json', 'utf8'));
const { toXZ } = projection(index.origin);
const at = (p) => toXZ(p.lon, p.lat);
const chunks = readdirSync('public/city/bucharest').filter((f) => /^-?\d+_-?\d+\.json$/.test(f));
const places = chunks.flatMap((f) => JSON.parse(readFileSync(`public/city/bucharest/${f}`, 'utf8')).p.map(([x, z, kind, name]) => ({ x, z, kind, name, chunk: f })));
const supreme = places.filter((p) => p.kind === 2);
{
  const names = extra.places.map((p) => p.name).sort();
  check('the city data has exactly the confirmed supreme places, no more and no fewer', JSON.stringify(supreme.map((p) => p.name).sort()) === JSON.stringify(names) && names.length === 3, { data: supreme.map((p) => p.name), confirmed: names });
  const off = extra.places.map((p) => {
    const [x, z] = at(p), s = supreme.find((q) => q.name === p.name);
    return s ? Math.round(Math.hypot(s.x - x, s.z - z) * 10) / 10 : null;
  });
  check('each one sits where its address projects to (lat/lon to x,z as the builder does), within 0.2 m', off.every((d) => d !== null && d < 0.2), { off });
  const hosts = (p) => new Set(p.sources.map((s) => new URL(s.url).hostname.replace(/^www\./, '')));
  check('each one names sources on at least two different sites', extra.places.every((p) => hosts(p).size >= 2), extra.places.map((p) => `${p.name}: ${[...hosts(p)].join(', ')}`));
  const ironic = places.filter((p) => /Ironic/.test(p.name));
  check('Ironic Taproom is there once, as a supreme place (the OSM bar was replaced, not duplicated)', ironic.length === 1 && ironic[0].kind === 2 && ironic[0].chunk === '-2_-2.json' && ironic[0].x === -590.5 && ironic[0].z === -795.4, ironic);
  // A road within a few tens of metres in the same chunk data: the street exists.
  const nearRoad = extra.places.map((p) => {
    const [x, z] = at(p), cx = Math.floor(x / 400), cz = Math.floor(z / 400);
    let best = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      let c;
      try { c = JSON.parse(readFileSync(`public/city/bucharest/${i}_${j}.json`, 'utf8')); } catch { continue; }
      for (const r of c.r) {
        if (r.cls === 'river') continue;
        for (let k = 2; k + 1 < r.pts.length; k += 2) {
          const ax = r.pts[k - 2], az = r.pts[k - 1], bx = r.pts[k], bz = r.pts[k + 1], L = (bx - ax) ** 2 + (bz - az) ** 2;
          const t = L ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L)) : 0;
          best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
        }
      }
    }
    return Math.round(best);
  });
  check('each one has a street in the chunk data within 60 m', nearRoad.every((d) => d <= 60), { metres: nearRoad });
  // The candidate left out: one source only.
  const out = extra.rejected.map((r) => {
    const [x, z] = at(r);
    return { name: r.name, near: places.filter((p) => Math.hypot(p.x - x, p.z - z) < 150 && (p.kind === 2 || /anagram/i.test(p.name))).map((p) => p.name) };
  });
  check('NEGATIVE: the bar whose address was not confirmed (Anagram Downtown Taproom) is absent from the data', extra.rejected.length >= 1 && out.every((o) => o.near.length === 0) && !places.some((p) => /downtown/i.test(p.name)), out);
}

// ---------- the builder refuses an unconfirmed place ----------
{
  const dir = mkdtempSync(`${tmpdir()}/bars-`);
  const input = `${dir}/in.geojsonseq`;
  writeFileSync(input, [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[26.099, 44.43], [26.101, 44.43]] }, properties: { '@type': 'way', '@id': 1, highway: 'residential', name: 'Strada Test' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [26.1005, 44.4302] }, properties: { '@type': 'node', '@id': 2, amenity: 'bar', name: 'Bar Test' } },
  ].map((f) => JSON.stringify(f)).join('\n') + '\n');
  const run = (place) => {
    rmSync(`${dir}/public`, { recursive: true, force: true });
    writeFileSync(`${dir}/extra.json`, JSON.stringify({ probe: { places: [place] } }));
    const r = spawnSync(process.execPath, [new URL('../tools/osm-build.mjs', import.meta.url).pathname, 'probe', input], { cwd: dir, encoding: 'utf8', env: { ...process.env, ORIGIN: '44.43,26.10', BBOX: '44.42,26.09,44.44,26.11', EXTRA_POIS: `${dir}/extra.json` } });
    let p = [];
    try { p = JSON.parse(readFileSync(`${dir}/public/city/probe/0_-1.json`, 'utf8')).p; } catch { /* no output */ }
    return { code: r.status, err: (r.stderr.match(/Error: .*/) || [''])[0], places: p };
  };
  const good = { name: 'Bar Test', kind: 2, lat: 44.4302, lon: 26.1005, street: 'Strada Test', sources: [{ url: 'https://one.example/a' }, { url: 'https://two.example/b' }] };
  let r = run(good);
  check('POSITIVE: a place with two sources and a real street is built, and it replaces the OSM bar of the same name', r.code === 0 && r.places.length === 1 && r.places[0][2] === 2 && r.places[0][3] === 'Bar Test', r);
  r = run({ ...good, sources: [{ url: 'https://one.example/a' }, { url: 'https://one.example/b' }] });
  check('NEGATIVE: two sources on the same site do not count, the build stops', r.code !== 0 && /two different sites/.test(r.err) && r.places.length === 0, r);
  r = run({ ...good, sources: [{ url: 'https://one.example/a' }] });
  check('NEGATIVE: one source is not enough, the build stops', r.code !== 0 && /two different sites/.test(r.err), r);
  r = run({ ...good, street: 'Strada Inventata' });
  check('NEGATIVE: a street that is not in the OSM input stops the build', r.code !== 0 && /is not in the input/.test(r.err), r);
  r = run({ ...good, lat: 44.4302, lon: 26.1005, street: 'Strada Test', name: 'Bar Far', kind: 2, ...{ lat: 44.4338 } });
  check('NEGATIVE: a place far from any street stops the build', r.code !== 0 && /no street within 60 m/.test(r.err), r);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- in the game ----------
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'lowq&seed=9', errors);
  await page.evaluate(() => {
    const g = window.__game;
    const T = (window.__t = {});
    // Stream the surroundings of a place, stand at (x + dx, z + dz) on the ground and let the scan run.
    T.stage = async (x, z, dx, dz, look) => {
      await g.city.streamAround(x, z, 500);
      g.player.reset();
      g.player.pos.set(x + dx, 0, z + dz);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
      if (look !== undefined) g.look(look, -0.12);
      g.advance(1);
    };
    T.bar = (name) => [...g.drinks.sup.values()].find((s) => s.poi.name.includes(name));
    // A point d metres from the door on the street side (the way the place was pushed out of its building),
    // so the player is not standing inside a wall and pushed back to the door.
    T.away = (s, d) => {
      const n = Math.hypot(s.poi.nx, s.poi.nz) || 1, ux = s.poi.nx || s.poi.nz ? s.poi.nx / n : 1, uz = s.poi.nx || s.poi.nz ? s.poi.nz / n : 0;
      return [s.poi.x + ux * d, s.poi.z + uz * d];
    };
    T.said = () => g.voice.log.map((l) => l.kind);
  });

  const KEYS = { Anagram: 'anagram', 'Hop Hooligans': 'hop', 'Ironic Taproom': 'ironic' };
  // Where each bar is, from the extra-pois file projected the way the builder does.
  const where = Object.fromEntries(extra.places.map((p) => [p.name, at(p).map((v) => Math.round(v * 10) / 10)]));

  for (const [name, key] of Object.entries(KEYS)) {
    const [bx, bz] = where[name];
    await page.evaluate(([x, z]) => window.__t.stage(x, z, 40, 0), [bx, bz]);
    const s = await page.evaluate(([name, key]) => {
      const g = window.__game, b = window.__t.bar(name);
      return b ? { x: b.poi.x, z: b.poi.z, visible: b.obj.visible, level: g.drunk.level, said: window.__t.said().filter((k) => k === 'supreme.' + key) } : null;
    }, [name, key]);
    check(`${name}: the golden mug and its sign are there, and she is sober before entering`, !!s && s.visible && s.level === 0 && s.said.length === 0, s);
    if (!s) continue;
    // Outside the circle, five metres from the door: nothing happens.
    let r = await page.evaluate(([name, key]) => {
      const g = window.__game, T = window.__t, b = T.bar(name);
      const [x, z] = T.away(b, 5);
      g.player.pos.set(x, 0, z);
      g.advance(1);
      return { level: g.drunk.level, said: T.said().filter((k) => k === 'supreme.' + key), metres: Math.round(Math.hypot(g.player.pos.x - b.poi.x, g.player.pos.z - b.poi.z) * 10) / 10, before: g.drunk.supremes };
    }, [name, key]);
    const before = r.before;
    check(`NEGATIVE: ${name}: five metres from the door, outside the circle, nothing happens`, r.level === 0 && r.said.length === 0 && r.metres > 4, r);
    // Walk in.
    r = await page.evaluate(([name, key]) => {
      const g = window.__game, b = window.__t.bar(name);
      g.player.pos.set(b.poi.x + 1, 0, b.poi.z);
      g.advance(0.4);
      const line = g.voice.log.filter((l) => l.kind === 'supreme.' + key);
      return {
        level: g.drunk.level, amount: g.drunk.amount, supremes: g.drunk.supremes, line: line.length,
        subtitle: document.querySelector('#say b')?.textContent, shown: document.getElementById('say').classList.contains('show'),
        toast: document.getElementById('toast').textContent, hud: document.getElementById('hud').textContent,
      };
    }, [name, key]);
    const ro = LINES['supreme.' + key].map((l) => l[0]);
    check(`${name}: walking into the circle takes her to 100% at once, with the line of this bar`, r.level > 7.9 && r.amount === 1 && r.supremes === before + 1 && r.line === 1 && r.shown && ro.includes(r.subtitle) && r.toast.includes(name) && /🍺|🥃|●/.test(r.hud), r);
    // It wears off with time, as usual.
    r = await page.evaluate(() => {
      const g = window.__game, out = [g.drunk.level];
      for (let i = 0; i < 3; i++) {
        g.simulate(10, 1 / 30);
        out.push(g.drunk.level);
      }
      return out;
    });
    check(`${name}: drunkenness then goes down with time`, r[0] > 7.9 && r[1] < r[0] && r[2] < r[1] && r[3] < r[2] && Math.abs(r[3] - (r[0] - 30 / 35)) < 0.05, r);
    await page.evaluate(() => (window.__game.drunk.level = 0));
  }

  // The rules of the circle, on Ironic Taproom.
  {
    const [bx, bz] = where['Ironic Taproom'];
    await page.evaluate(([x, z]) => window.__t.stage(x, z, 40, 0), [bx, bz]);
    const b = await page.evaluate(() => {
      const g = window.__game, T = window.__t, s = T.bar('Ironic');
      const [ax, az] = T.away(s, 9);
      g.player.pos.set(ax, 0, az);
      g.simulate(50, 1 / 20); // past the 45 s of the last time in here
      g.drunk.level = 0;
      return { x: s.poi.x, z: s.poi.z, ax, az, before: g.drunk.supremes };
    });
    let r = await page.evaluate(([x, z, ax, az, before]) => {
      const g = window.__game, out = {};
      g.player.pos.set(x, 0, z);
      g.advance(0.4);
      out.first = Math.round(g.drunk.level);
      g.drunk.level = 3;
      g.advance(5);
      out.staying = Math.round(g.drunk.level * 10) / 10;
      g.player.pos.set(ax, 0, az);
      g.advance(1);
      g.player.pos.set(x, 0, z);
      g.advance(0.4);
      out.soonAgain = Math.round(g.drunk.level * 10) / 10;
      g.player.pos.set(ax, 0, az);
      g.simulate(50, 1 / 20);
      g.drunk.level = 0;
      g.player.pos.set(x, 0, z);
      g.advance(0.4);
      out.later = Math.round(g.drunk.level);
      out.added = g.drunk.supremes - before;
      return out;
    }, [b.x, b.z, b.ax, b.az, b.before]);
    check('NEGATIVE: standing in the circle does not keep filling her up, and coming back within 45 s does nothing', r.first === 8 && r.staying < 3 && r.soonAgain < 3, r);
    check('POSITIVE: after leaving and a while, walking in again does it again', r.later === 8 && r.added === 2, r);

    // Not in the air, not in a car: the circle is for walking in.
    r = await page.evaluate(([x, z]) => {
      const g = window.__game;
      g.player.pos.set(x + 9, 0, z);
      g.simulate(50, 1 / 20);
      g.drunk.level = 0;
      g.player.pos.set(x, 9, z);
      g.player.mode = 'air';
      g.player.vel.set(0, 0, 0);
      g.advance(0.1);
      return { high: g.drunk.level };
    }, [b.x, b.z]);
    check('NEGATIVE: passing high over the door does not count', r.high === 0, r);
  }

  // A normal bar gives a beer or a țuică, not 100%.
  {
    const found = await page.evaluate(async () => {
      const g = window.__game;
      await g.city.streamAround(-590, -795, 500);
      const bars = [...g.city.recs.values()].flatMap((r) => r.pois || []).filter((p) => p.kind === 0 && Math.hypot(p.x + 590, p.z + 795) < 400).sort((a, b) => Math.hypot(a.x + 590, a.z + 795) - Math.hypot(b.x + 590, b.z + 795));
      return bars.slice(0, 1).map((p) => ({ x: p.x, z: p.z, name: p.name }))[0] || null;
    });
    check('there is an ordinary bar near Ironic to walk past', !!found, found);
    const r = await page.evaluate(async ([x, z]) => {
      const g = window.__game, T = window.__t;
      g.drunk.level = 0;
      const before = g.drunk.supremes;
      await T.stage(x, z, 25, 0);
      // Walk along its front, then into a drink.
      g.player.pos.set(x + 6, 0, z);
      g.advance(1);
      const passing = g.drunk.level;
      const drink = g.drinks.list.find((it) => it.obj.visible);
      g.player.pos.set(drink.x, 0, drink.z);
      g.advance(0.4);
      return { passing, level: g.drunk.level, amount: g.drunk.amount, supremesAdded: g.drunk.supremes - before, said: T.said().slice(-2), drank: !!drink };
    }, [found.x, found.z]);
    check('NEGATIVE: walking past an ordinary bar does not give 100%, one drink gives a beer or a țuică', r.drank && r.passing === 0 && r.level > 0 && r.level <= 2.01 && r.amount < 0.5 && r.supremesAdded === 0 && !r.said.some((k) => k.startsWith('supreme')), r);
  }

  // The minimap: a pink star for the supreme places, amber dots for the others.
  {
    const [bx, bz] = where['Ironic Taproom'];
    await page.evaluate(([x, z]) => window.__t.stage(x, z, 22, 0, 0.3), [bx, bz]);
    const r = await page.evaluate(() => {
      const g = window.__game, m = g.minimap, s = window.__t.bar('Ironic');
      g.advance(0.3);
      const W = m.c.width, H = m.c.height, sc = m.scale * (W / 200), yaw = g.rig.yaw;
      const px = (x, z) => {
        const a = (x - g.player.pos.x) * sc, b = (z - g.player.pos.z) * sc;
        return [Math.round(W / 2 + Math.cos(yaw) * a - Math.sin(yaw) * b), Math.round(H / 2 + Math.sin(yaw) * a + Math.cos(yaw) * b)];
      };
      const ctx = m.c.getContext('2d');
      const read = ([x, y]) => {
        const d = ctx.getImageData(x - 1, y - 1, 3, 3).data;
        return [d[16], d[17], d[18]];
      };
      const star = px(s.poi.x, s.poi.z);
      return { star, pixel: read(star), inside: star[0] > 0 && star[0] < W && star[1] > 0 && star[1] < H };
    });
    const [pr, pg, pb] = r.pixel;
    check('the supreme bar is a pink star on the minimap', r.inside && pr > 220 && pg < 110 && pb > 150, r);
  }

  // Alt + digit reaches the places after the tenth; a plain digit still reaches the first ten.
  {
    // Keys go down, the game ticks once while they are held, then they go up.
    const press = async (mods, code) => {
      for (const m of mods) await page.keyboard.down(m);
      await page.keyboard.press(code);
      await page.evaluate(() => window.__game.advance(0.1));
      for (const m of mods.reverse()) await page.keyboard.up(m);
    };
    const arrive = async (target, max = 520) => {
      await page.waitForFunction(([tx, tz, max]) => {
        const p = window.__game.player.pos;
        return Math.hypot(p.x - tx, p.z - tz) < max;
      }, [target[0], target[1], max], { timeout: 60000 }).catch(() => {});
      return page.evaluate(([tx, tz]) => {
        const p = window.__game.player.pos;
        return Math.round(Math.hypot(p.x - tx, p.z - tz));
      }, target);
    };
    const go = async (mods, code, target) => {
      await page.evaluate(() => {
        window.__game.player.reset();
        window.__game.player.pos.set(3000, 0, 3000);
        window.__game.player.groundBox = null;
      });
      await press(mods, code);
      return arrive(target);
    };
    const expect = [['Digit1', ['Alt'], where['Anagram'], 'Alt + 1 is Anagram'], ['Digit2', ['Alt'], where['Hop Hooligans'], 'Alt + 2 is Hop Hooligans'], ['Digit3', ['Alt'], where['Ironic Taproom'], 'Alt + 3 is Ironic Taproom']];
    for (const [code, mods, target, label] of expect) {
      const d = await go([...mods], code, target);
      check(`${label}`, d < 520, { metres: d });
    }
    const d1 = await go([], 'Digit1', [0, 0]);
    check('a plain 1 still goes to Piața Unirii', d1 < 520, { metres: d1 });
    await page.evaluate(() => {
      window.__game.player.reset();
      window.__game.player.pos.set(3000, 0, 3000);
      window.__game.player.groundBox = null;
    });
    await press(['Alt'], 'Digit9');
    const still = await page.evaluate(() => {
      const g = window.__game;
      g.advance(0.3);
      return [Math.round(g.player.pos.x), Math.round(g.player.pos.z)];
    });
    check('NEGATIVE: Alt + 9 has no place behind it and does nothing', still[0] === 3000 && still[1] === 3000, still);
  }

  // Pictures: the bar from the street, and standing in the circle (double vision, the line, the toast).
  {
    await page.evaluate(() => document.getElementById('overlay').classList.add('hidden'));
    const [bx, bz] = where['Ironic Taproom'];
    await page.evaluate(([x, z]) => window.__t.stage(x, z, 40, 0), [bx, bz]);
    await page.evaluate(() => {
      const g = window.__game, T = window.__t, s = T.bar('Ironic');
      g.drunk.level = 0;
      const [x, z] = T.away(s, 14);
      g.player.pos.set(x, 0, z);
      g.player.vel.set(0, 0, 0);
      g.look(Math.atan2(x - s.poi.x, z - s.poi.z), -0.1);
      g.advance(3); // the toast of the last trip fades
    });
    await page.screenshot({ path: 'shots/bars-ironic.png' });
    await page.evaluate(() => {
      const g = window.__game, s = window.__t.bar('Ironic');
      g.simulate(50, 1 / 20);
      g.player.pos.set(s.poi.x, 0, s.poi.z);
      g.advance(1.2);
    });
    await page.screenshot({ path: 'shots/bars-ironic-inside.png' });
    console.log('INFO  screenshots: shots/bars-ironic.png, shots/bars-ironic-inside.png');
  }

  check('no console errors or page errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
