// The audio that tools/make-voice.py generated, as build.mjs embeds it in the bundle: { 'kind-n': [seconds of
// voice a, seconds of voice b] }, only for lines whose text has not changed since and whose files exist.
// It is null when the audio was never generated (public/audio/voice is git ignored), and then the game
// shows the subtitles only and never asks for a file.
import { existsSync, readFileSync } from 'node:fs';
import { LINES } from '../src/lines.js';

export function voiceEmbed(root = new URL('../', import.meta.url).pathname) {
  const dir = `${root}public/audio/voice`;
  if (!existsSync(`${dir}/manifest.json`)) return null;
  const out = {};
  for (const e of JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')).lines) {
    if (LINES[e.kind]?.[e.n]?.[0] !== e.ro) continue;
    const secs = ['a', 'b'].map((v) => (existsSync(`${dir}/${e.kind}-${e.n}.${v}.mp3`) ? e.dur?.[v] || 0 : 0));
    if (secs[0] || secs[1]) out[`${e.kind}-${e.n}`] = secs;
  }
  return Object.keys(out).length ? out : null;
}
