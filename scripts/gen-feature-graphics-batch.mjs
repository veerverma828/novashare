import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join } from 'path';

const W = 1024;
const H = 500;
const OUT = join(process.cwd(), 'assets');
mkdirSync(OUT, { recursive: true });

const defs = `
  <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#0a0f1a"/>
    <stop offset="1" stop-color="#0d1420"/>
  </linearGradient>
  <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8b5cf6"/>
    <stop offset="1" stop-color="#06b6d4"/>
  </linearGradient>
  <linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#a78bfa"/>
    <stop offset="1" stop-color="#8b5cf6"/>
  </linearGradient>
  <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="7" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
`;

const BOLT = 'M13 2 3 14h9l-1 8 10-12h-9l1-8z';

// v3: minimal poster — huge centered mark + wordmark, nothing else
const v3 = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
    <radialGradient id="glow3" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(512 250) scale(500 260)">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow3)"/>
  <g transform="translate(340,150) scale(5.4)" filter="url(#softGlow)">
    <path d="${BOLT}" fill="url(#boltGrad)"/>
  </g>
  <text x="512" y="330" font-family="Georgia, 'Iowan Old Style', serif" font-style="italic" font-weight="700" font-size="88" fill="#f5f7fb" text-anchor="middle">Nova<tspan fill="url(#textGrad)">Share</tspan></text>
  <text x="512" y="385" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#9aa5b8" text-anchor="middle" letter-spacing="2">DIRECT · PRIVATE · PEER-TO-PEER</text>
</svg>`;

// v4: QR scan motif — wordmark left, stylized QR block right (ties to real scan-to-connect feature)
function qrModule(x, y, s, opacity = 1, color = '#67e8f9') {
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}" opacity="${opacity}"/>`;
}
function qrCorner(cx, cy, scale) {
  return `
    <g transform="translate(${cx},${cy}) scale(${scale})">
      <rect x="0" y="0" width="34" height="34" fill="none" stroke="#8b5cf6" stroke-width="4"/>
      <rect x="9" y="9" width="16" height="16" fill="#8b5cf6"/>
    </g>`;
}
const rnd = (seed) => { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };
const rand = rnd(42);
let qrDots = '';
for (let r = 0; r < 7; r++) {
  for (let c = 0; c < 7; c++) {
    if ((r < 3 && c < 3) || (r < 3 && c > 3) || (r > 3 && c < 3)) continue;
    if (rand() > 0.42) qrDots += qrModule(c * 16, r * 16, 13, 0.85);
  }
}
const v4 = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${defs}</defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g transform="translate(90,150) scale(2.4)" filter="url(#softGlow)">
    <path d="${BOLT}" fill="url(#boltGrad)"/>
  </g>
  <text x="235" y="215" font-family="Georgia, 'Iowan Old Style', serif" font-style="italic" font-weight="700" font-size="66" fill="#f5f7fb">Nova<tspan fill="url(#textGrad)">Share</tspan></text>
  <text x="238" y="260" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#9aa5b8" letter-spacing="0.3">Scan. Connect. Share.</text>
  <text x="238" y="296" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#6b7688" letter-spacing="0.4">One QR code away from a direct transfer.</text>

  <g transform="translate(700,120)">
    <rect x="-30" y="-30" width="220" height="220" rx="18" fill="#0f1729" stroke="#243049" stroke-width="2"/>
    <g transform="translate(0,0)">${qrDots}</g>
    ${qrCorner(0, 0, 1)}
    ${qrCorner(112, 0, 1)}
    ${qrCorner(0, 112, 1)}
  </g>
</svg>`;

// v5: brand signal-mark hero — concentric rings (matches actual app icon), wordmark + feature row
const v5 = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
    <radialGradient id="glow5" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(230 250) scale(320)">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow5)"/>

  <g transform="translate(230,250)">
    <circle r="150" stroke="url(#textGrad)" stroke-width="4" fill="none" opacity="0.28"/>
    <circle r="105" stroke="url(#textGrad)" stroke-width="5" fill="none" opacity="0.5"/>
    <circle r="34" fill="url(#textGrad)" filter="url(#softGlow)"/>
  </g>

  <text x="500" y="175" font-family="Georgia, 'Iowan Old Style', serif" font-style="italic" font-weight="700" font-size="64" fill="#f5f7fb">Nova<tspan fill="url(#textGrad)">Share</tspan></text>
  <text x="502" y="216" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#9aa5b8" letter-spacing="0.3">Your files, straight to their device</text>

  <g transform="translate(500,260)" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#c7cede">
    <g transform="translate(0,0)">
      <circle r="4" fill="#06b6d4"/>
      <text x="14" y="6">No cloud storage</text>
    </g>
    <g transform="translate(0,42)">
      <circle r="4" fill="#06b6d4"/>
      <text x="14" y="6">No file size limits</text>
    </g>
    <g transform="translate(0,84)">
      <circle r="4" fill="#06b6d4"/>
      <text x="14" y="6">Private, direct connection</text>
    </g>
  </g>
</svg>`;

for (const [name, svg] of [['v3', v3], ['v4', v4], ['v5', v5]]) {
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, `play-store-feature-graphic-${name}.png`));
}
console.log('Batch generated.');
