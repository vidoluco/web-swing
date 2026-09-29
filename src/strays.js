import * as THREE from 'three';

// Stray dogs (maidanezi) in packs of two to four near parks and housing blocks, in both cities, and
// bears in Brasov that come down to the bins of Schei and Racadau. Dogs chase Bunica barking and
// scatter when a thrown papuc lands near them; a bear is scared by the papuc, but a bear that was hit
// or startled is angry and chases her. The bodies are game.actors dogs and bears; this system only
// decides where they go. It calls game.health.damage if combat provides it and stays silent otherwise.

const PACKS = 2; // packs alive around her (one on low quality)
const SPAWN = [110, 300]; // a new pack appears this far from her
const GONE = 360; // and is let go beyond this
const SEE = 20; // dogs notice her inside this and chase
const LOSE = 55;
const TAU = Math.PI * 2;

// Where bears come down from the wood (game x, z of the street ends, docs/brasov-landmarks.md).
const BEARS = {
  brasov: [
    { name: 'Schei, Strada Cibinului', x: -401, z: 157 },
    { name: 'Bastionul, Strada Plaieșilor', x: -23, z: 703 },
    { name: 'Bastionul, Strada Petofi Sandor', x: 33, z: 702 },
    { name: 'Racadau, Strada Alunis', x: 1268, z: 1275 },
    { name: 'Racadau, Strada Fragilor', x: 1372, z: 1188 },
  ],
};

export function create(game) {
  const packs = [];
  const bears = [];
  const stats = { packs: 0, chases: 0, scatters: 0, bites: 0, barks: 0, bearsSpawned: 0, bearsScared: 0, bearsAngry: 0, swipes: 0 };
  let A = null;
  let rng = Math.random;
  let off = [];
  let packT = 0;
  let bearT = 0;
  let bearCool = 0;
  let voiceT = -99;
  let nextId = 1;
  let zones = [];
  const v = new THREE.Vector3();

  const alive = (a) => !a.removed && a.state !== 'down';
  const ground = (x, z) => game.city.groundAt?.(x, z) ?? 0;

  function say(kind, gap) {
    if (game.time - voiceT < gap) return;
    voiceT = game.time;
    game.voice?.say?.(kind);
  }

  // Someone in view is not allowed to see a pack or a bear pop up.
  function inView(x, z) {
    v.set(x, ground(x, z) + 1, z).project(game.camera);
    return Math.abs(v.x) < 1.25 && Math.abs(v.y) < 1.25 && v.z < 1;
  }

  // ---------- dogs ----------

  // A pack at a pavement spot near (x, z).
  function spawnPack(x, z, n = 2 + ((rng() * 3) | 0)) {
    const home = A.randomWalkPoint({ x, z }, 30);
    if (A.blocked(home.x, home.z, 0.5)) return null;
    const dogs = [];
    for (let i = 0; i < n; i++) {
      const a = A.spawn('dog', { x: home.x + (rng() - 0.5) * 5, z: home.z + (rng() - 0.5) * 5 });
      if (a) dogs.push(a);
    }
    if (dogs.length < 2) {
      dogs.forEach((a) => a.remove());
      return null;
    }
    const k = { id: nextId++, dogs, home: { x: home.x, z: home.z }, mode: 'roam', t: 0, until: 1 + rng() * 4, cool: 0, bite: 0, lost: 0, fol: 0, bark: new Map() };
    packs.push(k);
    stats.packs++;
    return k;
  }

  // Parks and panel blocks are where they live: a green area or a block of flats 110 to 300 m away.
  function packSpot(px, pz) {
    const pick = rng();
    let best = null;
    if (pick < 0.5) {
      const cells = [];
      for (let cx = Math.floor((px - 300) / 200); cx <= Math.floor((px + 300) / 200); cx++) {
        for (let cz = Math.floor((pz - 300) / 200); cz <= Math.floor((pz + 300) / 200); cz++) {
          const c = game.city.mmCells.get(cx * 1000 + cz);
          if (c) for (const ring of c.g) cells.push(ring);
        }
      }
      if (cells.length) {
        const ring = cells[(rng() * cells.length) | 0], n = ring.length / 2, i = ((rng() * n) | 0) * 2;
        best = { x: ring[i], z: ring[i + 1] };
      }
    }
    if (!best) {
      const blocks = game.city.nearby(px, pz, 300, []).filter((b) => b.style === 4 && b.kind !== 'prop' && b.y0 < 1);
      if (blocks.length) {
        const b = blocks[(rng() * blocks.length) | 0];
        best = { x: (b.minx + b.maxx) / 2, z: (b.minz + b.maxz) / 2 };
      }
    }
    if (!best) {
      const a = rng() * TAU, d = SPAWN[0] + rng() * (SPAWN[1] - SPAWN[0]);
      best = { x: px + Math.sin(a) * d, z: pz + Math.cos(a) * d };
    }
    return best;
  }

  function trySpawnPack(px, pz, anywhere) {
    for (let tries = 0; tries < 10; tries++) {
      const s = packSpot(px, pz);
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d < SPAWN[0] || d > SPAWN[1]) continue;
      if (packs.some((k) => Math.hypot(k.home.x - s.x, k.home.z - s.z) < 120)) continue;
      if (!anywhere && d < 240 && inView(s.x, s.z)) continue;
      if (spawnPack(s.x, s.z)) return;
    }
  }

  function updatePack(k, dt) {
    if (k.dogs.some((a) => !alive(a))) k.dogs = k.dogs.filter(alive);
    if (!k.dogs.length) return false;
    const pl = game.player, lead = k.dogs[0];
    const dx = pl.pos.x - lead.pos.x, dz = pl.pos.z - lead.pos.z, d = Math.hypot(dx, dz);
    k.t += dt;
    k.cool -= dt;
    k.bite -= dt;
    // She is up on a roof or high in a swing: they bark from below.
    const low = pl.pos.y - ground(pl.pos.x, pl.pos.z) < 9 && pl.mode !== 'drive';
    if (k.mode === 'roam') {
      if (k.cool <= 0 && d < SEE && low) {
        startChase(k);
        return true;
      }
      if (!lead.hasGoal && k.t >= k.until) {
        const p = A.randomWalkPoint(k.home, 30);
        A.walkTo(lead, p.x, p.z, lead.speedWalk * 0.9);
        k.t = 0;
        k.until = 5 + rng() * 9;
        k.home.x += (p.x - k.home.x) * 0.5;
        k.home.z += (p.z - k.home.z) * 0.5;
      }
      // The others tag along behind the leader.
      if ((k.fol -= dt) <= 0) {
        k.fol = 0.7;
        k.dogs.forEach((a, i) => {
          if (i === 0) return;
          const ang = i * 2.3;
          A.walkTo(a, lead.pos.x + Math.sin(ang) * 2.4, lead.pos.z + Math.cos(ang) * 2.4, lead.state === 'idle' ? a.speedWalk * 0.8 : a.speedWalk * 1.15);
        });
      }
    } else if (k.mode === 'chase') {
      k.dogs.forEach((a, i) => {
        const ang = (i / k.dogs.length) * TAU;
        A.walkTo(a, pl.pos.x + Math.sin(ang) * 1.1, pl.pos.z + Math.cos(ang) * 1.1, a.speedRun * (0.9 + 0.1 * (i % 2)));
        const dd = Math.hypot(pl.pos.x - a.pos.x, pl.pos.z - a.pos.z);
        if (dd < 1.5 && pl.pos.y - ground(pl.pos.x, pl.pos.z) < 2.4 && k.bite <= 0) {
          k.bite = 1.3;
          stats.bites++;
          game.health?.damage?.(3, 'dog');
        }
        const bt = (k.bark.get(a) ?? rng()) - dt;
        k.bark.set(a, bt);
        if (bt <= 0) {
          k.bark.set(a, 0.7 + rng() * 1.1);
          stats.barks++;
          game.events.emit('dog:bark', { x: a.pos.x, y: a.pos.y + 0.6, z: a.pos.z, dog: a });
        }
      });
      k.lost = low ? 0 : k.lost + dt;
      if (d > LOSE || k.lost > 3 || k.t > 25) {
        k.mode = 'roam';
        k.t = 0;
        k.until = 3;
        k.cool = 10;
        k.home.x = lead.pos.x;
        k.home.z = lead.pos.z;
        k.dogs.forEach((a) => (a.hasGoal = false));
      }
    } else if (k.mode === 'scatter' && k.t >= k.until) {
      k.mode = 'roam';
      k.t = 0;
      k.until = 2;
      k.cool = 12;
      k.home.x = lead.pos.x;
      k.home.z = lead.pos.z;
    }
    return true;
  }

  function startChase(k) {
    k.mode = 'chase';
    k.t = 0;
    k.lost = 0;
    k.bite = 0.8;
    stats.chases++;
    say('dog', 30);
  }

  // A thrown papuc landed here, or a fight broke out: every pack within 14 m runs off in different directions.
  function scatter(k, x, z) {
    if (k.mode === 'scatter') return;
    k.mode = 'scatter';
    k.t = 0;
    k.until = 5 + rng() * 2;
    stats.scatters++;
    k.dogs.forEach((a, i) => {
      const away = Math.atan2(a.pos.x - x, a.pos.z - z) + (i - (k.dogs.length - 1) / 2) * 0.7;
      const s = A.randomWalkPoint({ x: a.pos.x + Math.sin(away) * 40, z: a.pos.z + Math.cos(away) * 40 }, 15);
      A.walkTo(a, s.x, s.z, a.speedRun);
      game.events.emit('dog:bark', { x: a.pos.x, y: a.pos.y + 0.6, z: a.pos.z, dog: a, yelp: true });
    });
    say('dog', 12);
  }

  // ---------- bears ----------

  function binsOf(z) {
    if (!z.bins || z.bins.length < 2) {
      z.bins = [];
      for (let i = 0; i < 4; i++) {
        const p = A.randomWalkPoint(z, 45);
        if (!A.blocked(p.x, p.z, 0.8)) z.bins.push(p);
      }
    }
    return z.bins;
  }

  function spawnBear(z, at) {
    const bins = binsOf(z);
    if (!bins.length) return null;
    const a = A.spawn('bear', at || { x: z.x, z: z.z });
    if (!a) return null;
    const b = { a, zone: z, mode: 'come', t: 0, until: 0, bin: bins[(rng() * bins.length) | 0], startle: 0, swipe: 0, roar: 0, lost: 0, seen: false };
    bears.push(b);
    stats.bearsSpawned++;
    A.walkTo(a, b.bin.x, b.bin.z, a.speedWalk);
    return b;
  }

  function trySpawnBear(px, pz, anywhere) {
    let z = null, zd = 650;
    for (const q of zones) {
      const d = Math.hypot(q.x - px, q.z - pz);
      if (d < zd && d > 90) (zd = d), (z = q);
    }
    if (!z || (!anywhere && zd < 260 && inView(z.x, z.z))) return;
    spawnBear(z);
  }

  function angry(b) {
    if (!alive(b.a) || b.mode === 'angry') return;
    b.mode = 'angry';
    b.t = 0;
    b.lost = 0;
    stats.bearsAngry++;
    game.events.emit('bear:roar', { x: b.a.pos.x, y: b.a.pos.y + 1.2, z: b.a.pos.z, bear: b.a });
    say('bear', 8);
  }

  function scare(b, x, z) {
    if (!alive(b.a) || b.mode === 'angry' || b.mode === 'scared' || b.mode === 'leave') return;
    b.mode = 'scared';
    b.t = 0;
    stats.bearsScared++;
    const away = Math.atan2(b.a.pos.x - x, b.a.pos.z - z);
    const s = A.randomWalkPoint({ x: b.a.pos.x + Math.sin(away) * 45, z: b.a.pos.z + Math.cos(away) * 45 }, 15);
    A.walkTo(b.a, s.x, s.z, b.a.speedRun * 0.85);
    say('bear', 8);
  }

  function updateBear(b, dt) {
    const a = b.a, pl = game.player;
    if (a.removed) return false;
    if (a.state === 'down') return true;
    const d = Math.hypot(pl.pos.x - a.pos.x, pl.pos.z - a.pos.z);
    if (d > 500) {
      a.remove();
      return false;
    }
    b.t += dt;
    b.swipe -= dt;
    const low = pl.pos.y - ground(pl.pos.x, pl.pos.z) < 12;
    if (!b.seen && d < 45) {
      b.seen = true;
      say('bear', 40);
    }
    switch (b.mode) {
      case 'come':
        if (!a.hasGoal) {
          b.mode = 'eat';
          b.t = 0;
          b.until = 8 + rng() * 8;
        }
        break;
      case 'eat':
        // Startled by someone who walks right up to it.
        b.startle = d < 5 && low ? b.startle + dt : Math.max(0, b.startle - dt);
        if (b.startle > 1.5) angry(b);
        else if (b.t > b.until) {
          const bins = binsOf(b.zone);
          b.bin = bins[(rng() * bins.length) | 0];
          b.mode = 'come';
          b.t = 0;
          A.walkTo(a, b.bin.x, b.bin.z, a.speedWalk);
        }
        break;
      case 'scared':
        if (b.t > 8 || !a.hasGoal) {
          b.mode = 'leave';
          b.t = 0;
        }
        break;
      case 'angry': {
        A.walkTo(a, pl.pos.x, pl.pos.z, a.speedRun);
        if (d < 2 && pl.pos.y - ground(pl.pos.x, pl.pos.z) < 2.6 && b.swipe <= 0) {
          b.swipe = 1.8;
          stats.swipes++;
          game.health?.damage?.(12, 'bear');
        }
        b.lost = low ? 0 : b.lost + dt;
        if (d > 70 || b.lost > 3 || b.t > 30) {
          b.mode = 'leave';
          b.t = 0;
        }
        break;
      }
      case 'leave':
        A.walkTo(a, b.zone.x, b.zone.z, a.speedWalk * 2);
        if (Math.hypot(b.zone.x - a.pos.x, b.zone.z - a.pos.z) < 4 || b.t > 40) {
          a.remove();
          bearCool = 30;
          return false;
        }
        break;
    }
    return true;
  }

  // ---------- system ----------

  function impact(x, z, target) {
    for (const k of packs) {
      if (k.dogs.some((a) => (a.pos.x - x) ** 2 + (a.pos.z - z) ** 2 < 14 * 14)) scatter(k, x, z);
    }
    for (const b of bears) {
      if (!alive(b.a)) continue;
      if (target && target === b.a) angry(b);
      else if ((b.a.pos.x - x) ** 2 + (b.a.pos.z - z) ** 2 < 16 * 16) scare(b, x, z);
    }
  }

  function init() {
    A = game.actors;
    rng = game.rng || Math.random;
    if (!A) return;
    off.push(
      game.events.on('hit', ({ target }) => target?.pos && impact(target.pos.x, target.pos.z, target)),
      // Optional: combat may announce where a thrown papuc came down, as { x, z } or { pos: { x, z } }.
      game.events.on('papuc:land', (e) => {
        const p = e?.pos || e;
        if (p) impact(p.x, p.z, null);
      }),
    );
  }

  function onCityChange(id) {
    zones = (BEARS[id] || []).map((z) => ({ ...z, bins: null }));
    for (const k of packs) k.dogs.forEach((a) => a.remove());
    packs.length = 0;
    for (const b of bears) b.a.remove();
    bears.length = 0;
    packT = 0;
    bearT = 0;
  }

  function update(dt) {
    if (!A) return;
    const pl = game.player, px = pl.pos.x, pz = pl.pos.z;
    const wantPacks = game.params.has('lowq') ? 1 : PACKS;
    if (packs.length < wantPacks && (packT -= dt) <= 0) {
      packT = 1;
      trySpawnPack(px, pz, game.time < 2);
    }
    for (let i = packs.length - 1; i >= 0; i--) {
      const k = packs[i];
      const lead = k.dogs[0];
      if (lead && Math.hypot(lead.pos.x - px, lead.pos.z - pz) > GONE) {
        k.dogs.forEach((a) => a.remove());
        packs.splice(i, 1);
        continue;
      }
      if (!updatePack(k, dt)) packs.splice(i, 1);
    }
    if (zones.length) {
      if (!bears.length && (bearCool -= dt) <= 0 && (bearT -= dt) <= 0) {
        bearT = 2;
        trySpawnBear(px, pz, game.time < 2);
      }
      for (let i = bears.length - 1; i >= 0; i--) if (!updateBear(bears[i], dt)) bears.splice(i, 1);
    }
  }

  function dispose() {
    for (const f of off) f();
    off = [];
    onCityChange(null);
  }

  return { name: 'strays', init, onCityChange, update, dispose, packs, bears, stats, spawnPack, spawnBear, scatter, scare, angry, impact, zones: () => zones };
}
