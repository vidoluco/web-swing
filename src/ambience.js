import { clamp, mulberry32 } from './config.js';

// The sound of the city, all synthesised on the Web Audio context that game.sfx opens (nothing plays
// until the first click, when the browser allows it). Positional sounds go through a panner at the
// place they come from: horns of cars, the tram bell, dogs, the church bells on the hour (the Black
// Church in Brasov), manele from a passing car, a distant siren, birds in the parks, the wings of
// pigeons. Continuous ones follow the situation: the murmur of the traffic follows how many cars are
// near, the wind at height follows how high she is. The whole mix ducks when game.voice speaks, so
// it never fights the lines. Other systems only emit events; this is the one place that makes noise.

const TAU = Math.PI * 2;

// Named churches of the OSM data, as building centres (x, z from the origin), and the deep note of each bell.
const CHURCHES = {
  bucharest: [
    { name: 'Sfanta Ecaterina', x: -62, z: 249, f: 247 },
    { name: 'Manastirea Radu Voda', x: 419, z: 310, f: 220 },
    { name: 'Patriarhia', x: -413, z: 261, f: 196 },
    { name: 'Biserica Doamnei', x: -274, z: -858, f: 262 },
    { name: 'Sfantul Nicolae Ghica', x: -56, z: -774, f: 233 },
    { name: 'Sfantul Dumitru', x: 88, z: 550, f: 208 },
  ],
  brasov: [{ name: 'Biserica Neagra', x: -42.3, z: 186.9, f: 175 }],
};

// ---------- voices: synthesis only, on any BaseAudioContext, so a test can render them offline ----------

const noises = new WeakMap();
function noiseBuf(ctx) {
  let b = noises.get(ctx);
  if (!b) {
    const n = ctx.sampleRate * 2, d = (b = ctx.createBuffer(1, n, ctx.sampleRate)).getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    noises.set(ctx, b);
  }
  return b;
}

function noise(ctx, t, dur, off = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf(ctx);
  s.start(t, off % 1.5);
  s.stop(t + dur);
  return s;
}

// A sine or saw that decays: the building block of the bells.
function tone(ctx, dest, t, f, peak, dur, type = 'sine', attack = 0.004) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const VOICES = {
  // A tram bell: a bright clang with inharmonic partials.
  bell(ctx, dest, t, o = {}) {
    const f = o.f || 1180;
    for (const [k, g, d] of [[1, 0.5, 0.9], [2.76, 0.3, 0.55], [5.4, 0.16, 0.3], [8.9, 0.07, 0.15]]) tone(ctx, dest, t, f * k, g * 0.5, d);
  },

  // A church bell: a deep hum and prime with a minor third, long decay. o.f is the prime in Hz.
  church(ctx, dest, t, o = {}) {
    const f = o.f || 220;
    for (const [k, g, d] of [[0.5, 0.35, 6.5], [1, 0.6, 5.2], [1.2, 0.35, 4.2], [1.5, 0.2, 3.2], [2, 0.3, 2.8], [2.5, 0.12, 2.1], [3, 0.1, 1.6], [4.2, 0.06, 1.1]]) tone(ctx, dest, t, f * k, g * 0.55, d, 'sine', 0.008);
    // The clapper's knock.
    const n = noise(ctx, t, 0.08), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(lp).connect(g).connect(dest);
  },

  // A car horn: two square waves a major third apart through a low pass.
  horn(ctx, dest, t, o = {}) {
    const f = o.f || 420, dur = o.dur || 0.4;
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.02);
    g.gain.setValueAtTime(0.14, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g).connect(dest);
    for (const k of [1, 1.26]) {
      const os = ctx.createOscillator();
      os.type = 'square';
      os.frequency.value = f * k;
      os.connect(lp);
      os.start(t);
      os.stop(t + dur + 0.05);
    }
  },

  // A dog: two or three short barks (a saw through a formant), or a yelp when it runs off.
  bark(ctx, dest, t, o = {}) {
    if (o.yelp) {
      const os = ctx.createOscillator(), g = ctx.createGain();
      os.frequency.setValueAtTime(900, t);
      os.frequency.linearRampToValueAtTime(1700, t + 0.09);
      os.frequency.linearRampToValueAtTime(700, t + 0.26);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      os.connect(g).connect(dest);
      os.start(t);
      os.stop(t + 0.3);
      return;
    }
    const pitch = o.pitch || 1;
    const n = o.n || 2;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.17;
      const os = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      os.type = 'sawtooth';
      os.frequency.setValueAtTime(250 * pitch, s);
      os.frequency.exponentialRampToValueAtTime(150 * pitch, s + 0.11);
      bp.type = 'bandpass';
      bp.frequency.value = 780 * pitch;
      bp.Q.value = 2.5;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.45, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.13);
      os.connect(bp).connect(g).connect(dest);
      os.start(s);
      os.stop(s + 0.15);
      const nz = noise(ctx, s, 0.06, i), hp = ctx.createBiquadFilter(), ng = ctx.createGain();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      ng.gain.setValueAtTime(0.12, s);
      ng.gain.exponentialRampToValueAtTime(0.001, s + 0.06);
      nz.connect(hp).connect(ng).connect(dest);
    }
  },

  // A bear: a low growl, saw and noise pushed through a soft clipper.
  roar(ctx, dest, t) {
    const os = ctx.createOscillator(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    os.type = 'sawtooth';
    os.frequency.setValueAtTime(85, t);
    os.frequency.linearRampToValueAtTime(48, t + 1.2);
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 3);
    sh.curve = curve;
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    os.connect(sh).connect(lp).connect(g).connect(dest);
    os.start(t);
    os.stop(t + 1.35);
    const n = noise(ctx, t, 1.2), nl = ctx.createBiquadFilter(), ng = ctx.createGain();
    nl.type = 'lowpass';
    nl.frequency.value = 380;
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    n.connect(nl).connect(ng).connect(dest);
  },

  // A bird phrase: a few short rising or falling chirps.
  chirp(ctx, dest, t, o = {}) {
    const n = o.n || 3, base = o.f || 3200;
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.09 + (i % 2) * 0.03), f = base * (1 + ((i * 7) % 5) * 0.06);
      const os = ctx.createOscillator(), g = ctx.createGain();
      os.frequency.setValueAtTime(f, s);
      os.frequency.exponentialRampToValueAtTime(f * (i % 2 ? 0.78 : 1.3), s + 0.07);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.07, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      os.connect(g).connect(dest);
      os.start(s);
      os.stop(s + 0.1);
    }
  },

  // Wings of pigeons taking off: noise chopped at the flap rate.
  flutter(ctx, dest, t) {
    const n = noise(ctx, t, 1.5), bp = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    g.gain.setValueAtTime(0, t);
    lfo.frequency.value = 15;
    depth.gain.value = 0.22;
    lfo.connect(depth).connect(g.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.8, t + 0.12);
    env.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    n.connect(bp).connect(g).connect(env).connect(dest);
    lfo.start(t);
    lfo.stop(t + 1.55);
  },

  // The pneumatic hiss of tram doors.
  hiss(ctx, dest, t) {
    const n = noise(ctx, t, 0.6), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    n.connect(hp).connect(g).connect(dest);
  },

  // A two-tone siren, o.dur seconds long with a slow swell; returns the output gain so it can be moved.
  siren(ctx, dest, t, o = {}) {
    const dur = o.dur || 8;
    const os = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    os.type = 'square';
    for (let s = 0, hi = false; s < dur; s += 0.6, hi = !hi) os.frequency.setTargetAtTime(hi ? 960 : 690, t + s, 0.03);
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    os.connect(lp).connect(g).connect(dest);
    os.start(t);
    os.stop(t + dur + 0.05);
    return g;
  },
};

// Manele: the sound a car stereo makes, in Phrygian dominant on A (a keyboard lead, a bass and a
// darbuka), one 16th note at a time. Scale steps in semitones above the root.
const SCALE = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16, 17, 19];
function maneleStep(ctx, dest, t, step, m) {
  const dur = m.beat;
  const f = (semi) => 110 * Math.pow(2, semi / 12);
  const note = m.motif[step % m.motif.length];
  if (note >= 0) {
    for (const det of [-6, 6]) {
      const os = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      os.type = 'sawtooth';
      os.frequency.value = f(12 + SCALE[note]);
      os.detune.value = det;
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.7);
      os.connect(lp).connect(g).connect(dest);
      os.start(t);
      os.stop(t + dur * 1.8);
    }
  }
  // Drum pattern of 16: dum on 0, 6, 8, 11, tek on 4, 12, 14, a soft ka between.
  const k = step % 16;
  if (k === 0 || k === 6 || k === 8 || k === 11) {
    const os = ctx.createOscillator(), g = ctx.createGain();
    os.frequency.setValueAtTime(140, t);
    os.frequency.exponentialRampToValueAtTime(52, t + 0.16);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    os.connect(g).connect(dest);
    os.start(t);
    os.stop(t + 0.22);
  } else if (k === 4 || k === 12 || k === 14 || k % 4 === 2) {
    const n = noise(ctx, t, 0.06, step), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = k % 4 === 2 ? 4200 : 2200;
    g.gain.setValueAtTime(k % 4 === 2 ? 0.1 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(hp).connect(g).connect(dest);
  }
  if (k % 8 === 0) tone(ctx, dest, t, f(SCALE[0] - 12), 0.35, dur * 5, 'sine', 0.01); // bass
}

// ---------- the system ----------

export function create(game) {
  // ?living=0 switches the living city off, for tests of the layers below it.
  if (game.params.get('living') === '0') return { name: 'ambience' };
  const stats = { req: {}, played: {}, strikes: 0, hours: 0 };
  let ctx = null;
  let out = null; // the ambience bus: duck, then compressor, then the game's own master
  let duck = null;
  let murmur = null; // { lp, gain }
  let wind = null; // { bp, gain }
  let rumble = null; // { gain, panner }
  let manele = null; // the car that plays music
  let siren = null;
  let off = [];
  // Own random stream, so the shared game.rng stays as it is for the tests (and the other systems).
  const rng = mulberry32((+game.params.get('seed') || 20260929) + 105);
  let level = { traffic: 0, wind: 0, park: 0, day: 1 };
  let slowT = 0;
  let hornT = 5;
  let sirenT = 40;
  let birdT = 3;
  let dogT = 20;
  let maneleT = 4;
  let barks = 4;
  let lastHour = -1;
  const cars = new WeakMap();

  const hoursNow = () => game.env?.hours ?? (12 + game.time / 60) % 24;
  const speaking = () => {
    const v = game.voice;
    return !!(v && (v.speaking ?? v.isSpeaking?.() ?? v.playing ?? v.t > 0));
  };

  // ---------- graph ----------

  function build() {
    ctx = game.sfx.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    out = ctx.createGain();
    out.gain.value = 1;
    duck = ctx.createGain();
    duck.gain.value = 1;
    out.connect(duck).connect(comp).connect(game.sfx.master || ctx.destination);
    // The murmur of the traffic and the wind at height are noise loops through filters.
    const loop = (hz, q, type) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf(ctx);
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(out);
      s.start(0, rng() * 1.5);
      return { f, g };
    };
    murmur = loop(300, 0.7, 'lowpass');
    wind = loop(520, 1.6, 'bandpass');
    // The rumble of the nearest tram.
    const r = loop(160, 0.9, 'lowpass');
    r.g.disconnect();
    const p = panner(0, 0, 0, 30, 1.2);
    r.g.connect(p);
    rumble = { f: r.f, g: r.g, p };
  }

  function setPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  function panner(x, y, z, ref = 15, roll = 1.3) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 3000;
    setPos(p, x, y, z);
    p.connect(out);
    return p;
  }

  // One sound at a place. `kind` is a key of VOICES; it is counted even when no audio is running yet.
  function play(kind, x, y, z, o = {}, delay = 0) {
    stats.req[kind] = (stats.req[kind] || 0) + 1;
    if (!ctx || ctx.state === 'closed') return null;
    const p = panner(x, y, z, o.ref ?? 20, o.roll ?? 1.3);
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    g.connect(p);
    VOICES[kind](ctx, g, ctx.currentTime + delay + 0.01, o);
    // The panner lives as long as the sound; drop it afterwards.
    setTimeout(() => {
      try {
        p.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    }, (delay + (o.life ?? 8)) * 1000);
    stats.played[kind] = (stats.played[kind] || 0) + 1;
    return p;
  }

  // ---------- situation ----------

  function trafficLevel(px, pz, py) {
    let s = 0;
    for (const c of game.traffic.cars) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < 150) s += (0.25 + Math.min(1, Math.abs(c.speed) / 12)) / (1 + d / 22);
    }
    // Less of it up on a roof, more diffuse.
    return clamp(s / 6, 0, 1) / (1 + Math.max(0, py - 15) / 70);
  }

  // Inside a green area, or near one: the birds sing there.
  function parkLevel(px, pz) {
    let best = 0;
    for (let cx = Math.floor((px - 100) / 200); cx <= Math.floor((px + 100) / 200); cx++) {
      for (let cz = Math.floor((pz - 100) / 200); cz <= Math.floor((pz + 100) / 200); cz++) {
        const c = game.city.mmCells.get(cx * 1000 + cz);
        if (!c) continue;
        for (const ring of c.g) {
          let inside = false, d = Infinity;
          for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
            const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
            if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
            d = Math.min(d, Math.hypot(xi - px, zi - pz));
          }
          best = Math.max(best, inside ? 1 : d < 60 ? 0.5 : 0);
          if (best === 1) return 1;
        }
      }
    }
    return best;
  }

  function slow(px, py, pz) {
    level.traffic = trafficLevel(px, pz, py);
    level.wind = clamp((py - 25) / 120, 0, 1);
    level.park = parkLevel(px, pz);
    const h = hoursNow();
    level.day = h > 5.5 && h < 20.5 ? 1 : 0.06;
    if (!ctx) return;
    const t = ctx.currentTime;
    murmur.g.gain.setTargetAtTime(0.03 + 0.3 * level.traffic, t, 0.6);
    murmur.f.frequency.setTargetAtTime(240 + 520 * level.traffic, t, 0.6);
    wind.g.gain.setTargetAtTime(0.32 * level.wind * level.wind, t, 0.5);
    wind.f.frequency.setTargetAtTime(380 + 500 * level.wind + Math.sin(game.time * 0.4) * 120, t, 0.5);
    // The nearest tram rumbles.
    const T = game.systems.get('trams');
    let best = null, bd = 160;
    for (const tr of T?.trams || []) {
      const d = Math.hypot(tr.fx - px, tr.fz - pz);
      if (d < bd) (bd = d), (best = tr);
    }
    if (best) {
      const u = best.units[0];
      setPos(rumble.p, u.cx, 1, u.cz);
      rumble.g.gain.setTargetAtTime(0.18 * Math.min(1, best.v / 6), t, 0.4);
    } else rumble.g.gain.setTargetAtTime(0, t, 0.5);
  }

  // A car that plays manele: about one in seven, decided once for every car.
  function maneleCar(c) {
    let m = cars.get(c);
    if (m === undefined) cars.set(c, (m = rng() < 0.15));
    return m;
  }

  function startManele(c) {
    const motif = [];
    let n = 4;
    for (let i = 0; i < 16; i++) {
      n = clamp(n + ((rng() * 5) | 0) - 2, 0, SCALE.length - 1);
      motif.push(rng() < 0.28 ? -1 : n);
    }
    const p = panner(c.x, 1.2, c.z, 10, 1.3);
    const g = ctx.createGain();
    // Small speakers: nothing below 150 Hz to speak of, nothing above 5 kHz, and a little grit.
    const bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 4800;
    hp.type = 'highpass';
    hp.frequency.value = 150;
    g.gain.value = 0.55;
    g.connect(hp).connect(bp).connect(p);
    manele = { car: c, p, g, motif, beat: 60 / 104 / 4, t: ctx.currentTime + 0.1, step: 0 };
    stats.played.manele = (stats.played.manele || 0) + 1;
    stats.req.manele = (stats.req.manele || 0) + 1;
  }

  function stopManele() {
    if (!manele) return;
    const m = manele;
    m.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => {
      try {
        m.p.disconnect();
        m.g.disconnect();
      } catch {
        /* gone */
      }
    }, 3000);
    manele = null;
  }

  function updateManele(dt, px, pz) {
    if (manele) {
      const c = manele.car, d = Math.hypot(c.x - px, c.z - pz);
      if (!game.traffic.cars.includes(c) || d > 130 || c.mode === 'parked') return stopManele();
      setPos(manele.p, c.x, 1.2, c.z);
      // A little ahead of the clock, so a stutter in the frame rate does not become a gap in the music.
      while (manele.t < ctx.currentTime + 0.25) {
        maneleStep(ctx, manele.g, manele.t, manele.step++, manele);
        manele.t += manele.beat;
      }
    } else if (ctx && (maneleT -= dt) <= 0) {
      maneleT = 2;
      let best = null, bd = 100;
      for (const c of game.traffic.cars) {
        const d = Math.hypot(c.x - px, c.z - pz);
        if (d > 25 && d < bd && c.mode === 'traffic' && Math.abs(c.speed) > 2 && maneleCar(c)) (bd = d), (best = c);
      }
      if (best) startManele(best);
    }
  }

  // ---------- church bells ----------

  function churchesNear(px, pz) {
    return (CHURCHES[game.cityId] || []).filter((c) => Math.hypot(c.x - px, c.z - pz) < 1500).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz)).slice(0, 2);
  }

  // n strokes from the nearest churches, 2.6 s apart.
  function strike(n, list) {
    const at = list || churchesNear(game.player.pos.x, game.player.pos.z);
    stats.strikes += n * at.length;
    at.forEach((c, k) => {
      for (let i = 0; i < n; i++) play('church', c.x, 30, c.z, { f: c.f, ref: 90, roll: 0.9, gain: 1.6 - k * 0.4, life: 12 }, i * 2.6 + k * 0.35);
    });
  }

  // ---------- events ----------

  function init() {
    const on = (name, fn) => off.push(game.events.on(name, fn));
    on('tram:bell', (e) => play('bell', e.x, e.y, e.z, { ref: 35, roll: 1.1, gain: 1.4, life: 3 }));
    on('tram:stop', (e) => play('hiss', e.x, 1.5, e.z, { ref: 20, life: 3 }, 0.6));
    on('dog:bark', (e) => {
      if (barks <= 0) return;
      barks--;
      play('bark', e.x, e.y ?? 0.6, e.z, { yelp: !!e.yelp, pitch: 0.85 + rng() * 0.4, n: rng() < 0.3 ? 3 : 2, ref: 14, life: 3 });
    });
    on('bear:roar', (e) => play('roar', e.x, e.y ?? 1.2, e.z, { ref: 25, roll: 1.1, gain: 1.2, life: 4 }));
    on('pigeons:lift', (e) => play('flutter', e.x, e.y ?? 1, e.z, { ref: 12, life: 3 }));
  }

  function onCityChange() {
    lastHour = -1;
    dogT = 15;
  }

  function update(dt) {
    const pl = game.player, px = pl.pos.x, py = pl.pos.y, pz = pl.pos.z;
    barks = Math.min(5, barks + dt * 5);
    if (!ctx && game.sfx.ctx) build();
    if ((slowT -= dt) <= 0) {
      slowT = 0.25;
      slow(px, py, pz);
    }
    if (!ctx) return;
    const t = ctx.currentTime;
    // Listener: the camera.
    const cam = game.camera, L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = cam.position.x;
      L.positionY.value = cam.position.y;
      L.positionZ.value = cam.position.z;
      const d = dirOf(cam);
      L.forwardX.value = d[0];
      L.forwardY.value = d[1];
      L.forwardZ.value = d[2];
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      const d = dirOf(cam);
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(d[0], d[1], d[2], 0, 1, 0);
    }
    // Everything steps aside for the lines Bunica says.
    duck.gain.setTargetAtTime(speaking() ? 0.4 : 1, t, speaking() ? 0.12 : 0.8);

    // Church bells on the hour.
    const h = hoursNow(), hr = Math.floor(h);
    if (lastHour >= 0 && hr !== lastHour) {
      stats.hours++;
      strike(hr % 12 || 12);
    }
    lastHour = hr;

    // A horn now and then from a moving car nearby, more often when the traffic is thick.
    if ((hornT -= dt) <= 0) {
      hornT = (4 + rng() * 9) / (0.3 + level.traffic);
      const near = game.traffic.cars.filter((c) => c.mode === 'traffic' && Math.abs(c.speed) > 1 && Math.hypot(c.x - px, c.z - pz) < 110 && Math.hypot(c.x - px, c.z - pz) > 15);
      if (near.length) {
        const c = near[(rng() * near.length) | 0], f = 380 + rng() * 120;
        play('horn', c.x, 1.2, c.z, { f, dur: 0.25 + rng() * 0.3, ref: 25, life: 2 });
        if (rng() < 0.25) play('horn', c.x, 1.2, c.z, { f, dur: 0.4, ref: 25, life: 2 }, 0.45);
      }
    }

    updateManele(dt, px, pz);

    // A siren far off, a few times an hour; it drifts across.
    if (!siren && (sirenT -= dt) <= 0) {
      sirenT = 40 + rng() * 80;
      const a = rng() * TAU, r = 320 + rng() * 250, dur = 6 + rng() * 4;
      const p = panner(px + Math.sin(a) * r, 5, pz + Math.cos(a) * r, 60, 1);
      const g = ctx.createGain();
      g.connect(p);
      VOICES.siren(ctx, g, t + 0.05, { dur });
      siren = { p, g, t0: game.time, dur, x0: px + Math.sin(a) * r, z0: pz + Math.cos(a) * r, dx: Math.cos(a) * (rng() < 0.5 ? 1 : -1) * 260, dz: -Math.sin(a) * 260 };
      stats.req.siren = (stats.req.siren || 0) + 1;
      stats.played.siren = (stats.played.siren || 0) + 1;
    } else if (siren) {
      const k = (game.time - siren.t0) / siren.dur;
      setPos(siren.p, siren.x0 + siren.dx * k, 5, siren.z0 + siren.dz * k);
      if (k > 1.05) {
        siren.p.disconnect();
        siren.g.disconnect();
        siren = null;
      }
    }

    // Birds in the parks, in daylight.
    if ((birdT -= dt) <= 0) {
      birdT = 0.4 + rng() * 1.6;
      if (level.park > 0 && rng() < level.park * level.day) {
        const a = rng() * TAU, r = 6 + rng() * 30;
        play('chirp', px + Math.sin(a) * r, py + 4 + rng() * 6, pz + Math.cos(a) * r, { n: 2 + ((rng() * 4) | 0), f: 2600 + rng() * 1800, ref: 6, roll: 1.6, gain: 1, life: 2 });
      }
    }

    // A dog barks somewhere in the dark, now and then.
    if ((dogT -= dt) <= 0) {
      dogT = 18 + rng() * 40;
      if (level.day < 0.5 || rng() < 0.4) {
        const a = rng() * TAU, r = 90 + rng() * 160;
        play('bark', px + Math.sin(a) * r, 0.6, pz + Math.cos(a) * r, { n: 2 + ((rng() * 3) | 0), pitch: 0.8 + rng() * 0.5, ref: 14, life: 3 });
      }
    }
  }

  const _d = [0, 0, -1];
  function dirOf(cam) {
    // The camera looks down its own -z.
    const q = cam.quaternion, x = q.x, y = q.y, z = q.z, w = q.w;
    _d[0] = -2 * (x * z + w * y);
    _d[1] = -2 * (y * z - w * x);
    _d[2] = -(1 - 2 * (x * x + y * y));
    return _d;
  }

  function dispose() {
    for (const f of off) f();
    off = [];
    stopManele();
    try {
      out?.disconnect();
    } catch {
      /* gone */
    }
    ctx = null;
  }

  return { name: 'ambience', init, onCityChange, update, dispose, stats, voices: VOICES, play, strike, hoursNow, churchesNear, level, startManele, triggerSiren: () => (sirenT = 0), state: () => ({ built: !!ctx, ctx: ctx?.state ?? null, manele: !!manele, siren: !!siren, duck: duck?.gain.value ?? null, murmur: murmur?.g.gain.value ?? null, wind: wind?.g.gain.value ?? null, rumble: rumble?.g.gain.value ?? null }) };
}
