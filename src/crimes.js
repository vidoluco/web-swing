import * as THREE from 'three';
import { roadsAround, planRoute, RoadDriver, payRespect } from './crimelib.js';

// Random crimes: every 45 to 90 seconds one shows up 300 to 600 m from Bunica, red on the minimap,
// until it is solved, lost or 3 minutes old. The scene (actors, car) is only built once she comes
// within LIVE_D, when the actor manager keeps its people moving.
//   scippo: a thug runs off with a lady's bag; tie or down him, then take the bag back to her.
//   rapina: 3 to 5 thugs threaten a clerk at a real kiosk, non-stop or bar; all of them down or tied.
//   fuga: thugs in a stolen car flee along the roads; hit the driver, tie him from the roof, or ram
//   the car with one Bunica has stolen.
// Crime actors carry `actor.crime = { id, role }` ('thief', 'victim', 'robber', 'clerk', 'driver',
// 'passenger') so other systems can tell them apart from ordinary thugs.

const KINDS = ['scippo', 'rapina', 'fuga'];
const LABEL = { scippo: 'Scippo', rapina: 'Rapina', fuga: 'Fuga' };
const NEWS = { scippo: 'Scippo in corso!', rapina: 'Rapina in corso!', fuga: 'Fuga in auto!' };
const REWARD = { scippo: 15, rapina: 30, fuga: 40 };
const BAG_BONUS = 10;
const MIN_D = 300, MAX_D = 600;
const TTL = 180; // seconds a crime lasts
const LIVE_D = 130; // the scene is built when Bunica is this close
const LOST_D = 450; // a thief or a car this far from her got away
const MAX_ACTIVE = 3;
const FIRST_IN = 30;
const CARS = ['sedan', 'sedan-sports', 'suv'];
const SEAT_DROP = 0.55; // seated thugs are set this far down into the car body

const neutral = (a) => a.tied || a.state === 'down';

export function create(game) {
  const crimes = [];
  const epilogues = []; // what goes on after a crime is solved: the bag to return, a car braking
  let nextId = 1;
  let timer = FIRST_IN;
  let markT = 0;
  let lastDrive = 0; // speed of the car Bunica drives, before the collisions of this tick

  const rng = () => game.rng();
  const P = () => game.player.pos;
  const say = (kind) => game.voice?.say?.(kind, game.drunk?.amount ?? 0);
  const ground = (x, z) => game.city.groundAt?.(x, z) ?? 0;

  // ---------- where crimes happen ----------

  // A point on a random loaded road between minD and maxD from Bunica, with the road's direction.
  function roadSpot(minD, maxD, accept) {
    const p = P(), segs = [];
    for (const r of roadsAround(game.city, p.x, p.z, maxD + 60)) {
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const d0 = Math.hypot(r.pts[i] - p.x, r.pts[i + 1] - p.z), d1 = Math.hypot(r.pts[i + 2] - p.x, r.pts[i + 3] - p.z);
        if (Math.min(d0, d1) <= maxD && Math.max(d0, d1) >= minD && Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]) >= 6) segs.push([r, i]);
      }
    }
    for (let n = 0; n < 60 && segs.length; n++) {
      const [r, i] = segs[(rng() * segs.length) | 0], t = rng();
      const ax = r.pts[i], az = r.pts[i + 1], ex = r.pts[i + 2] - ax, ez = r.pts[i + 3] - az, L = Math.hypot(ex, ez);
      const x = ax + ex * t, z = az + ez * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < minD || d > maxD || game.city.isWater(x, z) || (accept && !accept(r, x, z))) continue;
      const s = r.oneway || rng() < 0.5 ? 1 : -1;
      return { x, z, dx: (ex / L) * s, dz: (ez / L) * s, road: r };
    }
    return null;
  }

  function scippoSpot(minD, maxD) {
    const p = P(), A = game.actors;
    for (let n = 0; n < 30; n++) {
      const s = roadSpot(minD, maxD, (r) => r.w < 22);
      if (!s) return null;
      // The pavement beside the street, never the carriageway or a building.
      const q = A.randomWalkPoint(s, 12);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= minD && d <= maxD && !A.blocked(q.x, q.z, 0.8)) return { x: q.x, z: q.z, dx: s.dx, dz: s.dz };
    }
    return null;
  }

  function rapinaSpot(minD, maxD) {
    const p = P(), A = game.actors, all = [];
    for (const rec of game.city.recs.values()) {
      if (rec.state !== 'loaded' || !rec.pois) continue;
      for (const poi of rec.pois) {
        const d = Math.hypot(poi.x - p.x, poi.z - p.z);
        if (d >= minD && d <= maxD && !game.city.isWater(poi.x, poi.z) && !A.blocked(poi.x, poi.z, 0.5)) all.push(poi);
      }
    }
    const shops = all.filter((q) => q.kind === 1), list = shops.length ? shops : all;
    if (!list.length) return null;
    const poi = list[(rng() * list.length) | 0];
    return { x: poi.x, z: poi.z, dx: poi.nx, dz: poi.nz, name: poi.name };
  }

  function fugaSpot(minD, maxD) {
    const s = roadSpot(minD, maxD, (r, x, z) => r.w >= 6 && !game.traffic.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12));
    return s && { x: s.x, z: s.z, dx: s.dx, dz: s.dz };
  }

  const SPOT = { scippo: scippoSpot, rapina: rapinaSpot, fuga: fugaSpot };

  // ---------- starting and ending ----------

  // Starts a crime of `kind` (any if omitted). opts.range = [min, max] metres from Bunica replaces
  // 300 to 600 (for tests and tools). Returns the crime or null when no place fits.
  function spawn(kind, opts = {}) {
    if (!game.actors) return null;
    const [minD, maxD] = opts.range || [MIN_D, MAX_D];
    const order = kind ? [kind] : [...KINDS].sort(() => rng() - 0.5);
    for (const k of order) {
      const spot = SPOT[k](minD, maxD);
      if (!spot) continue;
      const c = { id: nextId++, kind: k, x: spot.x, z: spot.z, dx: spot.dx, dz: spot.dz, name: spot.name, ttl: TTL, age: 0, live: false, tries: 0, actors: [], done: false };
      crimes.push(c);
      game.events.emit('crime:start', { id: c.id, kind: k, pos: { x: c.x, z: c.z } });
      say('crimeStart');
      game.hud?.toast(c.name && k === 'rapina' ? `Rapina: ${c.name}` : NEWS[k], 2.4);
      markers();
      return c;
    }
    return null;
  }

  function markers() {
    game.minimap.setMarkers('crimes', crimes.map((c) => ({ x: c.x, z: c.z, color: '#ff2b2b', shape: 'ring', label: LABEL[c.kind] })));
  }

  // The crime is over. `result` is 'solved', 'failed' or 'expired'.
  function end(c, result, how) {
    if (c.done) return;
    c.done = true;
    crimes.splice(crimes.indexOf(c), 1);
    const car = c.car && game.traffic.cars.includes(c.car) ? c.car : null;
    if (c.kind === 'fuga' && result !== 'solved' && car) epilogues.push(driveOff(c));
    for (const a of c.actors) {
      if (a.removed || c.keep?.includes(a)) continue;
      a.persist = false;
      const role = a.crime.role;
      if (role === 'driver' || role === 'passenger') {
        if (!car) a.remove();
      } else if (neutral(a)) continue;
      else if (role === 'victim' || role === 'clerk') {
        a.stunT = 0;
        a.fall = 0;
      } else runOff(a);
    }
    game.events.emit('crime:end', { id: c.id, kind: c.kind, result, how });
    markers();
  }

  // Pays once: a crime that is done can not be solved again.
  function solve(c, how) {
    if (c.done) return false;
    game.events.emit('crime:solved', { id: c.id, kind: c.kind, how, reward: REWARD[c.kind] });
    payRespect(game, REWARD[c.kind], `crime:${c.kind}`);
    say('crimeDone');
    game.hud?.toast(`Crimine fermato! +${REWARD[c.kind]} Respect`, 2.4);
    if (c.kind === 'scippo') epilogues.push(bagTask(c));
    if (c.kind === 'fuga') epilogues.push(carTask(c));
    end(c, 'solved', how);
    return true;
  }

  function runOff(a) {
    const A = game.actors, p = P();
    let best = null, bd = -1;
    for (let i = 0; i < 4; i++) {
      const q = A.randomWalkPoint(a.pos, 140), d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > bd) (bd = d), (best = q);
    }
    A.walkTo(a, best.x, best.z, a.speedRun);
  }

  function person(c, kind, at, role, opts) {
    const a = game.actors.spawn(kind, at, { persist: true, ...opts });
    if (a) {
      a.crime = { id: c.id, role };
      c.actors.push(a);
    }
    return a;
  }

  // ---------- building the scene ----------

  // Returns false when there was no room yet (the actor cap); the actors made so far are dropped.
  function materialise(c) {
    const ok = c.kind === 'scippo' ? buildScippo(c) : c.kind === 'rapina' ? buildRapina(c) : buildFuga(c);
    if (!ok) {
      for (const a of c.actors) a.remove();
      c.actors.length = 0;
      if (c.car) {
        game.traffic.remove(c.car);
        c.car = null;
      }
    }
    return ok;
  }

  function buildScippo(c) {
    const lady = person(c, 'civilian', c, 'victim', { variant: 'bag' });
    const thief = lady && person(c, 'thug', { x: c.x + c.dx * 1.6, z: c.z + c.dz * 1.6 }, 'thief', { variant: rng() < 0.5 ? 'hood' : 'beanie' });
    if (!thief) return false;
    c.lady = lady;
    c.thief = thief;
    c.pace = 0;
    lady.stun(5.3);
    lady.fallDir = 1;
    c.goalT = 0;
    return true;
  }

  function buildRapina(c) {
    const clerk = person(c, 'civilian', c, 'clerk', { variant: 'plain' });
    if (!clerk) return false;
    clerk.stun(TTL);
    c.clerk = clerk;
    c.thugs = [];
    const n = 3 + ((rng() * 3) | 0), base = c.dx || c.dz ? Math.atan2(c.dx, c.dz) : rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = base + ((i - (n - 1) / 2) / n) * 2.2, r = 2.2 + rng() * 1.2;
      const t = person(c, 'thug', { x: c.x + Math.sin(ang) * r, z: c.z + Math.cos(ang) * r }, 'robber', { variant: rng() < 0.5 ? 'hood' : 'beanie' });
      if (!t) return false;
      t.yaw = Math.atan2(clerk.pos.x - t.pos.x, clerk.pos.z - t.pos.z);
      t.post = { x: t.pos.x, z: t.pos.z, next: 2 + rng() * 5 };
      c.thugs.push(t);
    }
    return true;
  }

  function buildFuga(c) {
    const T = game.traffic;
    const car = T.make(CARS[(rng() * CARS.length) | 0]);
    Object.assign(car, { x: c.x, z: c.z, yaw: Math.atan2(c.dx, c.dz), speed: 0, mode: 'flee' });
    T.cars.push(car);
    T.poseObj(car);
    c.car = car;
    const driver = person(c, 'thug', c, 'driver', { exact: true, variant: 'beanie' });
    const passenger = driver && person(c, 'thug', c, 'passenger', { exact: true, variant: 'hood' });
    if (!passenger) return false;
    c.driver = driver;
    c.passenger = passenger;
    c.drv = new RoadDriver(T, car);
    c.cruise = 14 + rng() * 3;
    c.planT = 0;
    c.stuck = 0;
    seat(c);
    return true;
  }

  // Thugs sit low in the car body so that only the head and shoulders show at the windows.
  function seat(c) {
    const car = c.car, sx = Math.sin(car.yaw), sz = Math.cos(car.yaw), y = car.obj.position.y - SEAT_DROP;
    for (const [a, side] of [[c.driver, 1], [c.passenger, -1]]) {
      if (a.removed || a.tied) continue;
      a.pos.set(car.x + sz * 0.4 * side + sx * 0.3, y, car.z - sx * 0.4 * side + sz * 0.3);
      a.yaw = car.yaw;
      a.speed = 0;
    }
  }

  // ---------- one tick of each live crime ----------

  function tickScippo(c, dt) {
    const A = game.actors, t = c.thief;
    if (neutral(t)) return solve(c, t.tied ? 'tied' : 'down');
    if (t.removed || Math.hypot(t.pos.x - P().x, t.pos.z - P().z) > LOST_D) return end(c, 'failed', 'escaped');
    layLady(c);
    c.x = t.pos.x;
    c.z = t.pos.z;
    if ((c.goalT -= dt) <= 0 || !t.hasGoal) {
      c.goalT = 2.5;
      const p = P();
      let best = null, bd = -1;
      for (let i = 0; i < 4; i++) {
        const q = A.randomWalkPoint(t.pos, 120), d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > bd && Math.hypot(q.x - t.pos.x, q.z - t.pos.z) > 35) (bd = d), (best = q);
      }
      if (best) A.walkTo(t, best.x, best.z, t.speedRun);
    }
  }

  // The lady goes down at once (the fall of the actor rig, held while she is stunned) and gets up
  // after a few seconds.
  function layLady(c) {
    const s = c.age - c.liveAt;
    if (!c.lady.removed) c.lady.fall = s < 0.4 ? s / 0.4 : s < 4.5 ? 1 : Math.max(0, 1 - (s - 4.5) / 0.7);
  }

  function tickRapina(c, dt) {
    let alive = 0, gone = 0, calm = true;
    for (const t of c.thugs) {
      if (neutral(t)) continue;
      if (t.removed) gone++;
      else alive++;
      if (t.hp < t.maxHp || t.state === 'stunned') calm = false;
    }
    if (!alive) return gone ? end(c, 'failed', 'escaped') : solve(c, c.thugs.every((t) => t.tied) ? 'tied' : c.thugs.every((t) => t.state === 'down') ? 'down' : 'mixed');
    if (!calm) return;
    // While nobody has touched them the thugs shift about in front of the clerk.
    for (const t of c.thugs) {
      if ((t.post.next -= dt) > 0 || t.hasGoal) continue;
      t.post.next = 3 + rng() * 5;
      game.actors.walkTo(t, t.post.x + (rng() - 0.5) * 2.4, t.post.z + (rng() - 0.5) * 2.4, t.speedWalk);
    }
  }

  function tickFuga(c, dt) {
    const car = c.car, d = c.driver, T = game.traffic, me = game.driving?.();
    if (!T.cars.includes(car) || d.removed || Math.hypot(car.x - P().x, car.z - P().z) > LOST_D) return end(c, 'failed', 'escaped');
    if (car.mode === 'driven') return solve(c, 'stolen');
    if (me && me !== car && Math.abs(lastDrive) > 6 && Math.hypot(me.x - car.x, me.z - car.z) < (me.len + car.len) / 4 + 1.6) {
      d.stun(6);
      return solve(c, 'rammed');
    }
    // Standing on the car (or beside it) and pressing C ties the driver.
    if (game.input.state.tiePressed && !me && !d.tied) {
      const p = P();
      if (Math.hypot(p.x - car.x, p.z - car.z) < car.len / 2 + 1.5 && p.y < car.h + 3) d.tie();
    }
    if (d.tied || d.stunT > 0 || d.state === 'down' || d.hp < d.maxHp) return solve(c, d.tied ? 'tied' : 'papuc');
    if ((c.planT -= dt) <= 0 || c.drv.done) {
      c.planT = 1;
      if (fleeRoute(c)) c.planT = 20;
    }
    c.stuck = Math.abs(car.speed) < 0.5 ? c.stuck + dt : 0;
    if (c.stuck > 3) (c.stuck = 0), (c.planT = 0);
    c.drv.update(dt, c.cruise);
    seat(c);
    c.x = car.x;
    c.z = car.z;
  }

  // A new way to run: the farthest from Bunica of a few vertices 250 to 700 m along the roads.
  function fleeRoute(c) {
    const car = c.car, p = P(), roads = roadsAround(game.city, car.x, car.z, 700);
    const goals = [];
    for (let n = 0; n < 24 && roads.length; n++) {
      const r = roads[(rng() * roads.length) | 0], i = (rng() * (r.pts.length / 2)) | 0;
      const x = r.pts[2 * i], z = r.pts[2 * i + 1], d = Math.hypot(x - car.x, z - car.z);
      if (d > 250 && d < 700) goals.push({ x, z, away: Math.hypot(x - p.x, z - p.z) });
    }
    goals.sort((a, b) => b.away - a.away);
    for (const g of goals.slice(0, 3)) {
      const route = planRoute(game.city, car, g);
      if (route && route.length > 8) {
        c.drv.follow(route);
        return true;
      }
    }
    return false;
  }

  const TICK = { scippo: tickScippo, rapina: tickRapina, fuga: tickFuga };

  // ---------- what follows a solved crime ----------

  // The bag lies where the thief fell: pick it up on foot, walk it back to the lady.
  function bagTask(c) {
    const bag = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.14), leather);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 6, 14, Math.PI), leather);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    body.position.y = 0.95;
    handle.position.y = 1.1;
    glow.position.y = 0.05;
    bag.add(body, handle, glow);
    const x = c.thief.pos.x, z = c.thief.pos.z, lady = c.lady;
    bag.position.set(x, ground(x, z), z);
    game.scene.add(bag);
    c.keep = [lady];
    let carried = false, t = 0;
    const task = {
      bagAt: { x, z },
      get carried() {
        return carried;
      },
      update(dt) {
        t += dt;
        const p = P();
        if (lady.removed || t > 90) return true;
        layLady(c);
        if (!carried) {
          body.rotation.y = handle.rotation.y = t * 1.6;
          body.position.y = handle.position.y - 0.15 + Math.sin(t * 2.2) * 0.06;
          if (!game.driving?.() && Math.hypot(p.x - x, p.z - z) < 1.6 && Math.abs(p.y - bag.position.y) < 2.5) {
            carried = true;
            bag.visible = false;
            game.hud?.toast('Borsetta recuperata! Riportala alla signora', 2.6);
          }
        } else if (Math.hypot(p.x - lady.pos.x, p.z - lady.pos.z) < 2.6) {
          payRespect(game, BAG_BONUS, 'crime:bag');
          game.hud?.toast(`Borsetta restituita! +${BAG_BONUS} Respect`, 2.4);
          return true;
        }
        game.minimap.setMarkers('crimes.bag', [carried ? { x: lady.pos.x, z: lady.pos.z, color: '#45e07a', shape: 'ring', label: 'Signora' } : { x, z, color: '#ffd400', shape: 'dot', label: 'Borsetta' }]);
        return false;
      },
      dispose() {
        game.scene.remove(bag);
        game.minimap.setMarkers('crimes.bag', []);
        body.geometry.dispose();
        handle.geometry.dispose();
        glow.geometry.dispose();
        leather.dispose();
        glow.material.dispose();
        lady.persist = false;
        lady.stunT = 0;
        lady.fall = 0;
      },
    };
    return task;
  }

  // The getaway car brakes to a stop with the driver at the wheel; the passenger jumps out and runs.
  function carTask(c) {
    const { car, driver, passenger, drv } = c;
    let t = 0;
    return {
      update(dt) {
        t += dt;
        if (car.mode === 'driven' || !game.traffic.cars.includes(car)) {
          // Stolen from under them: the thugs are left on the road.
          for (const a of [driver, passenger]) if (!a.removed) a.pos.set(car.x + Math.cos(car.yaw) * 2, ground(car.x, car.z), car.z - Math.sin(car.yaw) * 2);
          return true;
        }
        drv.update(dt, 0);
        seat(c);
        if (Math.abs(car.speed) > 0.3 && t < 8) return false;
        game.traffic.leave(car);
        const lx = Math.cos(car.yaw), lz = -Math.sin(car.yaw);
        for (const [a, side] of [[driver, 2.2], [passenger, -2.2]]) {
          if (a.removed) continue;
          a.pos.set(car.x + lx * side, ground(car.x, car.z), car.z + lz * side);
          a.persist = false;
        }
        if (!passenger.removed && !neutral(passenger)) runOff(passenger);
        return true;
      },
      dispose() {},
    };
  }

  // A getaway car whose crime ran out keeps going until it is well away, then goes.
  function driveOff(c) {
    const { car, drv, driver, passenger } = c;
    let t = 0;
    return {
      update(dt) {
        t += dt;
        const away = Math.hypot(car.x - P().x, car.z - P().z);
        if (car.mode === 'flee' && t < 25 && away < 160 && game.traffic.cars.includes(car)) {
          if (drv.done && (c.planT -= dt) <= 0) (c.planT = 2), fleeRoute(c);
          drv.update(dt, c.cruise);
          seat(c);
          return false;
        }
        return true;
      },
      dispose() {
        if (car.mode === 'flee' && game.traffic.cars.includes(car)) game.traffic.remove(car);
        driver.remove();
        passenger.remove();
      },
    };
  }

  // ---------- system ----------

  const sys = {
    name: 'crimes',
    auto: true, // false stops the timer that starts crimes by itself (for tests)
    list: crimes,
    epilogues,
    spawn,
    solve,
    end,

    onCityChange() {
      for (const c of [...crimes]) end(c, 'failed', 'city');
      for (const e of epilogues.splice(0)) e.dispose();
    },

    update(dt) {
      if (!game.actors) return;
      if (sys.auto && (timer -= dt) <= 0) {
        timer = 45 + rng() * 45;
        if (crimes.length < MAX_ACTIVE) spawn();
      }
      const p = P();
      for (const c of [...crimes]) {
        c.age += dt;
        if ((c.ttl -= dt) <= 0) {
          end(c, 'expired');
          continue;
        }
        if (!c.live) {
          if (Math.hypot(c.x - p.x, c.z - p.z) > LIVE_D || (c.tries > 0 && (c.retryT -= dt) > 0)) continue;
          if (materialise(c)) {
            c.live = true;
            c.liveAt = c.age;
          } else {
            c.tries++;
            c.retryT = 0.5;
            if (c.tries > 40) end(c, 'failed', 'nospace');
          }
          continue;
        }
        TICK[c.kind](c, dt);
      }
      for (let i = epilogues.length - 1; i >= 0; i--) {
        if (!epilogues[i].update(dt)) continue;
        epilogues[i].dispose();
        epilogues.splice(i, 1);
      }
      lastDrive = game.driving?.()?.speed ?? 0;
      if ((markT -= dt) <= 0 && crimes.length) {
        markT = 0.25;
        markers();
      }
    },

    dispose() {
      sys.onCityChange();
    },
  };
  return sys;
}
