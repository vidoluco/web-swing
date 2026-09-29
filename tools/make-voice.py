#!/usr/bin/env python3
"""Generates the spoken lines of src/lines.js once, offline, with the free neural Romanian voices of
edge-tts, so the game plays plain mp3 files and needs no speech synthesis in the browser.

  python3 tools/make-voice.py              only what is new or changed
  python3 tools/make-voice.py --force      everything again
  python3 tools/make-voice.py --only tuica lines whose kind contains that text
  python3 tools/make-voice.py --check      no network: compare the manifest with src/lines.js

Every line is written twice, public/audio/voice/<kind>-<n>.a.mp3 and .b.mp3 (the two voices the game
alternates), and public/audio/voice/manifest.json lists kind, n, Romanian, Italian and durations.
edge-tts pads every file with a second of silence, so with ffmpeg installed the silence at both ends is
trimmed and the durations are those of the speech itself; without ffmpeg the files stay as they come.
The first run creates ./.venv and installs edge-tts there. The folder is git ignored on purpose:
edge-tts talks to a Microsoft service that is not an official API, and the repository is public.
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / '.venv'
OUT = ROOT / 'public' / 'audio' / 'voice'
# The two voices Ludovico chose from samples (29/09): do not change them.
VOICES = {
    'a': {'voice': 'ro-RO-AlinaNeural', 'rate': '-35%', 'pitch': '-18Hz'},
    'b': {'voice': 'ro-RO-EmilNeural', 'rate': '+0%', 'pitch': '+0Hz'},
}
MAX_SECONDS = 4.0


def ensure_venv():
    """Runs this script again inside ./.venv, creating it and installing edge-tts on the first run."""
    py = VENV / 'bin' / 'python'
    if Path(sys.prefix).resolve() == VENV.resolve():
        return
    if not py.exists():
        print('creating .venv')
        venv.create(VENV, with_pip=True)
    if subprocess.run([str(py), '-c', 'import edge_tts'], capture_output=True).returncode != 0:
        print('installing edge-tts into .venv')
        subprocess.run([str(py), '-m', 'pip', 'install', '-q', 'edge-tts'], check=True)
    os.execv(str(py), [str(py), __file__, *sys.argv[1:]])


def read_lines():
    """The lines, straight from src/lines.js, so there is one source of truth."""
    js = "import('./src/lines.js').then((m) => process.stdout.write(JSON.stringify(m.LINES)))"
    raw = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(raw)


def duration(path):
    """Seconds of an audio file, from ffprobe or, on a Mac without it, afinfo."""
    try:
        out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
        return round(float(out.strip()), 2)
    except (FileNotFoundError, ValueError):
        pass
    try:
        out = subprocess.run(['afinfo', str(path)], capture_output=True, text=True).stdout
        for row in out.splitlines():
            if 'estimated duration' in row:
                return round(float(row.split(':')[1].split()[0]), 2)
    except (FileNotFoundError, ValueError):
        pass
    return 0.0


def trim(path):
    """Cuts the silence off both ends of an mp3 (ffmpeg), keeping a short margin. False without ffmpeg."""
    edge = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06'
    tail = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12'
    tmp = path.with_suffix('.tmp.mp3')
    try:
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(path), '-af', f'{edge},areverse,{tail},areverse', '-ac', '1', '-b:a', '64k', str(tmp)], capture_output=True)
    except FileNotFoundError:
        return False
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 500:
        tmp.unlink(missing_ok=True)
        print(f'  could not trim {path.name}: {r.stderr.decode()[:200]}')
        return False
    tmp.replace(path)
    return True


async def speak(edge_tts, text, cfg, path):
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, cfg['voice'], rate=cfg['rate'], pitch=cfg['pitch']).save(str(path))
            return
        except Exception as e:  # the service drops a request now and then
            if attempt == 3:
                raise
            print(f'  retry {path.name}: {e}')
            await asyncio.sleep(1.5 * (attempt + 1))


async def generate(jobs, workers):
    import edge_tts

    queue = asyncio.Queue()
    for j in jobs:
        queue.put_nowait(j)
    done = 0

    async def worker():
        nonlocal done
        while not queue.empty():
            text, cfg, path = queue.get_nowait()
            await speak(edge_tts, text, cfg, path)
            done += 1
            if done % 20 == 0:
                print(f'  {done}/{len(jobs)}')

    await asyncio.gather(*[worker() for _ in range(workers)])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true', help='regenerate every file')
    ap.add_argument('--only', help='only kinds containing this text')
    ap.add_argument('--check', action='store_true', help='compare the manifest with src/lines.js, no network')
    ap.add_argument('--jobs', type=int, default=4, help='parallel requests (default 4)')
    args = ap.parse_args()
    if not args.check:
        ensure_venv()

    lines = read_lines()
    manifest_path = OUT / 'manifest.json'
    old = {}
    if manifest_path.exists():
        for e in json.loads(manifest_path.read_text('utf8')).get('lines', []):
            old[(e['kind'], e['n'])] = e
        if json.loads(manifest_path.read_text('utf8')).get('voices') != VOICES:
            old = {}  # the voice settings changed: nothing can be reused

    OUT.mkdir(parents=True, exist_ok=True)
    entries, jobs, expected = [], [], set()
    for kind, rows in lines.items():
        for n, row in enumerate(rows):
            ro, it = row[0], row[1]
            prev = old.get((kind, n))
            entries.append({'kind': kind, 'n': n, 'ro': ro, 'it': it, 'trimmed': bool(prev and prev.get('trimmed') and prev['ro'] == ro)})
            for v, cfg in VOICES.items():
                path = OUT / f'{kind}-{n}.{v}.mp3'
                expected.add(path.name)
                fresh = prev and prev['ro'] == ro and path.exists()
                selected = not args.only or args.only in kind
                if args.force and selected or not fresh:
                    jobs.append((ro, cfg, path))
                    entries[-1]['trimmed'] = False

    stale = [p for p in OUT.glob('*.mp3') if p.name not in expected]
    print(f'{len(entries)} lines, {len(entries) * 2} files: {len(jobs)} to generate, {len(stale)} stale to delete')
    if args.check:
        sys.exit(1 if jobs or stale else 0)
    for p in stale:
        p.unlink()
    if jobs:
        asyncio.run(generate(jobs, args.jobs))
    # Trim every line that has not been trimmed yet (new ones, or old files from before the trimming existed).
    for e in entries:
        if e['trimmed']:
            continue
        files = [OUT / f"{e['kind']}-{e['n']}.{v}.mp3" for v in VOICES]
        e['trimmed'] = all([trim(f) for f in files])

    long_ones = []
    for e in entries:
        e['dur'] = {v: duration(OUT / f"{e['kind']}-{e['n']}.{v}.mp3") for v in VOICES}
        if max(e['dur'].values()) > MAX_SECONDS:
            long_ones.append(e)
    manifest_path.write_text(json.dumps({'version': 1, 'voices': VOICES, 'lines': entries}, ensure_ascii=False, indent=1) + '\n', 'utf8')
    total = sum(p.stat().st_size for p in OUT.glob('*.mp3'))
    print(f'manifest.json written, {total / 1e6:.1f} MB of audio')
    if long_ones:
        print(f'{len(long_ones)} lines take more than {MAX_SECONDS} s in one voice:')
        for e in sorted(long_ones, key=lambda e: -max(e['dur'].values())):
            print(f"  {e['kind']}-{e['n']}  a {e['dur']['a']} s  b {e['dur']['b']} s  {e['ro']}")


if __name__ == '__main__':
    main()
