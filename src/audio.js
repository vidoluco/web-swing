// Synthesised sound: web "thwip", landing thump, and wind that rises with speed. No audio files.
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  burst(dur, f0, f1, type, gain, q = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  tone(dur, f0, f1, gain) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(ev) {
    if (!this.ctx) return;
    if (ev === 'web') {
      this.burst(0.14, 4200, 900, 'bandpass', 0.5, 3);
      this.tone(0.06, 1800, 600, 0.08);
    } else if (ev === 'land') {
      this.tone(0.25, 120, 45, 0.5);
      this.burst(0.2, 600, 150, 'lowpass', 0.3);
    } else if (ev === 'jump') {
      this.burst(0.25, 500, 1500, 'bandpass', 0.18, 1.5);
    } else if (ev === 'splash') {
      this.burst(0.6, 2000, 200, 'lowpass', 0.5);
    } else if (ev === 'wall') {
      this.burst(0.05, 1500, 800, 'bandpass', 0.2, 2);
    } else if (ev === 'horn') {
      this.square(0.45, 415, 0.07);
      this.square(0.45, 523, 0.07);
    } else if (ev === 'crash') {
      this.burst(0.5, 3000, 300, 'lowpass', 0.7);
      this.tone(0.3, 90, 40, 0.6);
    } else if (ev === 'door') {
      this.tone(0.12, 160, 70, 0.4);
      this.burst(0.08, 1200, 400, 'bandpass', 0.15, 2);
    } else if (ev === 'gulp') {
      for (let i = 0; i < 3; i++) setTimeout(() => this.tone(0.12, 260 - i * 30, 120, 0.25), i * 190);
    }
  }

  square(dur, f, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setValueAtTime(gain, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Engine drone while driving: pitch follows speed. Negative speed switches it off.
  engine(speed) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.eng) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(f).connect(g).connect(this.master);
      o.start();
      this.eng = { o, g };
    }
    const t = ctx.currentTime;
    const on = speed >= 0;
    const gear = on ? (speed % 11) / 11 : 0;
    this.eng.o.frequency.setTargetAtTime(on ? 38 + gear * 55 + speed * 0.8 : 30, t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.1 : 0, t, 0.15);
  }

  update(speed) {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, (speed - 8) / 55));
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(k * 0.35, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + k * 1800, t, 0.2);
  }
}
