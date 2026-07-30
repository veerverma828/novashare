import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join } from 'path';

const W = 1024;
const H = 500;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0a0f1a"/>
      <stop offset="1" stop-color="#0d1420"/>
    </linearGradient>
    <radialGradient id="glowPurple" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(150 250) scale(420)">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowCyan" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(880 120) scale(380)">
      <stop offset="0" stop-color="#06b6d4" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#06b6d4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowPurple)"/>
  <rect width="${W}" height="${H}" fill="url(#glowCyan)"/>

  <!-- decorative signal rings, right side, echoing brand mark -->
  <g opacity="0.5">
    <circle cx="860" cy="250" r="70" stroke="url(#textGrad)" stroke-width="2" fill="none" opacity="0.35"/>
    <circle cx="860" cy="250" r="115" stroke="url(#textGrad)" stroke-width="1.5" fill="none" opacity="0.22"/>
    <circle cx="860" cy="250" r="160" stroke="url(#textGrad)" stroke-width="1" fill="none" opacity="0.12"/>
    <circle cx="860" cy="250" r="14" fill="url(#textGrad)" opacity="0.7"/>
  </g>

  <!-- connecting dashed transfer line motif -->
  <path d="M 640 250 L 800 250" stroke="url(#textGrad)" stroke-width="2" stroke-dasharray="6 8" opacity="0.5"/>
  <circle cx="640" cy="250" r="6" fill="#06b6d4" opacity="0.8"/>

  <!-- lightning bolt logo mark -->
  <g transform="translate(96, 178) scale(4.1)" filter="url(#softGlow)">
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="url(#boltGrad)"/>
  </g>

  <!-- wordmark -->
  <text x="205" y="235" font-family="Georgia, 'Iowan Old Style', serif" font-style="italic" font-weight="700" font-size="72" fill="#f5f7fb">Nova<tspan fill="url(#textGrad)">Share</tspan></text>

  <!-- tagline -->
  <text x="207" y="285" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#9aa5b8" letter-spacing="0.3">Direct Peer-to-Peer File Sharing</text>
  <text x="207" y="322" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#6b7688" letter-spacing="0.5">No cloud. No limits. Just device to device.</text>
</svg>`;

mkdirSync(join(process.cwd(), 'assets'), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(join(process.cwd(), 'assets/play-store-feature-graphic.png'));
console.log('Feature graphic generated.');
