// Screenshots of the mission, race and collectible visuals and of the HUD at 1280x720, 800x600 and
// 390x844, into shots/. Nothing is asserted: look at the images.
// Usage: PORT=5225 node test/missionshots.mjs
import { mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

mkdirSync('shots', { recursive: true });
const srv = await startServer();
const browser = await launch();
const errors = [];

const prepare = (g) => {
  g.advance(0.05);
  window.__t = {
    at: async (x, z, y = 0) => {
      await g.city.streamAround(x, z, 450);
      g.player.reset();
      g.player.pos.set(x, y, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
      g.player.mode = y > 0 ? 'air' : 'ground';
    },
    tick: (s, st = 1 / 30) => g.advance(s, st),
  };
};

// Opens the game with a saved state already in place (the missions done so far).
async function fresh(w, h, saved) {
  const page = await open(browser, 'shot=street&lowq&seed=7', errors, w, h);
  await page.evaluate((s) => localStorage.setItem('webswing.v1', JSON.stringify(s)), saved);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready && window.__game.challenges?.jars.total > 0 && window.__game.pets?.items.length > 0, null, { timeout: 180000 });
  return page;
}

try {
  for (const [w, h] of [[1280, 720], [800, 600], [390, 844], [844, 390]]) {
    const page = await fresh(w, h, { missions: { bucharest: ['pensia'] } });
    await page.evaluate(async () => {
      const g = window.__game;
      const T = window.__t = {};
      g.advance(0.05);
      T.at = async (x, z, y = 0) => {
        await g.city.streamAround(x, z, 450);
        g.player.reset();
        g.player.pos.set(x, y, z);
        g.player.groundBox = null;
        g.player.vel.set(0, 0, 0);
        g.player.mode = y > 0 ? 'air' : 'ground';
      };
      // Everything on at once: the worst case for the layout.
      g.health = { hp: 62, max: 100, heal() {} };
      g.wanted = { stars: 3, add() {}, clear() {} };
      g.respect.add(320, 'shot');
      // Mission 2 with its clock.
      const d = g.missions.defs[1];
      await T.at(d.start.x, d.start.z);
      g.advance(0.3);
      g.missions.active || g.missions.start('obor');
      for (const t of ['beer', 'wine', 'tuica', 'cola', 'water', 'juice']) g.pets.take(g.pets.items.find((p) => p.type === t).id);
      g.challenges.jars.take(g.challenges.jars.items[3].id);
      g.buffs.add('turbo');
      g.buffs.add('shield');
      g.buffs.add('fire');
      g.advance(4);
    });
    await page.screenshot({ path: `shots/hud-${w}x${h}.png` });
    await page.close();
  }

  const page = await fresh(1280, 720, { missions: { bucharest: ['pensia', 'obor', 'nepotul', 'aparatul'] } });
  await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.05);
    window.__t = {
      at: async (x, z, y = 0) => {
        await g.city.streamAround(x, z, 450);
        g.player.reset();
        g.player.pos.set(x, y, z);
        g.player.groundBox = null;
        g.player.vel.set(0, 0, 0);
        g.player.mode = y > 0 ? 'air' : 'ground';
      },
    };
  });
  const shot = async (name, fn) => {
    await page.evaluate(fn);
    await page.screenshot({ path: `shots/${name}.png` });
    console.log(name);
  };
  // The start marker of the next mission, Manele at Drumul Taberei, from 22 m away.
  await shot('m-start', async () => {
    const g = window.__game, d = g.missions.defs[4];
    await window.__t.at(d.start.x, d.start.z + 22);
    g.look(0, 0.05);
    g.rig.dist = 6.5;
    g.advance(0.6);
  });
  // The speaker mission at Drumul Taberei running, seen from the wall.
  await shot('m-speaker', async () => {
    const g = window.__game;
    g.missions.start('manele');
    const t = g.missions.defs[4].steps[0].targets[0];
    await window.__t.at(t.x + t.nx * 5, t.z + t.nz * 5);
    g.look(Math.atan2(t.nx, t.nz), 0);
    for (let i = 0; i < 60; i++) {
      g.setInput({ moveY: 1 });
      g.advance(1 / 30, 1 / 30);
      if (g.player.pos.y > 9) break;
    }
    g.setInput({});
    g.rig.dist = 5;
    g.rig.pitch = 0.1;
    g.advance(0.3);
  });
  await page.evaluate(() => window.__game.missions.abort());
  // A race gate and the start of a race.
  await shot('race-start', async () => {
    const g = window.__game, r = g.challenges.races[0];
    await window.__t.at(r.points[0].x, r.points[0].z + 30);
    g.look(0, 0.05);
    g.rig.dist = 6.5;
    g.advance(0.6);
  });
  await shot('race-gate', async () => {
    const g = window.__game, r = g.challenges.races[0];
    await window.__t.at(r.points[0].x, r.points[0].z);
    g.advance(0.3);
    g.player.pos.set(r.points[0].x - 200, 22, r.points[0].z - 4);
    g.player.mode = 'air';
    g.look(Math.PI / 2, 0.02);
    g.advance(0.4);
  });
  await page.evaluate(() => window.__game.challenges.abort());
  // A jar on a roof, from the neighbouring air.
  await shot('jar-roof', async () => {
    const g = window.__game;
    const big = g.challenges.jars.items.filter((k) => k.on === 'roof' && k.y > 20 && k.y < 45);
    const j = big[1];
    await window.__t.at(j.x + 7, j.z, j.y + 0.2);
    g.look(Math.PI / 2, 0.08);
    g.rig.dist = 5;
    g.advance(0.5);
  });
  // The pause screen with the campaign list.
  await shot('pause', async () => {
    const g = window.__game;
    g.save.set('missions', { bucharest: ['pensia', 'obor'] });
    document.getElementById('overlay').classList.remove('hidden');
    document.getElementById('overlay-title').innerHTML = 'PAUSA';
  });
  await page.close();

  console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no errors');
} finally {
  await browser.close();
  srv.kill();
}
