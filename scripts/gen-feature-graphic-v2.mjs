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
    <radialGradient id="glowCenter" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(512 260) scale(480 260)">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="beamGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowCenter)"/>

  <!-- faint circuit dots background -->
  <g opacity="0.18">
    <circle cx="90" cy="70" r="2" fill="#8b5cf6"/>
    <circle cx="140" cy="110" r="2" fill="#8b5cf6"/>
    <circle cx="70" cy="420" r="2" fill="#06b6d4"/>
    <circle cx="950" cy="60" r="2" fill="#06b6d4"/>
    <circle cx="980" cy="430" r="2" fill="#8b5cf6"/>
    <circle cx="60" cy="200" r="2" fill="#06b6d4"/>
  </g>

  <!-- wordmark, centered top -->
  <g transform="translate(0,0)">
    <path transform="translate(365 60) scale(2.6)" d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="url(#textGrad)" filter="url(#softGlow)"/>
    <text x="415" y="115" font-family="Georgia, 'Iowan Old Style', serif" font-style="italic" font-weight="700" font-size="58" fill="#f5f7fb" text-anchor="start">Nova<tspan fill="url(#textGrad)">Share</tspan></text>
  </g>

  <!-- device-to-device transfer illustration -->
  <g transform="translate(0,60)">
    <!-- phone (left) -->
    <g transform="translate(230,150)">
      <rect x="-45" y="-70" width="90" height="150" rx="16" fill="none" stroke="#c4b5fd" stroke-width="3"/>
      <circle cx="0" cy="60" r="4" fill="#c4b5fd"/>
      <rect x="-30" y="-52" width="60" height="96" rx="4" fill="#8b5cf6" opacity="0.12"/>
    </g>

    <!-- laptop (right) -->
    <g transform="translate(794,160)">
      <rect x="-70" y="-55" width="140" height="90" rx="8" fill="none" stroke="#67e8f9" stroke-width="3"/>
      <rect x="-58" y="-43" width="116" height="66" rx="3" fill="#06b6d4" opacity="0.12"/>
      <path d="M -85 35 L 85 35 L 95 55 L -95 55 Z" fill="none" stroke="#67e8f9" stroke-width="3"/>
    </g>

    <!-- connecting beam -->
    <line x1="320" y1="150" x2="700" y2="160" stroke="url(#beamGrad)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity="0.85"/>
    <circle cx="510" cy="155" r="10" fill="url(#beamGrad)" filter="url(#softGlow)"/>
  </g>

  <!-- tagline -->
  <text x="512" y="430" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#9aa5b8" text-anchor="middle" letter-spacing="0.3">Send files directly, device to device</text>
  <text x="512" y="465" font-family="Arial, Helvetica, sans-serif" font-size="19" fill="#6b7688" text-anchor="middle" letter-spacing="0.5">No cloud storage. No size limits. Fully private.</text>
</svg>`;

mkdirSync(join(process.cwd(), 'assets'), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(join(process.cwd(), 'assets/play-store-feature-graphic-v2.png'));
console.log('Feature graphic v2 generated.');
