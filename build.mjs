// Bundles the game as an ES module and copies the static assets into dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
import { voiceEmbed } from './tools/voice-manifest.mjs'; // voice:

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: !process.argv.includes('--dev'),
  sourcemap: process.argv.includes('--dev'),
  target: 'es2022',
  define: { __VOICE__: JSON.stringify(voiceEmbed()) }, // voice: audio durations, or null when public/audio/voice was never generated
  outfile: 'dist/game.js',
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync('index.template.html', 'dist/index.html');
cpSync('public', 'dist', { recursive: true });
console.log('dist/ ready');
