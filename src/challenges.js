import * as THREE from 'three';
import { Beams } from './beams.js';
import { RACES, raceTimes, raceLength, medalFor, respectFor, betterMedal } from './challenges-data.js';
import { loadCollect, Pickups, bandTexture } from './collectibles.js';

// Challenges: checkpoint races between real places with gold, silver and bronze times, and the 50
// jars of zacusca on the roofs and monuments of each city. Best times are saved under 'challenges'
// ({ cityId: { raceId: { best, medal } } }), the jars taken under 'borcane' ({ cityId: [ids] }).
const BLUE = '#3aa0ff';
const START_R = 6;
const GATE_R = 9;
const JAR_RESPECT = 3;
const TIMEOUT = 1.6; // of the bronze time
export const JARS_PER_CITY = 50;

let jarModels = null;
function jarModel() {
  if (!jarModels) {
    const glass = new THREE.MeshStandardMaterial({ color: 0xdfeff5, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
    const stew = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.5, emissive: 0x8a2a00, emissiveIntensity: 0.9 });
    const lid = new THREE.MeshStandardMaterial({ color: 0xd8a72a, roughness: 0.35, metalness: 0.6, emissive: 0x403000, emissiveIntensity: 0.4 });
    const body = new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.1, 0.02], [0.1, 0.17], [0.085, 0.2], [0.08, 0.22], [0, 0.22]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
    const fill = new THREE.LatheGeometry([[0, 0.01], [0.088, 0.01], [0.092, 0.03], [0.092, 0.16], [0, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
    const label = new THREE.MeshStandardMaterial({ map: bandTexture(['ZACUSCĂ', 'DE VINETE'], '#f6ecd0', '#8a1c10', '#c2410c'), roughness: 0.7 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(body, glass), new THREE.Mesh(fill, stew));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.035, 20), lid);
    cap.position.y = 0.235;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.09, 24, 1, true), label);
    band.position.y = 0.095;
    g.add(cap, band);
    g.scale.setScalar(3.4);
    g.position.y = -0.35;
    jarModels = g;
  }
  const outer = new THREE.Group();
  outer.add(jarModels.clone());
  return outer;
}

export function create(game) {
  const { save, events, hud, player } = game;
  const key = game.cityId;
  const races = RACES[key] ?? [];
  const beams = new Beams(game.scene, game.city);
  const record = (id) => save.get('challenges', {})[key]?.[id] ?? null;
  let active = null; // { race, n (next gate), t, limit }
  let armed = true;
  let markT = 0;
  let jars = null;
  let objText = null;

  const jarSet = new Set(save.get('borcane', {})[key] ?? []);
  const jarsAll = () => Object.values(save.get('borcane', {})).reduce((n, a) => n + a.length, 0);

  // ---------- races ----------

  function showStarts() {
    for (const r of races) {
      if (active) beams.remove('s:' + r.id);
      else beams.set('s:' + r.id, { ...r.points[0], color: BLUE, r: START_R });
    }
  }

  function setObjective(t) {
    if (t === objText) return;
    objText = t;
    hud.setObjective(t);
  }

  function showGates() {
    const { race, n } = active;
    beams.clear();
    for (let i = n; i < Math.min(n + 2, race.points.length); i++) beams.set('g' + i, { ...race.points[i], color: BLUE, r: GATE_R, alpha: i === n ? 1 : 0.35 });
  }

  function startRace(id) {
    const race = races.find((r) => r.id === id);
    if (!race || active || game.missions?.active) return false;
    const t = raceTimes(race);
    active = { race, n: 1, t: 0, limit: t.bronze * TIMEOUT, times: t };
    beams.clear();
    game.voice?.say('missionStart');
    events.emit('challenge:start', { id });
    showGates();
    return true;
  }

  function endRace() {
    const a = active;
    active = null;
    armed = false;
    setObjective(null);
    game.minimap.setMarkers('races', []);
    beams.clear();
    showStarts();
    return a;
  }

  function finishRace() {
    const a = endRace();
    const time = Math.round(a.t * 10) / 10;
    const medal = medalFor(a.race, time);
    const prev = record(a.race.id);
    const owed = respectFor(medal, prev?.medal);
    const all = save.get('challenges', {});
    const cur = all[key]?.[a.race.id];
    // Best time and best medal are kept apart: a slower run never loses either.
    const next = { best: cur ? Math.min(cur.best, time) : time, medal: cur && !betterMedal(medal, cur.medal) ? cur.medal : medal ?? cur?.medal ?? null };
    (all[key] ??= {})[a.race.id] = next;
    save.set('challenges', all);
    hud.toast(medal ? `Gara finita in ${fmt(time)}: ${MEDAL_NAME[medal]}${owed ? `  +${owed} Respect` : ''}` : `Gara finita in ${fmt(time)}: nessuna medaglia`, 3.4);
    if (owed) game.respect?.add(owed, `race:${a.race.id}`);
    events.emit('challenge:end', { id: a.race.id, result: 'done', medal, time });
  }

  function failRace(why) {
    const a = endRace();
    hud.toast(`Gara persa: ${why}`, 2.6);
    events.emit('challenge:end', { id: a.race.id, result: 'fail', why });
  }

  // ---------- jars ----------

  function initJars(data) {
    if (!data?.jars?.length) return;
    jars = new Pickups(game, {
      items: data.jars,
      taken: jarSet,
      build: jarModel,
      glow: () => 0xff7a1a,
      height: 12,
      take(it) {
        const all = save.get('borcane', {});
        all[key] = [...jarSet];
        save.set('borcane', all);
        game.respect?.add(JAR_RESPECT, 'borcan');
        hud.toast(`Borcan di zacuscă ${jarSet.size}/${data.jars.length}`, 1.6);
        game.sfx?.play?.('door');
        game.voice?.say('collect');
        events.emit('collect', { kind: 'jar', id: it.id });
      },
    });
  }

  game.challenges = {
    races,
    startRace,
    abort: () => active && failRace('interrotta'),
    get activeRace() {
      return active && { id: active.race.id, next: active.n, gates: active.race.points.length, t: active.t };
    },
    // { label, sec, up, goal }: the stopwatch of the running race, for the HUD.
    get timer() {
      return active && { label: active.race.title, sec: active.t, up: true, goal: active.times.gold };
    },
    record,
    get list() {
      return races.map((r) => ({ id: r.id, title: r.title, from: r.from, to: r.to, length: Math.round(raceLength(r)), ...raceTimes(r), best: record(r.id)?.best ?? null, medal: record(r.id)?.medal ?? null }));
    },
    get jars() {
      return {
        got: jarSet.size,
        total: jars?.items.length ?? 0,
        all: jarsAll(),
        items: jars?.items ?? [],
        take: (id) => jars?.take(jars.find(id)),
      };
    },
    // Jars still to find on this map: their ids.
    get jarsLeft() {
      return jars ? jars.left.map((j) => j.id) : [];
    },
  };

  return {
    name: 'challenges',
    init() {
      showStarts();
      loadCollect(key).then(initJars);
      // A mission that ends on a race's start must not throw her into the race: wait until she has left.
      events.on('mission:end', () => (armed = false));
    },

    update(dt) {
      beams.update(dt, game.camera.position);
      jars?.update(dt);
      if ((markT -= dt) <= 0) {
        markT = 0.25;
        const list = [];
        if (active) for (let i = active.n; i < Math.min(active.n + 2, active.race.points.length); i++) list.push({ ...active.race.points[i], color: BLUE, shape: 'ring', label: i === active.n ? `${i}/${active.race.points.length - 1}` : undefined });
        else for (const r of races) if (Math.hypot(r.points[0].x - player.pos.x, r.points[0].z - player.pos.z) < 1800) list.push({ ...r.points[0], color: BLUE, shape: 'ring', label: r.title });
        game.minimap.setMarkers('races', list);
        if (jars) {
          const near = jars.left.filter((j) => Math.hypot(j.x - player.pos.x, j.z - player.pos.z) < 320).slice(0, 12);
          game.minimap.setMarkers('jars', near.map((j) => ({ x: j.x, z: j.z, color: '#ff8a1e', shape: 'dot' })));
        }
      }

      if (!active) {
        if (game.missions?.active) return;
        if (!armed) {
          if (races.every((r) => Math.hypot(r.points[0].x - player.pos.x, r.points[0].z - player.pos.z) > START_R + 10)) armed = true;
          return;
        }
        for (const r of races) if (beams.inside('s:' + r.id, player.pos)) return void startRace(r.id);
        return;
      }
      active.t += dt;
      if (active.t > active.limit) return failRace('tempo scaduto');
      if (beams.inside('g' + active.n, player.pos)) {
        const gate = active.n;
        events.emit('collect', { kind: 'checkpoint', id: `${active.race.id}:${gate}` });
        game.sfx?.play?.('door');
        if (++active.n >= active.race.points.length) return void finishRace();
        hud.toast(`Checkpoint ${gate}/${active.race.points.length - 1}  ${fmt(active.t)}`, 1.2);
        showGates();
      }
      setObjective(`${active.race.title}: checkpoint ${active.n}/${active.race.points.length - 1}`);
    },

    dispose() {
      if (active) endRace();
      beams.clear();
      jars?.dispose();
      game.minimap.setMarkers('races', []);
      game.minimap.setMarkers('jars', []);
    },
  };
}

const MEDAL_NAME = { gold: 'oro', silver: 'argento', bronze: 'bronzo' };
export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
