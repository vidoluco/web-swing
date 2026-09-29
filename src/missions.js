import * as THREE from 'three';
import { Beams } from './beams.js';
import { MISSIONS } from './missions-data.js';

// The mission runner. Missions are data (missions-data.js), one list per city, unlocked in order and
// saved under 'missions' as { cityId: [ids done] }. The next one has a yellow column where it starts:
// walk into it or press G near it. A run walks through its steps; each step shows its checkpoints as
// columns plus minimap markers, and the objective (and the timer, if any) go to the HUD. A failed run
// removes everything it made and keeps no progress; the marker is there again for a retry.
const YELLOW = '#ffd400';
const START_R = 4;
const START_KEY_R = 45; // G starts the mission from this close to the marker
const LOSE_R = 110; // a runner this far away for LOSE_T seconds is gone
const LOSE_T = 6;
const SPEAKER_REACH = 4.2;

const CSS = `
#mission-say, #mission-hint { display: none; box-sizing: border-box; max-width: 100%; text-align: center; background: rgba(0,0,0,0.6); pointer-events: none; }
#mission-say.show, #mission-hint.show { display: block; animation: fadein 0.25s; }
#mission-say { padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 15px; color: #ffe9a0; }
#mission-say small { display: block; font-size: 13px; font-weight: 700; color: #ffd400; letter-spacing: 0.06em; text-transform: uppercase; }
#mission-hint { font-weight: 800; font-size: 14px; letter-spacing: 0.05em; padding: 6px 14px; border-radius: 999px; }
#overlay-missions { max-width: min(560px, 100%); width: 100%; box-sizing: border-box; text-align: left; font-size: 14px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; padding: 8px 14px; cursor: default; }
#overlay-missions h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }
#overlay-missions div { display: flex; gap: 8px; padding: 2px 0; font-weight: 700; }
#overlay-missions div span:first-child { flex: 0 0 18px; text-align: center; }
#overlay-missions div small { margin-left: auto; font-size: 13px; opacity: 0.7; font-weight: 600; }
#overlay-missions .done { color: #8fe28f; }
#overlay-missions .next { color: #ffd400; }
#overlay-missions .locked { opacity: 0.55; }
`;

const nowGone = (a) => !a || a.removed || a.state === 'down' || a.tied;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function letterSprite(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 104px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = '#fff';
  g.strokeText(ch, 64, 70);
  g.fillStyle = '#c62828';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(2.2, 2.2, 1);
  return s;
}

// A speaker box on a facade, facing out along (nx, nz).
function speakerMesh(nx, nz) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.7 });
  const cone = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.5, emissive: 0x551010, emissiveIntensity: 0.6 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.5), dark));
  const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20).rotateX(Math.PI / 2), cone);
  woofer.position.set(0, -0.15, 0.26);
  const tweeter = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16).rotateX(Math.PI / 2), cone);
  tweeter.position.set(0, 0.28, 0.26);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), lamp);
  led.position.set(0.2, 0.44, 0.26);
  g.add(woofer, tweeter, led);
  g.rotation.y = Math.atan2(nx, nz);
  g.userData.woofer = woofer;
  return g;
}

export function create(game) {
  const { scene, city, player, events, hud, save } = game;
  const key = game.cityId;
  const defs = MISSIONS[key]?.missions ?? [];
  const campaign = MISSIONS[key]?.campaign ?? '';
  const beams = new Beams(scene, city);
  const done = new Set(save.get('missions', {})[key] ?? []);
  let run = null;
  let armed = true; // false after a run ends, until she has walked away from the start marker
  let markT = 0;
  let objText = null;
  let sayT = 0;
  let carry = null; // sprite over her head while she carries something
  let hintOn = false;
  let lastHint = '';
  const offs = []; // event unsubscribers, for dispose
  const speakers = [];
  const dom = {};

  const next = () => defs.find((d) => !done.has(d.id)) ?? null;
  const status = (d) => (run?.def === d ? 'active' : done.has(d.id) ? 'done' : d === next() ? 'next' : 'locked');
  const ground = (pt) => game.city.groundAt?.(pt.x, pt.z) ?? 0;

  // ---------- HUD bits ----------

  function subtitle(text, who = '') {
    dom.say.replaceChildren();
    if (who) {
      const s = document.createElement('small');
      s.textContent = who;
      dom.say.append(s);
    }
    dom.say.append(text);
    dom.say.classList.add('show');
    sayT = 2.6 + text.length * 0.05;
  }

  function hint(text) {
    if (text === lastHint) return;
    lastHint = text;
    dom.hint.textContent = text || '';
    dom.hint.classList.toggle('show', !!text);
  }

  function renderList() {
    if (!dom.list) return;
    dom.list.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = campaign;
    dom.list.append(h);
    defs.forEach((d, i) => {
      const st = status(d);
      const row = document.createElement('div');
      row.className = st === 'active' ? 'next' : st;
      const mark = document.createElement('span');
      mark.textContent = st === 'done' ? '✓' : st === 'locked' ? '·' : '›';
      const name = document.createElement('span');
      name.textContent = `${i + 1}. ${d.title}`;
      const where = document.createElement('small');
      where.textContent = d.where;
      row.append(mark, name, where);
      dom.list.append(row);
    });
    dom.list.classList.toggle('hidden', !defs.length);
  }

  // ---------- markers: the start of the next mission, or where the current step points ----------

  function refreshStart() {
    const d = next();
    if (!run && d) beams.set('start', { ...d.start, color: YELLOW, r: START_R });
    else beams.remove('start');
  }

  function targets() {
    if (!run) return [];
    const S = run.step;
    return S ? S.h.points(S) : [];
  }

  function markers() {
    const list = [];
    if (!run) {
      const d = next();
      if (d) list.push({ ...d.start, color: YELLOW, shape: 'ring', label: d.title });
    } else {
      for (const t of targets()) list.push({ x: t.x, z: t.z, color: t.color ?? YELLOW, shape: t.shape ?? 'ring', label: t.label });
    }
    game.minimap.setMarkers('missions', list);
  }

  // ---------- actors of a run ----------

  function spawnFoe(f, role) {
    const a = game.actors?.spawn(f.kind, f.at, { persist: true, hp: f.hp, variant: f.variant, scale: f.scale, fur: f.fur });
    if (!a) return null;
    a.mission = { id: run.def.id, key: f.key, role };
    run.actors.set(f.key, a);
    return a;
  }

  // Spawn what a step lists; a spawn that finds no room is tried again for a few seconds.
  function spawnPending(S, dt) {
    if (!S.pending.length) return true;
    S.spawnT -= dt;
    if (S.spawnT > 0) return false;
    S.spawnT = 0.4;
    S.pending = S.pending.filter((f) => !spawnFoe(f, S.role));
    if (S.pending.length && ++S.tries > 25) fail('non c’è posto per i personaggi');
    return !S.pending.length;
  }

  // Runners follow their route while she is within `alert`, then keep running away from her.
  function flee(S, dt) {
    for (const f of [...(S.def.flee ?? []), ...run.extraFlee]) {
      const a = run.actors.get(f.ref);
      if (!a || nowGone(a) || a.state === 'stunned') continue;
      a.mission.role = 'flee';
      const wpi = (run.wp[f.ref] ??= 0);
      const d = dist2(a.pos, player.pos);
      if (d > (f.alert ?? 45)) continue;
      const wp = f.route[wpi];
      if (wp) {
        if (Math.hypot(wp[0] - a.pos.x, wp[1] - a.pos.z) < 4) run.wp[f.ref]++;
        else game.actors.walkTo(a, wp[0], wp[1], f.speed);
      } else if (!a.hasGoal) {
        // Past the end of the route: keep running, away from her.
        let best = null;
        for (let i = 0; i < 4; i++) {
          const c = game.actors.randomWalkPoint(a.pos, 90);
          if (!best || dist2(c, player.pos) > dist2(best, player.pos)) best = c;
        }
        game.actors.walkTo(a, best.x, best.z, f.speed);
      }
      S.far = d > LOSE_R ? (S.far ?? 0) + dt : Math.max(0, (S.far ?? 0) - dt);
      if (S.far > LOSE_T) fail('il fuggitivo è sparito');
    }
  }

  // ---------- steps ----------
  // Each handler: enter(S) once, update(S, dt) each tick returning true when the step is complete,
  // points(S) the places to mark, text(S) the objective line.

  const actorStep = {
    enter(S) {
      S.role = S.def.type === 'chase' ? 'flee' : 'foe';
      S.pending = (S.def.foes ?? []).slice();
      S.spawnT = 0;
      S.tries = 0;
    },
    update(S, dt) {
      const ready = spawnPending(S, dt);
      if (S.def.guard && nowGone(run.actors.get(S.def.guard)) && run.actors.has(S.def.guard)) return fail('Matei è a terra');
      flee(S, dt);
      if (!ready) return false;
      const need = S.def.refs ?? S.def.only ?? (S.def.foes ?? []).map((f) => f.key).filter((k) => k !== S.def.guard);
      S.left = need.filter((k) => !nowGone(run.actors.get(k))).length;
      return S.left === 0;
    },
    points(S) {
      const out = [];
      for (const a of run.actors.values()) if (!nowGone(a) && a.kind !== 'civilian') out.push({ x: a.pos.x, z: a.pos.z, shape: 'dot', color: '#ff5050' });
      return out.length ? out : S.def.foes?.slice(0, 1).map((f) => f.at) ?? [];
    },
    text: (S) => `${S.def.text}${S.left > 1 ? ` (${S.left})` : ''}`,
  };

  const STEPS = {
    goto: {
      enter(S) {
        const at = S.def.at;
        beams.set('t0', { ...at, color: YELLOW, r: S.def.r ?? 6 });
      },
      update(S) {
        if (!beams.inside('t0', player.pos)) return false;
        if (S.def.carry) setCarry(S.def.carry);
        if (S.def.drop) setCarry(null);
        return true;
      },
      points: (S) => [S.def.at],
    },

    deliver: {
      enter(S) {
        S.n = 0;
        S.show = () => {
          S.def.points.forEach((pt, i) => (i >= S.n ? beams.set('t' + i, { ...pt, color: YELLOW, r: S.def.r ?? 8, alpha: i === S.n ? 1 : 0.35 }) : beams.remove('t' + i)));
        };
        S.show();
      },
      update(S) {
        if (!beams.inside('t' + S.n, player.pos)) return false;
        S.n++;
        if (S.n < S.def.points.length) {
          hud.toast(`Consegnato ${S.n}/${S.def.points.length}`, 1.4);
          game.sfx?.play?.('door');
        }
        S.show();
        return S.n >= S.def.points.length;
      },
      points: (S) => S.def.points.slice(S.n, S.n + 2),
      text: (S) => `${S.def.text} ${S.n}/${S.def.points.length}`,
    },

    defeat: actorStep,
    tie: actorStep,
    chase: actorStep,

    steal: {
      enter(S) {
        const c = S.def.car;
        S.car = Object.assign(game.traffic.make(c.type), { x: c.x, z: c.z, yaw: c.yaw, mode: 'parked', speed: 0 });
        game.traffic.cars.push(S.car);
        game.traffic.poseObj(S.car);
        beams.set('t0', { x: c.x, z: c.z, color: YELLOW, r: 3 });
      },
      update(S) {
        if (game.driving?.() === S.car) return true;
        if (!game.traffic.cars.includes(S.car)) return fail('il taxi è sparito');
        return false;
      },
      points: (S) => [S.car],
    },

    tail: {
      enter(S) {
        const q = S.def.quarry, tr = game.traffic;
        let best = null;
        for (const road of tr.nearRoads(q.x, q.z)) {
          const n = road.pts.length / 2;
          for (let i = 0; i < n; i++) {
            const d = Math.hypot(road.pts[2 * i] - q.x, road.pts[2 * i + 1] - q.z);
            if (!best || d < best.d) best = { d, road, i, n };
          }
        }
        if (!best) return fail('nessuna strada per il taxi');
        const dir = best.i < best.n - 1 ? 1 : -1;
        const c = tr.make(q.type);
        const st = { road: best.road, a: best.i, dir, s: 0, laneSeed: 0.5 };
        tr.setRoad(st, best.road, best.i, dir);
        Object.assign(c, st);
        const [x, z, yaw] = tr.target(c);
        Object.assign(c, { x, z, yaw, speed: 10 });
        tr.cars.push(c);
        tr.poseObj(c);
        S.car = c;
        S.near = 0;
        S.far = 0;
      },
      update(S, dt) {
        const c = S.car, tr = game.traffic;
        if (!tr.cars.includes(c)) return fail('il taxi è sparito');
        c.cruise = Math.max(c.cruise, 17); // a driver in a hurry
        const d = dist2(c, player.pos);
        S.far = d > 240 ? S.far + dt : Math.max(0, S.far - dt);
        if (S.far > 8) return fail('hai perso il taxi');
        S.near = d < S.def.catchR ? S.near + dt : Math.max(0, S.near - dt * 2);
        if (S.near < S.def.catchT) return false;
        // Cornered: the taxi stops and its driver jumps out and runs.
        tr.leave(c);
        const t = S.def.then, lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw);
        spawnFoe({ ...t, at: { x: c.x + lx * 2.2, z: c.z + lz * 2.2 } }, 'flee');
        run.extraFlee.push({ ref: t.key, route: [], speed: t.speed, alert: Infinity });
        return true;
      },
      points: (S) => [{ x: S.car.x, z: S.car.z, color: '#ff5050', shape: 'dot' }],
      text: (S) => `${S.def.text}${S.near > 0 ? ' · ci sei' : ''}`,
    },

    destroy: {
      enter(S) {
        S.left = S.def.targets.map((t, i) => {
          const gy = ground(t);
          const m = speakerMesh(t.nx, t.nz);
          m.position.set(t.x + t.nx * 0.35, gy + t.y, t.z + t.nz * 0.35);
          scene.add(m);
          speakers.push(m);
          beams.set('t' + i, { x: t.x - t.nz * 2.6 + t.nx * 0.6, z: t.z + t.nx * 2.6 + t.nz * 0.6, y: gy, color: '#ff40c8', r: 1.3, alpha: 0.7 }); // beside the speaker, not in front of it
          return { t, m, i };
        });
        S.n = S.def.targets.length;
      },
      update(S, dt) {
        const s = game.input.state;
        const press = s.interactPressed || s.attackPressed;
        let close = false;
        for (const sp of S.left.slice()) {
          const m = sp.m;
          m.userData.woofer.scale.setScalar(1 + 0.25 * Math.sin(game.time * 14 + sp.i));
          const d = Math.hypot(player.pos.x - m.position.x, player.pos.y + 0.9 - m.position.y, player.pos.z - m.position.z);
          if (d > SPEAKER_REACH) continue;
          close = true;
          if (!press) continue;
          dropMesh(m);
          speakers.splice(speakers.indexOf(m), 1);
          beams.remove('t' + sp.i);
          S.left.splice(S.left.indexOf(sp), 1);
          hud.toast(`Cassa spenta ${S.n - S.left.length}/${S.n}`, 1.4);
        }
        S.hint = close;
        return S.left.length === 0;
      },
      points: (S) => S.left.map((sp) => ({ x: sp.t.x, z: sp.t.z, color: '#ff40c8' })),
      text: (S) => `${S.def.text} ${S.n - S.left.length}/${S.n}`,
    },

    escort: {
      enter(S) {
        S.pending = [{ ...S.def.actor, at: S.def.actor.at }];
        S.role = 'guard';
        S.spawnT = 0;
        S.tries = 0;
        S.far = 0;
        beams.set('t0', { ...S.def.to, color: YELLOW, r: S.def.r });
        S.hit = events.on('hit', (e) => e?.target === run?.actors.get(S.def.actor.key) && S.def.noHit && fail('hai fatto arrabbiare l’orso'));
      },
      update(S, dt) {
        if (!spawnPending(S, dt)) return false;
        const a = run.actors.get(S.def.actor.key);
        if (!a || a.removed) return fail('l’orso è sparito');
        const d = dist2(a.pos, player.pos);
        // It follows at a few metres when she is near enough, else it stays where it is.
        if (d < 40 && d > 6) game.actors.walkTo(a, player.pos.x, player.pos.z, 2.4);
        S.far = d > 70 ? S.far + dt : Math.max(0, S.far - dt);
        if (S.far > 10) return fail('hai perso l’orso');
        if (dist2(a.pos, S.def.to) > S.def.r) return false;
        // Home: it heads off into the trees.
        const dx = S.def.to.x - player.pos.x, dz = S.def.to.z - player.pos.z, L = Math.hypot(dx, dz) || 1;
        game.actors.walkTo(a, a.pos.x + (dx / L) * 40, a.pos.z + (dz / L) * 40, 3);
        return true;
      },
      leave(S) {
        S.hit?.();
      },
      points(S) {
        const a = run.actors.get(S.def.actor.key);
        return [S.def.to, ...(a ? [{ x: a.pos.x, z: a.pos.z, color: '#c98b4a', shape: 'dot' }] : [])];
      },
    },
  };

  STEPS.race = STEPS.deliver; // a race is gates in order like a delivery, just told differently

  function dropMesh(m) {
    scene.remove(m);
    m.traverse((o) => o.isMesh && (o.geometry.dispose(), o.material.dispose()));
  }

  function setCarry(label) {
    if (carry) {
      scene.remove(carry);
      carry.material.map.dispose();
      carry.material.dispose();
      carry = null;
    }
    if (label) scene.add((carry = letterSprite(label)));
  }

  // ---------- run lifecycle ----------

  function enterStep(i) {
    const def = run.def.steps[i];
    run.i = i;
    beams.clear();
    game.minimap.setMarkers('missions', []);
    run.step?.h.leave?.(run.step);
    const S = (run.step = { def, h: STEPS[def.type] });
    S.h.enter?.(S);
    if (def.say) subtitle(def.say);
    if (run) markers();
  }

  function start(id) {
    const def = defs.find((d) => d.id === id);
    if (!def || run) return false;
    if (game.challenges?.activeRace) return false;
    if (def.noStars && game.wanted?.stars > 0) {
      hud.toast('Prima fai calmare la polizia', 2.2);
      return false;
    }
    if (done.has(id) || def !== next()) {
      hud.toast(done.has(id) ? 'Missione già completata' : 'Missione bloccata: prima le precedenti', 2.2);
      return false;
    }
    run = { def, i: -1, t: 0, left: def.time, actors: new Map(), wp: {}, extraFlee: [] };
    hint('');
    hintOn = false;
    beams.clear();
    if (def.wanted && game.wanted) game.wanted.add(Math.max(0, def.wanted - game.wanted.stars));
    game.voice?.say('missionStart');
    subtitle(def.giver.line, def.giver.name);
    events.emit('mission:start', { id });
    enterStep(0);
    return true;
  }

  function cleanup(keepActors) {
    const r = run;
    run = null;
    beams.clear();
    game.minimap.setMarkers('missions', []);
    for (const sp of speakers.splice(0)) dropMesh(sp);
    setCarry(null);
    hint('');
    hintOn = false;
    sayT = 0;
    dom.say.classList.remove('show');
    r.step?.h.leave?.(r.step);
    for (const a of r.actors.values()) {
      if (keepActors) a.persist = false;
      else a.remove();
    }
    const c = r.step?.car;
    if (c && r.step.def.type === 'tail' && !keepActors && game.traffic.cars.includes(c) && game.driving?.() !== c) game.traffic.remove(c);
    setObjective(null);
    armed = false;
    refreshStart();
    markers();
    renderList();
  }

  function setObjective(t) {
    if (t === objText) return;
    objText = t;
    hud.setObjective(t);
  }

  function fail(why) {
    if (!run) return false;
    const id = run.def.id;
    cleanup(false);
    hud.toast(`Missione fallita: ${why}`, 3);
    game.voice?.say('missionFail');
    events.emit('mission:end', { id, result: 'fail', why });
    return false;
  }

  function abort() {
    if (!run) return;
    const id = run.def.id;
    cleanup(false);
    events.emit('mission:end', { id, result: 'abort' });
  }

  function complete() {
    const d = run.def;
    if (d.wanted) game.wanted?.clear();
    done.add(d.id);
    const all = save.get('missions', {});
    all[key] = [...done];
    save.set('missions', all);
    cleanup(true);
    hud.toast(`Missione completata: ${d.title}  +${d.reward.respect} Respect`, 3.2);
    game.voice?.say('missionDone');
    game.respect?.add(d.reward.respect, `mission:${d.id}`);
    events.emit('mission:end', { id: d.id, result: 'done' });
    renderList();
  }

  // ---------- the system ----------

  const api = (game.missions = {
    defs,
    campaign,
    start,
    abort,
    fail,
    next,
    get list() {
      return defs.map((d) => ({ id: d.id, title: d.title, where: d.where, reward: d.reward.respect, status: status(d) }));
    },
    get done() {
      return [...done];
    },
    get active() {
      return run && { id: run.def.id, step: run.i, steps: run.def.steps.length, type: run.step?.def.type, left: run.left, elapsed: run.t };
    },
    // { label, sec }: seconds left, for the HUD; null with no run or no time limit.
    get timer() {
      return run?.def.time ? { label: run.def.title, sec: Math.max(0, run.left), total: run.def.time } : null;
    },
    // Actors made by the current run, by key (tests and other systems).
    actor: (k) => run?.actors.get(k) ?? null,
    step: () => run?.step ?? null,
  });

  return {
    name: 'missions',
    init() {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.append(style);
      dom.style = style;
      dom.say = document.createElement('div');
      dom.say.id = 'mission-say';
      dom.hint = document.createElement('div');
      dom.hint.id = 'mission-hint';
      document.getElementById('hud-bottom')?.append(dom.say, dom.hint);
      dom.list = document.createElement('div');
      dom.list.id = 'overlay-missions';
      const overlay = document.getElementById('overlay');
      overlay?.insertBefore(dom.list, document.getElementById('overlay-buttons'));
      renderList();
      document.addEventListener('pointerlockchange', renderList);
      offs.push(
        events.on('bunica:down', () => run && fail('sei svenuta')),
        events.on('busted', () => run && fail('ti hanno presa')),
        events.on('wanted', (e) => run?.def.noStars && e?.stars > 0 && fail('è arrivata la polizia')),
      );
      refreshStart();
    },

    update(dt) {
      if (dom.say && sayT > 0 && (sayT -= dt) <= 0) dom.say.classList.remove('show');
      beams.update(dt, game.camera.position);
      if ((markT -= dt) <= 0) {
        markT = 0.1;
        markers();
      }
      if (carry) carry.position.set(player.pos.x, player.pos.y + 3.2, player.pos.z);

      if (!run) {
        const d = next();
        if (!d) return hint('');
        const dd = dist2(player.pos, d.start);
        if (!armed && dd > START_R + 8) armed = true;
        const busy = !!game.challenges?.activeRace;
        const near = dd < START_KEY_R && !busy;
        if (near !== hintOn) {
          hintOn = near;
          hint(near ? `G: inizia «${d.title}»` : '');
        }
        if (busy) return;
        if (game.input.state.interactPressed && dd < START_KEY_R) start(d.id);
        else if (armed && beams.inside('start', player.pos)) start(d.id);
        return;
      }

      run.t += dt;
      if (run.def.time) {
        run.left -= dt;
        if (run.left <= 0) return void fail('tempo scaduto');
      }
      const S = run.step;
      const finished = S.h.update(S, dt);
      if (!run) return; // the step failed the run
      const text = S.h.text?.(S) ?? S.def.text;
      const pts = S.h.points(S);
      const near = pts.length ? Math.min(...pts.map((t) => dist2(t, player.pos))) : 0;
      setObjective(pts.length && near > 12 ? `${text} · ${Math.round(near / 5) * 5} m` : text);
      hint(S.hint ? 'G: spegni la cassa' : '');
      if (finished) {
        if (run.i + 1 < run.def.steps.length) enterStep(run.i + 1);
        else complete();
      }
    },

    dispose() {
      if (run) cleanup(false);
      beams.clear();
      game.minimap.setMarkers('missions', []);
      dom.style?.remove();
      dom.say?.remove();
      dom.hint?.remove();
      dom.list?.remove();
      document.removeEventListener('pointerlockchange', renderList);
      for (const off of offs.splice(0)) off();
    },
  };
}
