/**
 * Copies the PixiJS ESM bundle from node_modules into the frontend vendor
 * folder so the vanilla ES-module frontend can import it without a bundler.
 * Runs automatically after `npm install` (postinstall). The vendored file is
 * also committed with the project, so this script only refreshes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'pixi.js', 'dist', 'pixi.min.mjs');
const destDir = path.join(root, 'public', 'assets', 'js', 'vendor');
const dest = path.join(destDir, 'pixi.mjs');

try {
  if (!fs.existsSync(src)) {
    console.warn('[copy-pixi] pixi.js is not installed yet — keeping the vendored copy as-is.');
    process.exit(0);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[copy-pixi] vendored', dest, `(${Math.round(fs.statSync(dest).size / 1024)} KB)`);
} catch (err) {
  console.warn('[copy-pixi] failed (non-fatal):', err.message);
}
