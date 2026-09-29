// Music from the supreme bars: a small synthesised loop (kick, hat, bass and a chord) that comes up as she
// gets near a bar and sounds muffled from the street. The places and the 100% are in drinks.js; this only
// listens. Nothing plays until the first click has made the audio context (sfx.init).
const RANGE = 70; // metres from the door where the music starts
const LOOK_AHEAD = 0.25; // seconds of notes scheduled in advance

// One flavour per bar: tempo, root note (Hz), the bass semitones for each bar of a four bar chord cycle.
const STYLE = {
  anagram: { bpm: 104, root: 55, chords: [0, 0, 7, 5] },
  hop: { bpm: 138, root: 65.41, chords: [0, 3, 5, 3] },
  ironic: { bpm: 96, root: 49, chords: [0, 5, 3, 7] },
};
const KEY_OF = [['anagram', /anagram/i], ['hop', /hop hooligans/i], ['ironic', /ironic/i]];

export function create(game) {
  let out = null, lp = null, playing = null, next = 0, step = 0, notes = 0, level = 0;

  const graph = (ctx) => {
    if (out) return;
    out = ctx.createGain();
    out.gain.value = 0;
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    out.connect(lp).connect(game.sfx.master);
  };
  // One note: an oscillator through its own envelope into the bar's output.
  const tone = (ctx, t, type, f0, f1, dur, gain) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    notes++;
  };
  const hat = (ctx, t) => {
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = game.sfx.noise;
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
    notes++;
  };
  // Sixteen steps to a bar: kick on the beat, hat between, bass on the off beats, a chord on the bar.
  const play = (ctx, t, st, s) => {
    const beat = 60 / s.bpm, i = st % 16, chord = s.chords[Math.floor(st / 16) % 4];
    const semi = (n) => s.root * 2 ** ((chord + n) / 12);
    if (i % 4 === 0) tone(ctx, t, 'sine', 130, 45, 0.22, 0.9);
    if (i % 4 === 2) hat(ctx, t);
    if ([3, 6, 10, 14].includes(i)) tone(ctx, t, 'sawtooth', semi(i === 14 ? 12 : 0), semi(i === 14 ? 12 : 0), beat * 0.4, 0.22);
    if (i === 0) for (const n of [12, 15, 19]) tone(ctx, t, 'triangle', semi(n), semi(n), beat * 3.6, 0.07);
  };

  return {
    name: 'bars',
    update() {
      const ctx = game.sfx?.ctx;
      let best = null, dist = RANGE;
      for (const s of game.drinks?.sup?.values() || []) {
        const d = Math.hypot(s.poi.x - game.player.pos.x, s.poi.z - game.player.pos.z);
        if (s.obj.visible && d < dist) (best = s), (dist = d);
      }
      const key = best && KEY_OF.find(([, re]) => re.test(best.poi.name))?.[0];
      if (!ctx || !game.sfx.noise || !key) {
        if (out) out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        level = 0;
        if (!key) playing = null;
        return;
      }
      graph(ctx);
      if (playing !== key) {
        playing = key;
        step = 0;
        next = ctx.currentTime + 0.05;
      }
      const near = 1 - dist / RANGE; // 0 at the edge, 1 at the door
      level = 0.55 * near * near;
      out.gain.setTargetAtTime(level, ctx.currentTime, 0.2);
      lp.frequency.setTargetAtTime(500 + 6000 * near * near, ctx.currentTime, 0.2);
      next = Math.max(next, ctx.currentTime);
      const spacing = 60 / STYLE[key].bpm / 4;
      while (next < ctx.currentTime + LOOK_AHEAD) {
        play(ctx, next, step++, STYLE[key]);
        next += spacing;
      }
    },
    dispose() {
      out?.disconnect();
      out = null;
    },
    // For tests: what is playing, how many notes were scheduled, how loud.
    state: () => ({ playing, notes, level }),
  };
}
