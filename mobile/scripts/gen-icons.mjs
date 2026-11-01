// Renders the app icon, Android adaptive icon layers and splash image from the Aether Link "AL" monogram.
// Usage:  npm install --no-save sharp && npm run gen:icons
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => join(root, 'assets', f);
mkdirSync(join(root, 'assets'), { recursive: true });

const NAVY = '#041C42';
// Same geometry as src/components/Brand.tsx (1600x1600 artboard, monogram spans 205..1395).
const A_AND_BAR =
  'M712 475 L958 1010 L1215 1010 L1178 1092 L898 1092 L710 673 L623 848 L760 848 L795 931 L582 931 L497 1100 Q480 1150 505 1200 L470 1212 L385 1135 Z';
const L_STEM = 'M864 490 Q905 492 948 510 L948 915 L864 738 Z';
const RING_TOP = 'M369 1081 A515 515 0 1 1 1225 1090';
const RING_BOTTOM = 'M1194 1131 A515 515 0 0 1 470 1195';

/** Monogram centered on a square canvas; `scale` = fraction of the canvas the disc covers. */
function monogram({ size, scale, disc = NAVY, mark = '#FFFFFF', background = null, knockout = false }) {
  const vb = 1190 / scale; // disc diameter in artboard units is 1190
  const o = 800 - vb / 2;
  const letters = `<path d="${RING_TOP}" stroke="${mark}" stroke-width="30" fill="none"/>
    <path d="${RING_BOTTOM}" stroke="${mark}" stroke-width="30" fill="none"/>
    <path d="${A_AND_BAR}" fill="${mark}"/><path d="${L_STEM}" fill="${mark}"/>`;
  const body = knockout
    ? // letters cut out of the disc (for Android monochrome icons, which only use alpha)
      `<defs><mask id="m"><rect x="0" y="0" width="1600" height="1600" fill="white"/>
        <g>${letters.replaceAll(mark, 'black')}</g></mask></defs>
       <circle cx="800" cy="800" r="595" fill="${disc}" mask="url(#m)"/>`
    : `<circle cx="800" cy="800" r="595" fill="${disc}"/>${letters}`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${o} ${o} ${vb} ${vb}">
    ${background ? `<rect x="${o}" y="${o}" width="${vb}" height="${vb}" fill="${background}"/>` : ''}${body}</svg>`);
}

const jobs = [
  ['icon.png', monogram({ size: 1024, scale: 0.8, background: '#FFFFFF' })],
  ['android-icon-foreground.png', monogram({ size: 1024, scale: 0.56 })],
  ['android-icon-background.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#FFFFFF"/></svg>')],
  ['android-icon-monochrome.png', monogram({ size: 1024, scale: 0.56, disc: '#000000', knockout: true })],
  ['splash-icon.png', monogram({ size: 1024, scale: 0.95, disc: '#FFFFFF', mark: NAVY })],
  ['favicon.png', monogram({ size: 196, scale: 0.95 })],
];

for (const [file, svg] of jobs) {
  await sharp(svg).png().toFile(out(file));
  console.log('wrote assets/' + file);
}
