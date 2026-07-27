import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join } from 'path';

const RES = join(process.cwd(), 'android/app/src/main/res');

const BG = '#0a0f1a';

// Signal Pulse mark: centered dot + two concentric rings, purple -> cyan gradient.
function markSvg({ size, scale = 1, bg = null }) {
  const cx = size / 2;
  const cy = size / 2;
  const u = (size / 100) * scale; // unit scale relative to the 100-unit design grid

  const bgRect = bg
    ? `<rect x="0" y="0" width="${size}" height="${size}" fill="${bg}"/>`
    : '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="${cx - 40 * u}" y1="${cy + 40 * u}" x2="${cx + 40 * u}" y2="${cy - 40 * u}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  ${bgRect}
  <circle cx="${cx}" cy="${cy}" r="${8 * u}" fill="url(#g)"/>
  <circle cx="${cx}" cy="${cy}" r="${22 * u}" stroke="url(#g)" stroke-width="${6 * u}" fill="none" opacity="0.75"/>
  <circle cx="${cx}" cy="${cy}" r="${36 * u}" stroke="url(#g)" stroke-width="${5 * u}" fill="none" opacity="0.35"/>
</svg>`;
}

const adaptiveSizes = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const legacySizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function run() {
  const MARK_SCALE = 0.8; // outer ring diameter ~58% of canvas, safely inside the 66% adaptive-icon safe zone

  for (const [density, size] of Object.entries(adaptiveSizes)) {
    const dir = join(RES, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    const svg = markSvg({ size, scale: MARK_SCALE });
    await sharp(Buffer.from(svg)).png().toFile(join(dir, 'ic_launcher_foreground.png'));
  }

  for (const [density, size] of Object.entries(legacySizes)) {
    const dir = join(RES, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    const svg = markSvg({ size, scale: MARK_SCALE, bg: BG });
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    await sharp(buf).toFile(join(dir, 'ic_launcher.png'));
    await sharp(buf).toFile(join(dir, 'ic_launcher_round.png'));
  }

  // Play Store listing icon
  mkdirSync(join(process.cwd(), 'assets'), { recursive: true });
  const store = markSvg({ size: 512, scale: 0.8, bg: BG });
  await sharp(Buffer.from(store)).png().toFile(join(process.cwd(), 'assets/play-store-icon-512.png'));

  console.log('Icons generated.');
}

run();
