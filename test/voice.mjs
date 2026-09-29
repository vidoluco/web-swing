// Bunica's voice: the lines, the audio pipeline and the player (priorities, two voices in turn, cooldown,
// drunk playback rate, no audio at all). Usage: node build.mjs, then PORT=5223 node test/voice.mjs
// Exit code 1 on any failure.
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { startServer, launch, PORT } from './harness.mjs';
import { LINES, KINDS, candidates } from '../src/lines.js';
import { Voice } from '../src/voice.js';
import { mulberry32 } from '../src/config.js';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// The kinds of the shared contract (wave 2 brief): every one has to be there.
const CONTRACT = ['steal', 'stealtaxi', 'stealpolice', 'stealdrunk', 'beer', 'tuica', 'wasted', 'crash', 'sunk', 'punch', 'hurt', 'knockout', 'tie', 'thrown', 'dodge', 'crimeStart', 'crimeDone', 'wanted1', 'wanted3', 'wanted5', 'busted', 'escaped', 'missionStart', 'missionDone', 'missionFail', 'levelUp', 'collect', 'tram', 'bear', 'dog', 'pigeon', 'pet.beer', 'pet.wine', 'pet.tuica', 'pet.cola', 'pet.water', 'pet.juice', 'lowHealth', 'morning', 'night', 'supreme.anagram', 'supreme.hop', 'supreme.ironic'];
const DIR = 'public/audio/voice';
const hasAudio = existsSync(`${DIR}/manifest.json`);

// ---------- the lines, straight from src/lines.js ----------
{
  const missing = CONTRACT.filter((k) => !LINES[k]);
  check('every kind of the contract has lines', missing.length === 0, { missing, kinds: KINDS.length });
  const few = CONTRACT.filter((k) => (LINES[k] || []).length < 3);
  check('every kind has at least 3 lines', few.length === 0, { few });
  const cities = ['bucharest', 'brasov'];
  const fewCity = CONTRACT.flatMap((k) => cities.filter((c) => candidates(k, c).length < 3).map((c) => `${k}@${c}`));
  check('every kind has at least 3 lines that can be said in each city', fewCity.length === 0, { fewCity });
  const bad = CONTRACT.flatMap((k) => (LINES[k] || []).map((l, n) => [k, n, l])).filter(([, , [ro, it]]) => typeof ro !== 'string' || typeof it !== 'string' || ro.trim().length < 3 || it.trim().length < 3);
  check('every line has a Romanian text and an Italian subtitle', bad.length === 0, { bad: bad.map((b) => b.slice(0, 2)) });
  const texts = Object.values(LINES).flat().flatMap(([ro, it]) => [ro, it]);
  const dashes = texts.filter((t) => /[–—]/.test(t));
  const cedilla = texts.filter((t) => /[ŞşŢţ]/.test(t));
  check('no em dash and no cedilla forms (ș and ț are the comma below ones)', dashes.length === 0 && cedilla.length === 0, { dashes, cedilla });
  const dup = Object.entries(LINES).flatMap(([k, rows]) => rows.filter((r, i) => rows.findIndex((q) => q[0] === r[0]) !== i).map((r) => `${k}: ${r[0]}`));
  check('the variants of a kind are distinct', dup.length === 0, { dup });
  const toast = (kind, city, ro, it) => candidates(kind, city).filter((l) => l.ro === ro && l.it === it);
  const heavier = (kind, city, ro) => {
    const c = candidates(kind, city), t = c.find((l) => l.ro === ro);
    return !!t && c.every((l) => l === t || l.w < t.w);
  };
  const okToast = ['tuica', 'pet.tuica'].every((k) => toast(k, 'bucharest', 'Să trăiască Bucureștiul!', 'Viva Bucarest!').length === 1 && toast(k, 'brasov', 'Să trăiască Brașovul!', 'Viva Brașov!').length === 1 && heavier(k, 'bucharest', 'Să trăiască Bucureștiul!') && heavier(k, 'brasov', 'Să trăiască Brașovul!'));
  check('the țuică toast is there in both kinds, in the right city, with the highest weight', okToast, {});
  const wrongCity = ['tuica', 'pet.tuica'].some((k) => candidates(k, 'brasov').some((l) => /Bucure/.test(l.ro)) || candidates(k, 'bucharest').some((l) => /Brașovul/.test(l.ro)));
  check('NEGATIVE: the Bucharest toast is never said in Brașov, nor the other way round', !wrongCity, {});
}

// ---------- the audio on disk ----------
if (hasAudio) {
  const man = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
  const lines = Object.entries(LINES).flatMap(([kind, rows]) => rows.map(([ro, it], n) => ({ kind, n, ro, it })));
  const listed = new Map(man.lines.map((e) => [`${e.kind}-${e.n}`, e]));
  const noEntry = lines.filter((l) => listed.get(`${l.kind}-${l.n}`)?.ro !== l.ro || listed.get(`${l.kind}-${l.n}`)?.it !== l.it);
  check('the manifest lists every line with its current Romanian and Italian text', noEntry.length === 0 && man.lines.length === lines.length, { stale: noEntry.slice(0, 5).map((l) => `${l.kind}-${l.n}`), manifest: man.lines.length, lines: lines.length });
  const noFile = lines.flatMap((l) => ['a', 'b'].filter((v) => !existsSync(`${DIR}/${l.kind}-${l.n}.${v}.mp3`)).map((v) => `${l.kind}-${l.n}.${v}`));
  check('every line has both audio files (voice a and voice b)', noFile.length === 0, { missing: noFile.slice(0, 8), count: noFile.length });
  check('the two voices are the chosen ones', man.voices?.a?.voice === 'ro-RO-AlinaNeural' && man.voices.a.rate === '-35%' && man.voices.a.pitch === '-18Hz' && man.voices?.b?.voice === 'ro-RO-EmilNeural' && man.voices.b.rate === '+0%' && man.voices.b.pitch === '+0Hz', man.voices);
  const slow = man.lines.filter((e) => Math.max(e.dur.a, e.dur.b) > 4.0 || Math.min(e.dur.a, e.dur.b) < 0.4);
  check('every line is spoken in under 4 seconds in both voices (and none is empty)', slow.length === 0, { slow: slow.map((e) => `${e.kind}-${e.n} ${e.dur.a}/${e.dur.b}`) });
} else console.log('SKIP  no audio in public/audio/voice (python3 tools/make-voice.py): the audio checks are skipped');

// ---------- the player in Node: a fake page, no audio ----------
{
  const el = { children: [], classes: new Set(), replaceChildren(...c) { this.children = c; }, classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) } };
  globalThis.document = { createElement: () => ({ textContent: '' }) };
  const make = (city = 'bucharest', seed = 1) => {
    const v = new Voice(el);
    v.attach({ cityId: city, rng: mulberry32(seed), drunk: { amount: 0 } });
    return v;
  };
  let v = make();
  check('say() of a kind with no lines is a silent no-op', v.say('no.such.kind') === false && v.current === null, {});
  check('say() shows the line: Romanian first, Italian below', v.say('beer') === true && el.classes.has('show') && el.children[0].textContent === v.current.ro && el.children[1].textContent === v.current.it && LINES.beer[v.current.n][0] === v.current.ro, { line: v.current.ro });
  v.update(1);
  check('NEGATIVE: the same kind is refused within 8 seconds', v.say('beer') === false, {});
  v.update(7.1);
  check('POSITIVE: and taken again after 8 seconds', v.say('beer') === true, {});

  v = make();
  v.say('beer');
  v.update(0.5);
  check('a fight line interrupts a chatter line: one at a time', v.say('punch') === true && v.current.kind === 'punch' && v.queue.length === 0, { current: v.current.kind });
  check('NEGATIVE: a chatter line does not interrupt a fight line, it waits its turn', v.say('tram') === true && v.current.kind === 'punch' && v.queue.length === 1, { current: v.current.kind, queue: v.queue.map((q) => q.kind) });
  v.update(v.current.left + 0.05);
  check('the waiting line is said once the fight line is over', v.current?.kind === 'tram' && v.queue.length === 0, { current: v.current?.kind });
  v.update(30);
  v.say('dog');
  v.update(1);
  v.say('bear');
  check('an equal priority line waits instead of cutting in', v.current.kind === 'dog' && v.queue.length === 1, { current: v.current.kind });
  v.update(40);
  check('a line that waited too long is dropped, and the box empties', v.current === null && v.queue.length === 0 && !el.classes.has('show'), {});

  v = make();
  const kinds = ['steal', 'beer', 'crash', 'tram', 'dog', 'night', 'morning', 'bear'];
  for (const k of kinds) {
    v.say(k);
    v.update(12);
  }
  const voices = v.log.map((l) => l.voice);
  check('two consecutive lines never use the same voice', voices.length === kinds.length && voices.every((x, i) => i === 0 || x !== voices[i - 1]) && new Set(voices).size === 2, { voices });
  v = make();
  v.say('beer');
  v.say('punch');
  v.say('hurt');
  const two = v.log.map((l) => l.voice);
  check('an interrupting line also takes the other voice', two.length === 2 && two[0] !== two[1], { two });

  // Every variant of the toast can come up, the toast most often, and only the ones of the city.
  const share = (city, kind) => {
    const vv = make(city, 42);
    const seen = {};
    for (let i = 0; i < 600; i++) {
      vv.say(kind, { force: true });
      seen[vv.current.ro] = (seen[vv.current.ro] || 0) + 1;
      vv.update(4);
    }
    return seen;
  };
  for (const [city, toast, other] of [['bucharest', 'Să trăiască Bucureștiul!', 'Brașovul'], ['brasov', 'Să trăiască Brașovul!', 'Bucureștiul']]) {
    for (const kind of ['tuica', 'pet.tuica']) {
      const seen = share(city, kind), n = Object.values(seen).reduce((a, b) => a + b, 0);
      const others = Object.entries(seen).filter(([ro]) => ro !== toast).map(([, c]) => c);
      check(`${kind} in ${city}: the toast is the most frequent variant, all the others still come up`, seen[toast] / n > 0.3 && seen[toast] > 1.4 * Math.max(...others) && Object.keys(seen).length === candidates(kind, city).length, { toast: +(seen[toast] / n).toFixed(2), variants: Object.keys(seen).length });
      check(`NEGATIVE: ${kind} in ${city} never says the other city's toast`, !Object.keys(seen).some((ro) => ro.includes(other)), {});
    }
  }
  delete globalThis.document;
}

// ---------- the player in the game ----------
const srv = await startServer();
const browser = await launch();
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver/.test(m.text())) errors.push(`[${tag}] ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
};
async function openGame(tag, before) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, tag);
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await before?.(page);
  await page.goto(`http://127.0.0.1:${PORT}/?lowq&city=bucharest&seed=5`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  return { page, requests };
}
try {
  // ----- with the audio built in -----
  const { page, requests } = await openGame('audio');
  await page.evaluate(() => window.__game.advance(0.05)); // from here the script steps the game, the display loop only draws
  await page.keyboard.press('KeyH'); // a key that does nothing, but is a user gesture: the browser lets audio start
  await page.evaluate(() => window.__game.sfx.init());
  await page.waitForTimeout(200);
  let r = await page.evaluate(() => {
    const g = window.__game, v = g.voice, out = {};
    g.advance(0.2);
    v.say('steal');
    out.subtitle = document.getElementById('say').classList.contains('show');
    out.ro = document.querySelector('#say b').textContent === v.current.ro;
    out.it = document.querySelector('#say span').textContent === v.current.it;
    out.audio = v.current.audio;
    out.file = `${v.current.kind}-${v.current.n}.${v.current.voice}.mp3`;
    out.rate = v.audio?.playbackRate;
    const fs = ['b', 'span'].map((s) => parseFloat(getComputedStyle(document.querySelector('#say ' + s)).fontSize));
    out.fonts = fs;
    out.bold = getComputedStyle(document.querySelector('#say b')).fontWeight;
    return out;
  });
  const expectAudio = hasAudio;
  await page.waitForTimeout(400);
  check('a line shows Romanian bold with the Italian below, text 13 px or more', r.subtitle && r.ro && r.it && r.fonts.every((f) => f >= 13) && +r.bold >= 700, r);
  check('with the audio built in the line has a sound file, and the game asks for it', !expectAudio || (r.audio === true && requests.some((u) => u.endsWith('/audio/voice/' + r.file))), { audio: r.audio, file: r.file });
  if (expectAudio) {
    await page.waitForTimeout(400);
    r = await page.evaluate(() => {
      const a = window.__game.voice.audio;
      return a ? { paused: a.paused, time: a.currentTime, ready: a.readyState, error: a.error?.code ?? null, rate: a.playbackRate } : null;
    });
    console.log('INFO  audio element after 0.4 s:', JSON.stringify(r));
    check('the mp3 loads and starts playing (or, if autoplay is refused, at least loads without error)', !!r && r.error === null && r.ready >= 1, r);
  }

  // Other sounds sit lower while a line is spoken, and come back after it.
  r = await page.evaluate(async () => {
    const g = window.__game, v = g.voice, gain = g.sfx.master.gain, out = {};
    g.advance(12);
    out.before = gain.value;
    v.say('crimeStart');
    out.duckFrom = v.duckFrom;
    await new Promise((ok) => setTimeout(ok, 500));
    out.state = g.sfx.ctx.state;
    out.during = gain.value;
    g.advance(8);
    out.after = v.duckFrom;
    await new Promise((ok) => setTimeout(ok, 500));
    out.back = gain.value;
    return out;
  });
  check('other audio is ducked while a line plays and restored after it', !expectAudio || (Math.abs(r.duckFrom - r.before) < 1e-6 && r.after === null && (r.state !== 'running' || (r.during < r.before * 0.8 && Math.abs(r.back - r.before) < 0.02))), r);

  r = await page.evaluate(() => {
    const g = window.__game, v = g.voice, out = {};
    g.advance(12);
    v.say('beer', { drunk: 0 });
    out.sober = v.audio?.playbackRate ?? null;
    g.advance(12);
    v.say('crash', { drunk: 1 });
    out.drunk = v.audio?.playbackRate ?? null;
    g.advance(12);
    v.say('night', { drunk: 0.5 });
    out.half = v.audio?.playbackRate ?? null;
    return out;
  });
  check('playback rate is 1.0 sober and goes down to 0.85 when very drunk', !expectAudio || (r.sober === 1 && Math.abs(r.drunk - 0.85) < 1e-6 && r.half > 0.85 && r.half < 1), r);

  r = await page.evaluate(() => {
    const g = window.__game, v = g.voice, out = {};
    g.advance(12);
    v.say('beer');
    out.beer = v.current.kind;
    g.advance(0.3);
    v.say('punch');
    out.after = v.current.kind;
    out.voices = v.log.slice(-2).map((l) => l.voice);
    out.oneAudio = !!v.audio && v.log.length > 0;
    v.say('tram');
    out.tramWaits = v.current.kind === 'punch' && v.queue.length === 1;
    g.advance(20);
    out.hidden = !document.getElementById('say').classList.contains('show') && v.current === null;
    return out;
  });
  check('in the game: a fight line interrupts chatter, the other voice takes over, a waiting chatter line does not cut in', r.beer === 'beer' && r.after === 'punch' && r.voices[0] !== r.voices[1] && r.tramWaits, r);
  check('and the subtitle box empties once everything has been said', r.hidden, r);

  r = await page.evaluate(() => {
    const g = window.__game, v = g.voice;
    g.advance(12);
    const n0 = v.log.filter((l) => l.kind === 'dog').length;
    let taken = 0;
    for (let i = 0; i < 40; i++) {
      if (v.say('dog')) taken++;
      g.advance(0.15);
    }
    return { taken, said: v.log.filter((l) => l.kind === 'dog').length - n0 };
  });
  check('NEGATIVE: a kind is taken once in 6 seconds of asking every 0.15 s', r.taken === 1 && r.said === 1, r);

  // ----- without any audio file: the bundle carries a null manifest -----
  const noAudio = (await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', target: 'es2022', minify: true, write: false, logLevel: 'silent', outfile: 'dist/game.js', define: { __VOICE__: 'null' } })).outputFiles[0].text;
  const quiet = await openGame('noaudio', (p) => p.route('**/game.js', (route) => route.fulfill({ contentType: 'text/javascript', body: noAudio })));
  r = await quiet.page.evaluate(() => {
    const g = window.__game, v = g.voice, out = {};
    out.ok = v.say('tuica') === true;
    out.subtitle = document.getElementById('say').classList.contains('show') && document.querySelector('#say b').textContent === v.current.ro;
    out.audio = v.current.audio;
    out.noElement = v.audio === null;
    g.advance(8);
    out.hides = !document.getElementById('say').classList.contains('show');
    out.other = (v.say('hurt'), v.current?.kind);
    return out;
  });
  const asked = quiet.requests.filter((u) => u.includes('/audio/'));
  check('NEGATIVE: with no audio the game runs, shows the subtitle and hides it, and asks for no audio file', r.ok && r.subtitle && r.audio === false && r.noElement && r.hides && r.other === 'hurt' && asked.length === 0, { ...r, asked });
  const ownErrors = errors.filter((e) => /^\[noaudio\]/.test(e));
  check('NEGATIVE: and no console error while doing so', ownErrors.length === 0, ownErrors);
  await quiet.page.close();
  await page.close();

  check('no console errors or page errors anywhere', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
