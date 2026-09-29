import * as THREE from 'three';
import { clamp } from './config.js';
import { closestOnPrism, pointInPrism2D } from './osmcity.js';
import { papucMesh } from './bunica.js';
import { Fx } from './combat-fx.js';
import { Thugs, clearLine } from './combat-thugs.js';

// Health, the papuc combo, the thrown papuc, tying with the clothesline, the dodge and the
// knockout. Owns game.health and game.combat. Two hooks in main.js run before the player moves:
// game.combat.filterInput(input) decides what the click and Space mean this tick, and
// game.combat.scaleDt(dt) freezes the game for the hit stop.

const MELEE_RANGE = 5; // a click with a thug this close is an attack, otherwise it swings
const HIT_REACH = 2.7; // a blow lands within this
const LUNGE = 12; // m/s towards the target while winding up
const LOCK_RANGE = 12;
const THROW_RANGE = 24;
const THROW_SPEED = 28;
const TIE_RANGE = 7;
const COMBO_WINDOW = 0.6; // the next click within this continues the combo
const COMBO = [
  { dmg: 12, stun: 0.4, knock: 0.35, wind: 0.11, rest: 0.22 },
  { dmg: 12, stun: 0.4, knock: 0.35, wind: 0.11, rest: 0.22 },
  { dmg: 14, stun: 0.45, knock: 0.5, wind: 0.12, rest: 0.24 },
  { dmg: 26, stun: 0.9, knock: 1.6, wind: 0.2, rest: 0.4 },
];
const PAPUC_DMG = 8;
const PAPUC_STUN = { thug: 2.6, bear: 0.8 };
const REGEN_AFTER = 6; // seconds out of combat before she heals
const REGEN = 2; // hp per second

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
// Limb directions in her own frame (x = her left, y up, z forward) at the top of each blow and at its end.
const BLOWS = [
  { wind: { rArm: V(-0.55, 0.85, -0.3), rFore: V(-0.3, 1, -0.35), spine: V(0.1, 1, -0.1) }, hit: { rArm: V(-0.1, -0.25, 1), rFore: V(-0.05, -0.3, 1), spine: V(-0.1, 1, 0.4) } },
  { wind: { rArm: V(-0.95, 0.25, 0.1), rFore: V(-0.8, 0.3, 0.3), spine: V(-0.25, 1, 0) }, hit: { rArm: V(0.6, -0.1, 0.8), rFore: V(0.5, -0.1, 0.9), spine: V(0.25, 1, 0.25) } },
  { wind: { rArm: V(-0.2, 1, -0.2), rFore: V(-0.1, 1, -0.3), spine: V(0, 1, -0.2) }, hit: { rArm: V(-0.05, -0.5, 1), rFore: V(0, -0.5, 1), spine: V(0, 1, 0.45) } },
  { wind: { rArm: V(-0.1, 1, -0.7), rFore: V(0, 1, -0.6), spine: V(0, 0.85, -0.5) }, hit: { rArm: V(0.05, -0.9, 0.6), rFore: V(0.05, -0.9, 0.5), spine: V(0, 0.7, 0.7) } },
];
const THROW_POSE = { rArm: V(-0.2, 0.55, 1), rFore: V(-0.1, 0.4, 1), spine: V(0, 1, 0.25) };
const TIE_POSE = { rArm: V(-0.2, -0.1, 1), rFore: V(-0.1, -0.1, 1), spine: V(0, 1, 0.4) };

const NEUTRAL = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, swing: false, swingPressed: false, zipPressed: false, suitPressed: false, resetPressed: false, mapPressed: false, carPressed: false, attackPressed: false, throwPressed: false, tiePressed: false, interactPressed: false, pausePressed: false };

const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _near = [];

class Combat {
  constructor(game) {
    this.g = game;
    this.time = 0;
    this.fx = null;
    this.thugs = null;
    this.atk = { phase: 'idle', t: 0, dur: 0, idx: 0, next: 0, target: null, queued: false, end: -9, cool: 0 };
    this.intent = { attack: null, throw: false, tie: false, dodge: false };
    this.papucs = [];
    this.kicks = [];
    this.ties = [];
    this.tieJob = null;
    this.dodgeT = 0;
    this.dodgeCool = 0;
    this.dodgeDir = new THREE.Vector3();
    this.dodges = 0;
    this.blows = 0;
    this.throwCool = 0;
    this.lock = null;
    this.stop = 0;
    this.shake = 0;
    this.fainted = 0;
    this.faintT = 0;
    this.respawned = false;
    this.lastCombat = -99;
    this.said = {};
    this.hinted = false;
    this.lowSaid = false;
    this.over = { w: 0, rArm: new THREE.Vector3(), rFore: new THREE.Vector3(), spine: new THREE.Vector3(), key: '' };
    this.poseT = 0; // remaining time of a throw or tie gesture
    this.pose = null;
    this.dodgeOver = { w: 0.7, spine: new THREE.Vector3() };

    const self = this;
    this.health = {
      hp: 100,
      invulnerableLeft: 0,
      get max() {
        return Math.max(1, Math.round(100 * (game.perks?.maxHp ?? 1)));
      },
      // Returns the damage that went through (0 when dodging, invulnerable, already down).
      damage(n, by) {
        return self.hurt(n, by);
      },
      heal(n) {
        const before = this.hp;
        this.hp = clamp(this.hp + (n > 0 ? n : 0), 0, this.max);
        return this.hp - before;
      },
      invulnerable(t) {
        this.invulnerableLeft = Math.max(this.invulnerableLeft, t);
      },
    };
  }

  // ---------- setup ----------

  init() {
    const g = this.g;
    this.fx = new Fx(g.scene, g.sfx);
    this.thugs = new Thugs(g, this.fx);
    this.handPapuc = papucMesh();
    this.handPapuc.scale.setScalar(1.15);
    this.handPapuc.visible = false;
    g.scene.add(this.handPapuc);

    // The health bar: the number is big, the bar shows the rest.
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:200px';
    const label = document.createElement('span');
    label.textContent = 'Salute';
    label.style.cssText = 'font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85';
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:1;height:12px;min-width:90px;border-radius:6px;background:rgba(255,255,255,0.2);overflow:hidden';
    this.fill = document.createElement('div');
    this.fill.style.cssText = 'height:100%;width:100%;border-radius:6px;transition:width 0.15s';
    bar.append(this.fill);
    this.num = document.createElement('span');
    this.num.style.cssText = 'font-size:22px;font-weight:900;min-width:2.4ch;text-align:right';
    box.append(label, bar, this.num);
    g.hud.add('health', { order: 1, el: box, render: () => this.renderHud() });

    // Full screen wash: red on a hit, black while she is out.
    this.wash = document.createElement('div');
    this.wash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#000;opacity:0;transition:opacity 0.9s';
    this.hurtWash = document.createElement('div');
    this.hurtWash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(200,0,0,0.55) 100%);opacity:0;transition:opacity 0.35s';
    document.body.append(this.hurtWash, this.wash);
  }

  renderHud() {
    const h = this.health;
    const f = clamp(h.hp / h.max, 0, 1);
    this.num.textContent = Math.ceil(h.hp);
    this.fill.style.width = `${f * 100}%`;
    this.fill.style.background = `hsl(${Math.round(f * 115)},75%,48%)`;
  }

  // ---------- hooks called by main.js ----------

  // What the click, Space, Q and C mean this tick; returns the input the player will see.
  filterInput(raw) {
    const g = this.g, P = g.player;
    this.intent = { attack: null, throw: false, tie: false, dodge: false };
    if (this.fainted > 0) return { ...NEUTRAL, pausePressed: raw.pausePressed, mapPressed: raw.mapPressed, suitPressed: raw.suitPressed };
    if (g.driving?.() || !this.thugs) return raw;
    let out = raw;
    const edit = (patch) => (out = { ...out, ...patch });
    const ground = P.mode === 'ground';
    if (raw.attackPressed && ground) {
      const t = this.pickTarget(MELEE_RANGE);
      if (t) {
        this.intent.attack = t;
        edit({ swingPressed: false });
      }
    }
    if (raw.jumpPressed && ground && this.dodgeCool <= 0 && this.thugs.telegraphs().length) {
      this.intent.dodge = true;
      edit({ jumpPressed: false, jump: false });
    }
    if (raw.throwPressed) this.intent.throw = true;
    if (raw.tiePressed) this.intent.tie = true;
    // Feet planted while a blow is on its way.
    if (this.atk.phase !== 'idle' || this.tieJob || this.dodgeT > 0) edit({ moveX: (raw.moveX || 0) * 0.3, moveY: (raw.moveY || 0) * 0.3 });
    return out;
  }

  // The hit stop: for a moment the game barely moves. Counts the real step, gives back the game one.
  scaleDt(dt) {
    if (this.stop <= 0) return dt;
    this.stop -= dt;
    return dt * 0.03;
  }

  // ---------- per tick ----------

  update(dt) {
    const g = this.g, h = this.health;
    this.time += dt;
    h.invulnerableLeft = Math.max(0, h.invulnerableLeft - dt);
    this.dodgeCool -= dt;
    this.throwCool -= dt;
    if (!Number.isFinite(h.hp)) h.hp = h.max;
    h.hp = clamp(h.hp, 0, h.max);
    this.thugs.update(dt, this);
    this.fx.update(dt);
    this.stepKicks(dt);
    if (this.fainted > 0) {
      this.faintStep(dt);
      this.stepPapucs(dt);
      return;
    }
    const it = this.intent;
    this.intent = { attack: null, throw: false, tie: false, dodge: false };
    if (it.attack) this.tryAttack(it.attack);
    if (it.dodge) this.startDodge();
    if (it.throw) this.tryThrow();
    if (it.tie) this.tryTie();
    this.stepAttack(dt);
    this.stepDodge(dt);
    this.stepTie(dt);
    this.stepPapucs(dt);
    this.stepTies();
    this.stepLock();
    this.stepHero(dt);
    // Heals slowly once nobody has been at her for a while.
    if (this.thugs.engaged(20)) this.lastCombat = this.time;
    if (this.time - this.lastCombat > REGEN_AFTER && h.hp < h.max) h.hp = Math.min(h.max, h.hp + REGEN * dt);
    if (h.hp > h.max * 0.4) this.lowSaid = false;
    if (this.shake > 0.002) {
      const s = this.shake, t = this.time * 97;
      g.camera.position.x += Math.sin(t) * s;
      g.camera.position.y += Math.sin(t * 1.3 + 1) * s * 0.7;
      g.camera.position.z += Math.sin(t * 0.9 + 2) * s;
      this.shake *= Math.exp(-dt * 9);
    }
  }

  say(kind, gap = 2.5) {
    if (this.time - (this.said[kind] ?? -99) < gap) return;
    this.said[kind] = this.time;
    this.g.voice?.say?.(kind, this.g.drunk?.amount ?? 0);
  }

  // ---------- health ----------

  hurt(n, by) {
    const g = this.g, h = this.health;
    if (!(n > 0) || this.fainted > 0 || h.invulnerableLeft > 0) return 0;
    if (g.buffs?.has?.('shield')) n *= 0.5;
    const dealt = Math.min(n, h.hp);
    h.hp = clamp(h.hp - n, 0, h.max);
    this.lastCombat = this.time;
    this.shake = Math.max(this.shake, 0.25);
    this.hurtWash.style.opacity = '1';
    setTimeout(() => (this.hurtWash.style.opacity = '0'), 120);
    g.events.emit('bunica:hurt', { dmg: dealt, by });
    this.fx.sound('hurt');
    if (h.hp <= 0) {
      this.knockout(by);
      return dealt;
    }
    this.say('hurt', 3);
    if (h.hp <= h.max * 0.25 && !this.lowSaid) {
      this.lowSaid = true;
      this.say('lowHealth', 8);
    }
    return dealt;
  }

  // She has been hit hard: the blow, and the counter-move it interrupts.
  struck(a, dx, dz) {
    const P = this.g.player;
    P.vel.x += dx * 7;
    P.vel.z += dz * 7;
    this.atk.phase = 'idle';
    this.atk.queued = false;
    this.atk.next = 0;
    this.atk.end = -9;
    this.stop = Math.max(this.stop, 0.05);
  }

  // A telegraphed strike met an empty spot: the thug is thrown off balance.
  dodged(b) {
    b.a.stun(0.7);
    this.fx.puff(this.g.player.pos.x, this.g.player.pos.y + 0.2, this.g.player.pos.z, 4);
  }

  knockout(by) {
    const g = this.g;
    if (this.fainted > 0) return;
    if (g.driving?.()) g.exitCar?.(false);
    this.fainted = 2.8;
    this.faintT = 0;
    this.respawned = false;
    this.atk.phase = 'idle';
    this.atk.queued = false;
    this.tieJob = null;
    this.dodgeT = 0;
    this.lock = null;
    this.fx.lock(null);
    this.handPapuc.visible = false;
    g.hero.over = null;
    g.player.vel.set(0, g.player.vel.y, 0);
    this.wash.style.opacity = '1';
    this.fx.sound('faint');
    this.say('knockout', 0);
    g.events.emit('bunica:down', { by });
  }

  faintStep(dt) {
    const g = this.g, hero = g.hero;
    this.faintT += dt;
    this.fainted -= dt;
    const k = smooth(this.faintT / 0.45);
    hero.root.quaternion.multiply(_q.setFromAxisAngle(X, -(Math.PI / 2) * k));
    hero.root.position.y += 0.12 * k;
    this.fx.dizzy(g.player.pos.x, g.player.pos.y + 0.55 + 0.4 * k, g.player.pos.z, this.faintT);
    if (!this.respawned && this.faintT >= 1.5) this.respawn();
    if (this.fainted <= 0) {
      this.fainted = 0;
      this.wash.style.opacity = '0';
      this.health.invulnerable(2);
    }
  }

  // Wakes up on the nearest safe roof, half healed, a little poorer in respect.
  respawn() {
    const g = this.g, P = g.player, h = this.health;
    this.respawned = true;
    const r = g.city.roofNear(P.pos.x, P.pos.z, 700, P.pos.x, P.pos.z);
    const pos = r ? r.pos.clone() : P.lastSafe.clone();
    P.reset();
    P.pos.copy(pos);
    P.lastSafe.copy(pos);
    P.groundBox = r ? r.box : null;
    P.idleTime = 2;
    if (r) {
      P.facing.set(-Math.sin(r.yaw), 0, -Math.cos(r.yaw));
      g.rig.yaw = r.yaw;
    }
    h.hp = Math.ceil(h.max * 0.5);
    g.respect?.add?.(-10, 'knockout');
    this.wash.style.opacity = '0';
    g.events.emit('bunica:respawn', { pos });
  }

  // ---------- targets ----------

  hostile(a) {
    return !!a && !a.removed && a.kind === 'thug' && a.state !== 'down' && !a.tied;
  }

  // Nearest thug within r on her level with a clear line, or null.
  pickTarget(r) {
    const P = this.g.player.pos;
    let best = null, bd = Infinity;
    for (const a of this.g.actors.list) {
      if (!this.hostile(a)) continue;
      const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
      if (d > r || d >= bd || Math.abs(a.pos.y - P.y) > 2.2) continue;
      if (!clearLine(this.g.actors, P.x, P.z, a.pos.x, a.pos.z)) continue;
      best = a;
      bd = d;
    }
    return best;
  }

  stepLock() {
    const g = this.g, P = g.player.pos;
    let best = null, bs = Infinity;
    const cam = _a.set(-Math.sin(g.rig.yaw), 0, -Math.cos(g.rig.yaw));
    for (const a of g.actors.list) {
      if (!this.hostile(a)) continue;
      const dx = a.pos.x - P.x, dz = a.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d > LOCK_RANGE || Math.abs(a.pos.y - P.y) > 3) continue;
      const score = d - 3 * Math.max(0, (dx * cam.x + dz * cam.z) / (d || 1));
      if (score < bs && clearLine(g.actors, P.x, P.z, a.pos.x, a.pos.z)) (bs = score), (best = a);
    }
    this.lock = g.driving?.() ? null : best;
    this.fx.lock(this.lock, this.time);
    if (this.lock && !this.hinted) {
      this.hinted = true;
      g.hud.toast('Clic: papuc · Q: lancia · C: lega · Spazio: schiva', 4);
    }
  }

  // ---------- the papuc combo ----------

  tryAttack(target) {
    const a = this.atk;
    if (a.phase !== 'idle' || this.time < a.cool) {
      a.queued = true; // the next click waits for the blow in progress
      a.target = target;
      return;
    }
    this.beginBlow(target);
  }

  beginBlow(target) {
    const a = this.atk, P = this.g.player;
    a.idx = this.time - a.end <= COMBO_WINDOW ? a.next : 0;
    a.target = target;
    a.queued = false;
    a.phase = 'wind';
    a.t = 0;
    const d = Math.hypot(target.pos.x - P.pos.x, target.pos.z - P.pos.z);
    a.dur = Math.min(0.6, COMBO[a.idx].wind + Math.max(0, d - 1.8) / LUNGE);
    this.lastCombat = this.time;
    this.face(target);
  }

  face(t) {
    const P = this.g.player, dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.01) P.facing.set(dx / d, 0, dz / d);
  }

  stepAttack(dt) {
    const a = this.atk, P = this.g.player;
    if (a.phase === 'idle') {
      if (!a.queued || this.time < a.cool) return;
      const t = this.hostile(a.target) ? a.target : this.pickTarget(MELEE_RANGE);
      a.queued = false;
      if (t && P.mode === 'ground') this.beginBlow(t);
      return;
    }
    a.t += dt;
    if (a.phase === 'wind') {
      const T = a.target;
      if (this.hostile(T)) {
        this.face(T);
        const dx = T.pos.x - P.pos.x, dz = T.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > 1.7) this.step(P, (dx / d) * LUNGE * dt, (dz / d) * LUNGE * dt);
      }
      if (a.t >= a.dur) {
        this.resolveBlow();
        a.phase = 'rest';
        a.t = 0;
      }
    } else if (a.t >= COMBO[a.idx].rest) {
      a.phase = 'idle';
      a.end = this.time;
      a.next = (a.idx + 1) % COMBO.length;
      if (a.idx === COMBO.length - 1) a.cool = this.time + 0.35;
    }
  }

  // Move her by (dx, dz) unless something solid is there.
  step(P, dx, dz) {
    if (!this.g.actors.blocked(P.pos.x + dx, P.pos.z + dz, 0.4)) {
      P.pos.x += dx;
      P.pos.z += dz;
    }
  }

  // The moment the papuc lands: the target if it is in reach and in the clear, and whoever else is in
  // front of her (a passer-by gets hit too, and the police notice).
  resolveBlow() {
    const g = this.g, P = g.player, a = this.atk, B = COMBO[a.idx];
    const T = a.target;
    if (this.hostile(T)) this.face(T);
    const fx = P.facing.x, fz = P.facing.z;
    this.fx.sound('swoosh');
    this.say('punch', 3);
    let first = true;
    for (const v of g.actors.list) {
      if (v.removed || v.state === 'down' || v.tied) continue;
      const dx = v.pos.x - P.pos.x, dz = v.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1e-6;
      if (Math.abs(v.pos.y - P.pos.y) > 2 || d > HIT_REACH + v.radius) continue;
      const primary = v === T;
      // In front of her: a thug in a wide arc, anyone else (a passer-by) in a narrow one.
      if (!primary && (dx * fx + dz * fz) / d < (v.kind === 'thug' ? 0.2 : 0.5)) continue;
      if (!clearLine(g.actors, P.pos.x, P.pos.z, v.pos.x, v.pos.z)) continue;
      const scale = primary || v.kind === 'thug' ? 1 : 0.5;
      if (this.strike(v, B.dmg * scale, B.stun, B.knock * scale, dx / d, dz / d, first)) first = false;
    }
    if (!first) {
      this.blows++;
      this.lastCombat = this.time;
    }
  }

  // One victim of a blow or of the thrown papuc.
  strike(v, dmg, stun, knock, dx, dz, first) {
    if (this.g.buffs?.has?.('turbo')) dmg *= 2;
    if (!v.hit(dmg, 'bunica')) return false;
    if (v.state !== 'down') v.stun(stun);
    if (knock > 0) this.kicks.push({ a: v, vx: (dx * knock) / 0.15, vz: (dz * knock) / 0.15, t: 0.15 });
    this.fx.hit(v.pos.x, v.pos.y + v.height * 0.65, v.pos.z, dmg >= 20);
    this.fx.sound(v.state === 'down' ? 'down' : 'whack');
    if (first) {
      this.stop = Math.max(this.stop, 0.06);
      this.shake = Math.max(this.shake, 0.2);
    }
    if (v.kind === 'civilian' || v.kind === 'cop') {
      this.g.events.emit('heat', { amount: v.kind === 'cop' ? 1 : 0.5, why: `hit a ${v.kind}`, pos: v.pos.clone() });
    }
    return true;
  }

  stepKicks(dt) {
    const A = this.g.actors;
    for (let i = this.kicks.length - 1; i >= 0; i--) {
      const k = this.kicks[i], v = k.a;
      k.t -= dt;
      if (v.removed || k.t <= 0) {
        this.kicks.splice(i, 1);
        continue;
      }
      const nx = v.pos.x + k.vx * dt, nz = v.pos.z + k.vz * dt;
      if (!A.blocked(nx, nz, v.radius)) {
        v.pos.x = nx;
        v.pos.z = nz;
        v.pos.y = A.groundAt(nx, nz);
      }
    }
  }

  // ---------- dodge ----------

  startDodge() {
    const g = this.g, P = g.player;
    const tg = this.thugs.telegraphs();
    if (!tg.length) return;
    tg.sort((p, q) => Math.hypot(p.a.pos.x - P.pos.x, p.a.pos.z - P.pos.z) - Math.hypot(q.a.pos.x - P.pos.x, q.a.pos.z - P.pos.z));
    const t = tg[0].a;
    const ux = P.pos.x - t.pos.x, uz = P.pos.z - t.pos.z, d = Math.hypot(ux, uz) || 1;
    // Sideways to the blow: the way the stick points, else the side with room.
    const side = (s) => _b.set((-uz / d) * s, 0, (ux / d) * s);
    let s = 1;
    const cam = _c.set(Math.cos(g.rig.yaw), 0, -Math.sin(g.rig.yaw));
    const want = g.input.state.moveX || 0;
    if (want !== 0) s = Math.sign(side(1).dot(cam) * want) || 1;
    else if (!clearLine(g.actors, P.pos.x, P.pos.z, P.pos.x + (-uz / d) * 2.5, P.pos.z + (ux / d) * 2.5)) s = -1;
    this.dodgeDir.copy(side(s));
    this.dodgeT = 0.3;
    this.dodgeCool = 0.7;
    this.dodges++;
    this.health.invulnerable(0.55);
    this.fx.sound('dodge');
    this.fx.puff(P.pos.x, P.pos.y + 0.2, P.pos.z, 4);
    this.say('dodge', 2);
  }

  stepDodge(dt) {
    if (this.dodgeT <= 0) return;
    this.dodgeT -= dt;
    const P = this.g.player;
    P.vel.x = this.dodgeDir.x * 14;
    P.vel.z = this.dodgeDir.z * 14;
  }

  // ---------- the thrown papuc ----------

  tryThrow() {
    const g = this.g, P = g.player;
    const max = Math.max(1, Math.round(g.perks?.throwCount ?? 1));
    if (this.papucs.length >= max || this.throwCool > 0 || g.driving?.() || !g.hero.handWorld) return;
    const from = g.hero.handWorld(new THREE.Vector3());
    // At the lock-on target if there is one in range, else straight ahead of the camera.
    let target = this.lock && Math.hypot(this.lock.pos.x - P.pos.x, this.lock.pos.z - P.pos.z) < THROW_RANGE ? this.lock : null;
    if (!target) target = this.pickTarget(THROW_RANGE);
    const dir = target ? _a.set(target.pos.x - P.pos.x, 0, target.pos.z - P.pos.z).normalize() : _a.set(-Math.sin(g.rig.yaw), 0, -Math.cos(g.rig.yaw));
    P.facing.set(dir.x, 0, dir.z);
    const mesh = papucMesh();
    mesh.scale.setScalar(1.5);
    g.scene.add(mesh);
    this.papucs.push({ mesh, pos: from.clone(), dir: dir.clone(), target, state: 'out', dist: 0, hit: new Set(), fire: !!g.buffs?.has?.('fire'), age: 0 });
    this.throwCool = 0.25;
    this.pose = THROW_POSE;
    this.poseT = 0.3;
    this.lastCombat = this.time;
    this.fx.sound('thrown');
    this.say('thrown', 3);
  }

  // A wall (a building's side, at the height of the papuc) at this point?
  wallAt(x, y, z) {
    for (const b of this.g.city.nearby(x, z, 1, _near)) {
      if (b.kind === 'prop' || y < b.y0 || y > b.y1) continue;
      if (pointInPrism2D(x, z, b)) return true;
    }
    return false;
  }

  stepPapucs(dt) {
    const g = this.g;
    for (let i = this.papucs.length - 1; i >= 0; i--) {
      const p = this.papucs[i];
      p.age += dt;
      if (p.state === 'out') {
        const T = p.target;
        if (T && !T.removed && T.state !== 'down' && !T.tied) {
          _a.set(T.pos.x - p.pos.x, T.pos.y + T.height * 0.6 - p.pos.y, T.pos.z - p.pos.z);
          if (_a.lengthSq() > 0.01) p.dir.copy(_a.normalize());
        }
      } else {
        g.hero.handWorld(_b);
        _a.set(_b.x - p.pos.x, _b.y - p.pos.y, _b.z - p.pos.z);
        p.dir.copy(_a.lengthSq() > 1e-6 ? _a.normalize() : p.dir);
      }
      const speed = THROW_SPEED * (p.state === 'back' ? 1.2 : 1);
      const step = speed * dt;
      p.pos.addScaledVector(p.dir, step);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.set(0.9, p.age * 24, 0);
      if (p.fire) this.fx.flame(p.pos.x, p.pos.y, p.pos.z);
      if (p.state === 'out') {
        p.dist += step;
        // Whoever it meets first: the flight ends there.
        for (const a of g.actors.near(p.pos, 1.6)) {
          if (a.state === 'down' || a.tied || p.hit.has(a)) continue;
          const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
          if (Math.hypot(dx, dz) > a.radius + 0.5 || p.pos.y < a.pos.y - 0.3 || p.pos.y > a.pos.y + a.height + 0.3) continue;
          this.papucHit(p, a);
          break;
        }
        if (p.state === 'out' && (this.wallAt(p.pos.x, p.pos.y, p.pos.z) || p.dist >= THROW_RANGE)) {
          if (p.dist < THROW_RANGE) this.fx.puff(p.pos.x, p.pos.y, p.pos.z, 3);
          p.state = 'back';
        }
      } else {
        g.hero.handWorld(_b);
        if (p.pos.distanceTo(_b) < 0.8 || p.age > 4) {
          g.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.papucs.splice(i, 1);
          this.fx.sound('catch');
        }
      }
    }
  }

  papucHit(p, a) {
    p.hit.add(a);
    p.state = 'back';
    const stun = PAPUC_STUN[a.kind] ?? 1.8;
    const dx = p.dir.x, dz = p.dir.z, d = Math.hypot(dx, dz) || 1;
    if (this.strike(a, PAPUC_DMG, stun, p.fire ? 3 : 0, dx / d, dz / d, true)) {
      this.lastCombat = this.time;
      this.blows++;
    }
  }

  // ---------- tying ----------

  tryTie() {
    const g = this.g, P = g.player;
    if (this.tieJob) return;
    const near = g.actors.near(P.pos, TIE_RANGE, (a) => !a.removed && !a.tied && a.state !== 'down' && Math.abs(a.pos.y - P.pos.y) < 2.5 && clearLine(g.actors, P.pos.x, P.pos.z, a.pos.x, a.pos.z));
    const stunned = near.find((a) => a.state === 'stunned');
    if (stunned) {
      this.tieJob = { a: stunned, t: 0 };
      return;
    }
    // Only one that is stunned can be tied.
    if (near.some((a) => a.kind === 'thug')) {
      g.hud.toast('Prima stordiscilo col papuc', 1.6);
      this.fx.sound('nope');
    }
  }

  stepTie(dt) {
    const job = this.tieJob;
    if (!job) return;
    const P = this.g.player, a = job.a;
    job.t += dt;
    if (a.removed || a.state !== 'stunned' || job.t > 0.9) {
      this.tieJob = null;
      return;
    }
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    this.face(a);
    if (d > 1.8) this.step(P, (dx / d) * 14 * dt, (dz / d) * 14 * dt);
    else {
      this.tieJob = null;
      this.finishTie(a);
    }
  }

  // The thug is wound up in the clothesline and fixed to a wall, a pole or the ground.
  finishTie(a) {
    const g = this.g;
    if (!a.tie()) return;
    const P = g.player;
    // Anchor: the nearest post or wall face within 6 m, else a stake in the ground behind him.
    let best = null, bd = 6;
    const cp = {};
    for (const b of g.city.nearby(a.pos.x, a.pos.z, 6, _near)) {
      if (a.pos.y + 1 > b.y1 || a.pos.y + 0.5 < b.y0) continue;
      closestOnPrism(a.pos.x, a.pos.z, b, cp);
      const d = cp.d + (b.kind === 'prop' ? -1.5 : 0);
      if (d < bd) (bd = d), (best = { x: cp.x, z: cp.z });
    }
    if (!best) {
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
      best = { x: a.pos.x + (dx / d) * 0.9, z: a.pos.z + (dz / d) * 0.9, ground: true };
    }
    const to = _a.set(best.x, a.pos.y + (best.ground ? 0.05 : 0.7), best.z);
    const from = _b.set(a.pos.x, a.pos.y + 0.75, a.pos.z);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xf6efe0 }));
    rope.position.copy(from);
    rope.quaternion.setFromUnitVectors(Y, _c.subVectors(to, from).normalize());
    rope.scale.y = from.distanceTo(to);
    g.scene.add(rope);
    this.ties.push({ a, rope, at: this.time });
    this.pose = TIE_POSE;
    this.poseT = 0.35;
    this.shake = Math.max(this.shake, 0.08);
    this.lastCombat = this.time;
    this.fx.sound('tie');
    this.say('tie', 2);
  }

  // A tied thug is out of the game: after a few seconds he is gone with the rope.
  stepTies() {
    for (let i = this.ties.length - 1; i >= 0; i--) {
      const t = this.ties[i];
      if (t.a.removed || this.time - t.at > 8) {
        if (!t.a.removed) t.a.remove();
        this.g.scene.remove(t.rope);
        t.rope.geometry.dispose();
        t.rope.material.dispose();
        this.ties.splice(i, 1);
      }
    }
  }

  // ---------- Bunica's body ----------

  // The arm animation of a blow, a throw or a tie, and the papuc in her hand.
  stepHero(dt) {
    const g = this.g, hero = g.hero, o = this.over, a = this.atk;
    if (!hero.bones?.rHand) return;
    let want = null, w = 0;
    if (a.phase === 'wind') {
      want = BLOWS[a.idx].wind;
      w = smooth(a.t / Math.max(a.dur, 0.05));
    } else if (a.phase === 'rest') {
      want = BLOWS[a.idx].hit;
      w = 1 - smooth((a.t / COMBO[a.idx].rest - 0.55) / 0.45);
    } else if (this.poseT > 0) {
      this.poseT -= dt;
      want = this.pose;
      w = smooth(this.poseT / 0.15) * (1 - smooth((0.3 - this.poseT) / 0.1));
    } else if (this.dodgeT > 0) {
      // A lean into the sidestep.
      const lx = _a.copy(this.dodgeDir).applyQuaternion(_q.copy(hero.root.quaternion).invert());
      this.dodgeOver.spine.set(lx.x * 0.7, 1, lx.z * 0.7).normalize();
      hero.over = this.dodgeOver;
      this.handPapuc.visible = false;
      return;
    }
    if (want) {
      o.rArm.copy(want.rArm);
      o.rFore.copy(want.rFore);
      o.spine.copy(want.spine);
      o.w = w;
      hero.over = o;
    } else {
      o.w = 0;
      hero.over = null;
    }
    // The slipper in her fist, along the forearm.
    const show = !!want && w > 0.05 && want !== TIE_POSE;
    this.handPapuc.visible = show;
    if (!show) return;
    hero.bones.rHand.getWorldPosition(_d);
    hero.bones.rFore.getWorldPosition(_b);
    _b.subVectors(_d, _b).normalize();
    _c.crossVectors(Y, _b);
    if (_c.lengthSq() < 1e-4) _c.set(1, 0, 0);
    _c.normalize();
    _m.makeBasis(_c, _a.crossVectors(_b, _c), _b);
    this.handPapuc.quaternion.setFromRotationMatrix(_m);
    this.handPapuc.position.copy(_d).addScaledVector(_b, 0.03);
  }

  // ---------- test and tool helpers ----------

  spawnThug(x, z, opts = {}) {
    const g = this.g, P = g.player.pos;
    const a = g.actors.spawn('thug', { x, z }, { persist: true, yaw: opts.yaw ?? Math.atan2(P.x - x, P.z - z), exact: opts.exact, variant: opts.variant, hp: opts.hp });
    if (!a) return null;
    this.thugs.adopt(a, { bat: !!opts.bat });
    return a;
  }

  state() {
    const h = this.health;
    return {
      hp: h.hp,
      max: h.max,
      phase: this.atk.phase,
      blow: this.atk.idx,
      blows: this.blows,
      papucs: this.papucs.map((p) => p.state),
      lock: this.lock ? this.lock.id : null,
      telegraphs: this.thugs.telegraphs().length,
      dodges: this.dodges,
      fainted: this.fainted > 0,
      ties: this.ties.length,
      brains: this.thugs.brains.size,
    };
  }

  dispose() {
    this.thugs?.dispose();
    this.fx?.dispose();
    for (const p of this.papucs) this.g.scene.remove(p.mesh);
    for (const t of this.ties) this.g.scene.remove(t.rope);
    if (this.handPapuc) this.g.scene.remove(this.handPapuc);
    this.g.hud.remove('health');
    this.wash?.remove();
    this.hurtWash?.remove();
    this.g.hero.over = null;
    if (this.g.combat === this.api) this.g.combat = null;
  }
}

export function create(game) {
  const c = new Combat(game);
  game.health = c.health;
  c.api = game.combat = {
    filterInput: (raw) => c.filterInput(raw),
    scaleDt: (dt) => c.scaleDt(dt),
    spawnThug: (x, z, opts) => c.spawnThug(x, z, opts),
    adopt: (a, opts) => c.thugs.adopt(a, opts),
    clear: (x0, z0, x1, z1) => clearLine(game.actors, x0, z0, x1, z1),
    state: () => c.state(),
    get fainted() {
      return c.fainted > 0;
    },
    get lock() {
      return c.lock;
    },
    thugs: () => [...c.thugs.brains.values()],
  };
  return {
    name: 'combat',
    init: () => c.init(),
    update: (dt) => c.update(dt),
    dispose: () => c.dispose(),
  };
}
