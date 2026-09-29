import { candidates } from './lines.js';
import { clamp } from './config.js';

// Durations of the generated audio, { 'kind-n': [voice a, voice b] } in seconds, put in by build.mjs from
// public/audio/voice/manifest.json. It is null when the audio was never generated (tools/make-voice.py):
// the game then shows the subtitles only and asks for no file at all.
const AUDIO = typeof __VOICE__ !== 'undefined' ? __VOICE__ : null;

const VOICES = ['a', 'b'];
const COOLDOWN = 8; // seconds before a kind may be said again
const QUEUE_MAX = 3;
const QUEUE_STALE = 5; // a line that waited this long is no longer about what is happening

// 2 fights and set pieces, 1 events, 0 chatter. A higher priority interrupts the line being said, an equal
// or lower one waits its turn. Unlisted kinds are chatter.
const PRIORITY = {
  punch: 2, hurt: 2, knockout: 2, tie: 2, thrown: 2, dodge: 2, lowHealth: 2,
  'supreme.anagram': 2, 'supreme.hop': 2, 'supreme.ironic': 2,
  wasted: 1, crash: 1, sunk: 1, crimeStart: 1, crimeDone: 1, wanted1: 1, wanted3: 1, wanted5: 1, busted: 1, escaped: 1,
  missionStart: 1, missionDone: 1, missionFail: 1, levelUp: 1, bear: 1, dog: 1,
};

// Subtitle (Romanian bold, Italian below) and, when the mp3 files exist, the voice: the two voices take turns,
// and the more drunk she is the slower she speaks (playbackRate 1 down to 0.85).
// game.voice.say(kind, opts) is the whole interface: opts { drunk 0..1, city, priority, force }, a plain number
// is taken as drunk. A kind with no lines is a silent no-op. Returns true when the line was taken.
export class Voice {
  constructor(el) {
    this.el = el;
    this.game = null;
    this.now = 0; // game seconds, from update()
    this.last = {}; // kind -> when it was last taken
    this.lastN = {}; // kind -> the variant said last, so it does not repeat
    this.turn = 0; // which of the two voices speaks next
    this.current = null; // { kind, n, voice, ro, it, priority, left, audio }
    this.lastLine = null; // the Romanian text of the line said last, still there after it ends
    this.queue = [];
    this.log = []; // the lines that started, oldest first (for tests)
    this.audio = null;
    this.duckFrom = null;
  }

  // Called by main.js once the game object exists: gives the voice the drunkenness, the city, the sfx and rng.
  attach(game) {
    this.game = game;
  }

  say(kind, opts) {
    if (typeof opts === 'number') opts = { drunk: opts };
    opts = opts || {};
    const list = candidates(kind, opts.city ?? this.game?.cityId);
    if (!list.length) return false;
    if (!opts.force && this.now - (this.last[kind] ?? -Infinity) < COOLDOWN) return false;
    this.last[kind] = this.now;
    const line = this.pick(kind, list);
    const req = { ...line, priority: opts.priority ?? PRIORITY[kind] ?? 0, drunk: clamp(opts.drunk ?? this.game?.drunk?.amount ?? 0, 0, 1), at: this.now };
    if (!this.current || req.priority > this.current.priority) this.start(req);
    else this.enqueue(req);
    return true;
  }

  // Weighted pick among the lines of the city, never the variant said last time when there is another.
  pick(kind, list) {
    const pool = list.length > 1 ? list.filter((l) => l.n !== this.lastN[kind]) : list;
    let r = (this.game?.rng?.() ?? Math.random()) * pool.reduce((s, l) => s + l.w, 0);
    let line = pool[pool.length - 1];
    for (const l of pool) {
      if ((r -= l.w) < 0) {
        line = l;
        break;
      }
    }
    this.lastN[kind] = line.n;
    return line;
  }

  enqueue(req) {
    this.queue.push(req);
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    this.queue.length = Math.min(this.queue.length, QUEUE_MAX);
  }

  start(req) {
    this.stopAudio();
    const voice = VOICES[this.turn++ % 2];
    const rate = 1 - 0.15 * req.drunk;
    const secs = AUDIO?.[`${req.kind}-${req.n}`]?.[voice === 'a' ? 0 : 1] || 0;
    this.current = { kind: req.kind, n: req.n, voice, ro: req.ro, it: req.it, priority: req.priority, audio: secs > 0, rate, left: secs > 0 ? secs / rate + 0.6 : 2.2 + req.ro.length * 0.055 };
    this.lastLine = req.ro;
    this.log.push({ kind: req.kind, n: req.n, voice, at: this.now });
    if (this.log.length > 60) this.log.shift();
    const b = document.createElement('b');
    b.textContent = req.ro;
    const s = document.createElement('span');
    s.textContent = req.it;
    this.el.replaceChildren(b, s);
    this.el.classList.add('show');
    if (secs > 0) this.playAudio(req, voice, rate);
    else this.duck(false);
  }

  playAudio(req, voice, rate) {
    if (typeof Audio === 'undefined') return;
    const a = new Audio(`audio/voice/${req.kind}-${req.n}.${voice}.mp3`);
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
    // Once the sound really ends the subtitle follows soon after, even if the game runs slower than real time.
    a.addEventListener('ended', () => {
      if (this.audio === a && this.current) this.current.left = Math.min(this.current.left, 0.5);
    });
    this.audio = a;
    // Autoplay can still be refused before the first click; the subtitle is there anyway.
    a.play()?.catch(() => {});
    this.duck(true);
  }

  stopAudio() {
    this.audio?.pause();
    this.audio = null;
  }

  // Other sounds sit lower while a line is spoken (sfx.master is the gain everything goes through).
  duck(on) {
    const sfx = this.game?.sfx, g = sfx?.master?.gain;
    if (!g || !sfx.ctx) return;
    if (on && this.duckFrom === null) this.duckFrom = g.value;
    if (this.duckFrom === null) return;
    g.setTargetAtTime(on ? this.duckFrom * 0.55 : this.duckFrom, sfx.ctx.currentTime, 0.06);
    if (!on) this.duckFrom = null;
  }

  update(dt) {
    this.now += dt;
    if (this.current && (this.current.left -= dt) <= 0) {
      this.stopAudio();
      this.duck(false);
      this.current = null;
      this.el.classList.remove('show');
    }
    if (this.current) return;
    this.queue = this.queue.filter((r) => this.now - r.at <= QUEUE_STALE);
    if (this.queue.length) this.start(this.queue.shift());
  }
}
