import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spriteSvg } from '../src/renderer/sprites.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });

const svg = spriteSvg('runesmith', 10);
const png = await sharp(Buffer.from(svg), { density: 300 })
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' })
  .png()
  .toBuffer();
writeFileSync(out, png);
console.log(`wrote ${out}`);
