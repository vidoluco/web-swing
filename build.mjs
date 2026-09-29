// Bundles the game as an ES module and copies the static assets into dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: !process.argv.includes('--dev'),
  sourcemap: process.argv.includes('--dev'),
  target: 'es2022',
  outfile: 'dist/game.js',
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync('index.template.html', 'dist/index.html');
cpSync('public', 'dist', { recursive: true });
console.log('dist/ ready');
