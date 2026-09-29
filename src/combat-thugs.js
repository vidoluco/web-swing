import * as THREE from 'three';
import { clamp } from './config.js';

// The golani: thugs on game.actors that walk up to Bunica, announce a strike, strike, stagger, fall
// and, when alone and hurt, run away. Only thugs marked `aggressive` (or adopted by hand) fight, so
// a thief running away with a purse is left to whoever spawned him. At most two attack at once, the
// others circle at a distance, each on its own side, so they never stack on one point.

const AGGRO = 16; // notices Bunica within this many metres
const REACH = 1.9; // fists
const BAT_REACH = 2.5;
const TELEGRAPH = 0.4; // the '!' shows this long before the blow lands
const STRIKE = 0.18;
const RECOVER = 0.55;
const ORBIT = 4.4;
const RIGHT_ARM = 11; // indices in the actors' 22 bone rig
const RIGHT_FORE = 12;
const RIGHT_HAND = 13;

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

// Point `bone` (an index in the actor's rig) along dir, given in the actor's own frame (x = its
// left, y up, z forward), blended by w. The bone points at its child at rest.
function pointBone(a, idx, x, y, z, w) {
  const bones = a.rig.bones, bone = bones[idx];
  _v.copy(bones[idx + 1].position).normalize();
  _d.set(x, y, z).normalize().applyAxisAngle(Y, a.yaw);
  bone.parent.matrixWorld.decompose(_p, _pq, _s);
  _d.applyQuaternion(_pq.invert());
  bone.quaternion.slerp(_q.setFromUnitVectors(_v, _d), w);
  // The next bone down reads this one's world matrix, so bring it up to date.
  bone.matrix.compose(bone.position, bone.quaternion, bone.scale);
  bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
}

// Is the straight line between two ground points free of buildings and water? Samples every half
// metre with the actors' own obstacle test.
export function clearLine(actors, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
  for (let k = 0.6; k < d - 0.3; k += 0.5) {
    if (actors.blocked(x0 + (dx / d) * k, z0 + (dz / d) * k, 0.05)) return false;
  }
  return true;
}

class Brain {
  constructor(a, bat, seed) {
    this.a = a;
    this.bat = bat; // the Mesh in her hand, or null
    this.state = 'idle';
    this.t = 0;
    this.cool = 0.3 + (seed % 7) * 0.08;
    this.orbit = ((seed * 2.399) % TAU); // where it waits round Bunica while others have their turn
    this.turn = -99; // when it last had a turn to attack
    this.token = false;
    this.los = true;
    this.losT = 0;
    this.fleeT = 0;
    this.pose = 0; // 0 arm down, 1 raised, -1 swung
    this.reach = bat ? BAT_REACH : REACH;
    this.dmg = bat ? 14 : 8;
    this.aim = a.yaw;
    a.hook = () => this.applyPose();
  }

  applyPose() {
    const a = this.a;
    if (!a.rig || a.rig.kind !== 'human') return;
    const p = this.pose;
    if (Math.abs(p) < 0.02) return;
    if (p > 0) {
      // Arm raised over the shoulder, body leaning back.
      pointBone(a, RIGHT_ARM, -0.3, 0.9, -0.35, p);
      pointBone(a, RIGHT_FORE, -0.15, 1, -0.1, p);
      a.rig.tilt.rotation.x -= 0.2 * p;
    } else {
      // The blow: arm forward and down, body over the front foot.
      pointBone(a, RIGHT_ARM, -0.12, -0.15, 1, -p);
      pointBone(a, RIGHT_FORE, -0.05, -0.2, 1, -p);
      a.rig.tilt.rotation.x += 0.4 * -p;
    }
  }
}

export class Thugs {
  constructor(game, fx) {
    this.game = game;
    this.fx = fx;
    this.brains = new Map();
    this.scanT = 0;
    this.batGeo = new THREE.CylinderGeometry(0.045, 0.02, 0.72, 8).translate(0, 0.36, 0);
    this.batMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });
    this.time = 0;
  }

  get actors() {
    return this.game.actors;
  }

  adopt(a, opts = {}) {
    if (this.brains.has(a)) return this.brains.get(a);
    const bat = opts.bat ?? a.bat ? new THREE.Mesh(this.batGeo, this.batMat) : null;
    if (bat) {
      bat.castShadow = true;
      bat.matrixAutoUpdate = false;
      bat.matrixWorldAutoUpdate = false;
      bat.visible = false;
      this.game.scene.add(bat);
    }
    const b = new Brain(a, bat, a.id);
    a.aggressive = true;
    this.brains.set(a, b);
    return b;
  }

  drop(a) {
    const b = this.brains.get(a);
    if (!b) return;
    a.hook = null;
    if (b.bat) this.game.scene.remove(b.bat);
    this.brains.delete(a);
  }

  // Brains that are winding up a strike near Bunica, for the dodge.
  telegraphs() {
    const P = this.game.player.pos, out = [];
    for (const b of this.brains.values()) {
      if (b.state !== 'telegraph' || b.a.removed) continue;
      if (Math.hypot(b.a.pos.x - P.x, b.a.pos.z - P.z) < 9 && Math.abs(b.a.pos.y - P.y) < 2.2) out.push(b);
    }
    return out;
  }

  // Anyone fighting, or about to, within r of Bunica: keeps the health from regenerating.
  engaged(r) {
    const P = this.game.player.pos;
    for (const b of this.brains.values()) {
      if (b.state === 'idle' || b.state === 'flee' || b.state === 'out') continue;
      if (Math.hypot(b.a.pos.x - P.x, b.a.pos.z - P.z) < r) return true;
    }
    return false;
  }

  update(dt, combat) {
    this.time += dt;
    const game = this.game, P = game.player.pos;
    // Pick up thugs that other systems marked aggressive.
    if ((this.scanT -= dt) <= 0) {
      this.scanT = 0.5;
      for (const a of this.actors.list) {
        if (a.kind === 'thug' && a.aggressive && !this.brains.has(a) && a.state !== 'down' && !a.tied) this.adopt(a);
      }
    }
    const calm = combat.fainted > 0 || game.driving?.();
    const live = [];
    for (const [a, b] of this.brains) {
      if (a.removed || a.state === 'down' || a.tied) {
        this.drop(a);
        continue;
      }
      live.push(b);
    }
    // Two at most have a turn to attack, handed round: the one that waited longest goes first. The
    // rest wait spread evenly round her, out of arm's reach.
    let free = 2;
    for (const b of live) {
      if (b.token && !['approach', 'telegraph', 'strike', 'recover'].includes(b.state)) b.token = false;
      if (b.token) free--;
    }
    const waiting = live.filter((b) => !b.token && (b.state === 'approach' || b.state === 'wait'));
    waiting.sort((p, q) => p.turn - q.turn || Math.hypot(p.a.pos.x - P.x, p.a.pos.z - P.z) - Math.hypot(q.a.pos.x - P.x, q.a.pos.z - P.z));
    for (const b of waiting) {
      if (free <= 0) break;
      b.token = true;
      b.turn = this.time;
      free--;
    }
    const idle = waiting.filter((b) => !b.token).sort((p, q) => Math.atan2(p.a.pos.x - P.x, p.a.pos.z - P.z) - Math.atan2(q.a.pos.x - P.x, q.a.pos.z - P.z));
    const step = TAU / Math.max(idle.length, 1);
    const base = idle.length ? Math.atan2(idle[0].a.pos.x - P.x, idle[0].a.pos.z - P.z) : 0;
    idle.forEach((b, i) => {
      b.orbit = wrap(base + i * step);
      b.orbitR = ORBIT + (i % 2);
    });
    let bang = 0;
    for (const b of live) {
      this.step(b, dt, calm, live, combat);
      if (b.state === 'telegraph' && bang < this.fx.bangs.length) this.fx.bang(bang++, _v.set(b.a.pos.x, b.a.pos.y + b.a.height, b.a.pos.z), this.time);
      this.placeBat(b);
    }
    for (let i = bang; i < this.fx.bangs.length; i++) this.fx.bang(i, null);
  }

  step(b, dt, calm, live, combat) {
    const a = b.a, game = this.game, P = game.player.pos;
    const dx = P.x - a.pos.x, dz = P.z - a.pos.z, d = Math.hypot(dx, dz);
    const dy = Math.abs(P.y - a.pos.y);
    const toward = Math.atan2(dx, dz);
    b.cool -= dt;
    if ((b.losT -= dt) <= 0) {
      b.losT = 0.25;
      b.los = d < 1.2 || clearLine(this.actors, a.pos.x, a.pos.z, P.x, P.z);
    }
    // Dazed or staggered: whatever it was doing is over.
    if (a.stunT > 0 || a.state === 'stunned') {
      b.state = 'stagger';
      b.pose = 0;
      return;
    }
    if (b.state === 'stagger') {
      b.state = 'approach';
      b.cool = Math.max(b.cool, 0.5);
    }
    const turn = (rate) => (a.yaw = wrap(a.yaw + clamp(wrap(toward - a.yaw), -rate * dt, rate * dt)));

    if (calm) {
      // Bunica is down or in a car: stand about.
      a.hasGoal = false;
      b.state = 'idle';
      b.pose = 0;
      return;
    }

    // Alone and hurt: run.
    const others = live.some((o) => o !== b && o.state !== 'flee' && Math.hypot(o.a.pos.x - a.pos.x, o.a.pos.z - a.pos.z) < 40);
    if (b.state !== 'flee' && !others && a.hp < a.maxHp * 0.5 && d < 25) {
      b.state = 'flee';
      b.fleeT = 9;
      b.pose = 0;
    }

    switch (b.state) {
      case 'idle':
        b.pose = 0;
        if (d < AGGRO && dy < 3 && b.los) b.state = 'approach';
        break;
      case 'approach':
      case 'wait': {
        b.pose = 0;
        if (d > AGGRO * 1.8 || dy > 6) {
          b.state = 'idle';
          break;
        }
        if (b.token) {
          b.state = 'approach';
          // Straight at her, stopping at arm's length, and not on top of the other one.
          const stop = b.reach * 0.8;
          const sep = this.separation(b, live);
          const tx = P.x - (dx / (d || 1)) * stop + sep.x * 1.6, tz = P.z - (dz / (d || 1)) * stop + sep.z * 1.6;
          const near = d < b.reach + 0.6;
          if (!near) this.actors.walkTo(a, tx, tz, d > 5 ? a.speedRun : a.speedWalk * 2);
          else a.hasGoal = false;
          if (near || d < 3) turn(9);
          if (near && b.cool <= 0 && dy < 1.8 && b.los && Math.abs(wrap(toward - a.yaw)) < 0.7) {
            b.state = 'telegraph';
            b.t = 0;
            b.aim = a.yaw;
          }
        } else {
          b.state = 'wait';
          const R = b.orbitR || ORBIT;
          const sep = this.separation(b, live);
          const tx = P.x + Math.sin(b.orbit) * R + sep.x * 1.6, tz = P.z + Math.cos(b.orbit) * R + sep.z * 1.6;
          if (Math.hypot(tx - a.pos.x, tz - a.pos.z) > 1.2) this.actors.walkTo(a, tx, tz, d > 7 ? a.speedRun : a.speedWalk * 1.6);
          else a.hasGoal = false;
          turn(4);
        }
        break;
      }
      case 'telegraph': {
        b.t += dt;
        a.hasGoal = false;
        b.pose = smooth(b.t / 0.28);
        // Keeps its eyes on Bunica for a moment, then commits to the spot.
        if (b.t < 0.22) {
          turn(10);
          b.aim = a.yaw;
        }
        if (b.t >= TELEGRAPH) {
          b.state = 'strike';
          b.t = 0;
          this.land(b, combat);
        }
        break;
      }
      case 'strike':
        b.t += dt;
        a.hasGoal = false;
        b.pose = -smooth(b.t / 0.08);
        if (b.t >= STRIKE) {
          b.state = 'recover';
          b.t = 0;
        }
        break;
      case 'recover':
        b.t += dt;
        b.pose = -(1 - smooth(b.t / RECOVER));
        if (b.t >= RECOVER) {
          b.state = 'wait';
          b.token = false; // someone else's turn
          b.cool = 0.9 + this.game.rng() * 0.8;
          b.pose = 0;
        }
        break;
      case 'flee': {
        b.pose = 0;
        b.fleeT -= dt;
        const away = Math.atan2(-dx, -dz);
        const spot = this.actors.randomWalkPoint({ x: a.pos.x + Math.sin(away) * 30, z: a.pos.z + Math.cos(away) * 30 }, 14);
        this.actors.walkTo(a, spot.x, spot.z, a.speedRun);
        if (b.fleeT <= 0 || d > 55) b.state = 'idle';
        break;
      }
    }
  }

  // A push away from the other thugs standing too close, so two never end up on one spot.
  separation(b, live) {
    const out = this.sep || (this.sep = { x: 0, z: 0 });
    out.x = out.z = 0;
    for (const o of live) {
      if (o === b) continue;
      const dx = b.a.pos.x - o.a.pos.x, dz = b.a.pos.z - o.a.pos.z, d = Math.hypot(dx, dz);
      if (d < 2.2 && d > 1e-3) {
        out.x += (dx / d) * (2.2 - d);
        out.z += (dz / d) * (2.2 - d);
      }
    }
    return out;
  }

  // The moment the blow lands: it connects only if Bunica is within reach, in front of the aim, on
  // the same level, with no wall between, and not mid-dodge.
  land(b, combat) {
    const a = b.a, P = this.game.player.pos, h = this.game.health;
    const dx = P.x - a.pos.x, dz = P.z - a.pos.z, d = Math.hypot(dx, dz);
    const inFront = Math.abs(wrap(Math.atan2(dx, dz) - b.aim)) < 0.85;
    if (d > b.reach + 0.4 || !inFront || Math.abs(P.y - a.pos.y) > 1.8 || !clearLine(this.actors, a.pos.x, a.pos.z, P.x, P.z)) return;
    if (!h || h.invulnerableLeft > 0) {
      combat.dodged(b);
      return;
    }
    if (h.damage(b.dmg, a) > 0) combat.struck(a, dx / (d || 1), dz / (d || 1));
  }

  // The bat follows the hand and points along the forearm.
  placeBat(b) {
    const a = b.a, bat = b.bat;
    if (!bat) return;
    const on = a.attached && !a.removed && a.rig?.kind === 'human';
    bat.visible = on;
    if (!on) return;
    const hand = a.rig.bones[RIGHT_HAND].matrixWorld, fore = a.rig.bones[RIGHT_FORE].matrixWorld;
    _p.setFromMatrixPosition(hand);
    _d.setFromMatrixPosition(fore);
    _d.subVectors(_p, _d).normalize();
    _q.setFromUnitVectors(Y, _d);
    const s = a.rig.group.scale.y;
    bat.matrix.compose(_p.addScaledVector(_d, -0.06), _q, _s.set(s, s, s));
    bat.matrixWorld.copy(bat.matrix);
  }

  dispose() {
    for (const a of [...this.brains.keys()]) this.drop(a);
    this.batGeo.dispose();
    this.batMat.dispose();
  }
}
