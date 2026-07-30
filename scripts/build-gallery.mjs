import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const A = join(process.cwd(), 'assets');
const read = (f) => readFileSync(join(A, f), 'utf8');

const items = [
  { file: 'play-store-feature-graphic.b64', label: 'Option 1', name: 'Side Wordmark', desc: 'Bolt mark + wordmark left, signal rings echoing the brand mark on the right.' },
  { file: 'play-store-feature-graphic-v2.b64', label: 'Option 2', name: 'Device to Device', desc: 'Phone-to-laptop transfer beam — mirrors the in-app "waiting for peer" screen.' },
  { file: 'play-store-feature-graphic-v3.b64', label: 'Option 3', name: 'Minimal Poster', desc: 'Large centered mark and wordmark. Quietest, most confident option.' },
  { file: 'play-store-feature-graphic-v4.b64', label: 'Option 4', name: 'Scan to Connect', desc: 'Leads with the QR pairing flow — the app\'s signature first interaction.' },
  { file: 'play-store-feature-graphic-v5.b64', label: 'Option 5', name: 'Signal Mark Hero', desc: 'Blown-up version of the actual app icon (concentric rings) with a feature list.' },
];

const cards = items.map((it, i) => {
  const b64 = read(it.file);
  return `
    <figure class="card" style="--d:${i}">
      <div class="frame">
        <img src="data:image/png;base64,${b64}" alt="${it.name} feature graphic" width="1024" height="500" />
      </div>
      <figcaption>
        <span class="tag">${it.label}</span>
        <h2>${it.name}</h2>
        <p>${it.desc}</p>
      </figcaption>
    </figure>`;
}).join('\n');

const html = `<title>NovaShare — Feature Graphic Options</title>
<style>
  :root{
    --bg:#0a0f1a; --bg2:#0d1420; --panel:#101828; --border:#232e42;
    --purple:#8b5cf6; --cyan:#06b6d4; --text:#f2f4f8; --muted:#93a0b4; --muted2:#5c6a80;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:linear-gradient(180deg,var(--bg),var(--bg2));
    color:var(--text); font-family:Arial,Helvetica,sans-serif;
    padding:3rem 1.5rem 5rem; min-height:100vh;
  }
  header{max-width:1100px;margin:0 auto 2.5rem;text-align:center}
  header .eyebrow{
    font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);
    font-weight:700;margin:0 0 .6rem;
  }
  header h1{
    font-family:Georgia,'Iowan Old Style',serif;font-style:italic;font-weight:700;
    font-size:clamp(1.8rem,4vw,2.6rem);margin:0 0 .6rem;text-wrap:balance;
    background:linear-gradient(120deg,var(--purple),var(--cyan));
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  header p{color:var(--muted);margin:0;font-size:.95rem}
  .grid{
    max-width:1100px;margin:0 auto;display:grid;gap:2rem;
    grid-template-columns:1fr;
  }
  .card{
    margin:0;background:var(--panel);border:1px solid var(--border);border-radius:16px;
    overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35);
  }
  .frame{
    width:100%;aspect-ratio:1024/500;background:#000;
  }
  .frame img{width:100%;height:100%;display:block;object-fit:cover}
  figcaption{padding:1.1rem 1.4rem 1.4rem}
  .tag{
    display:inline-block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;
    color:var(--purple);border:1px solid rgba(139,92,246,.4);background:rgba(139,92,246,.08);
    padding:.2rem .55rem;border-radius:999px;font-weight:700;margin-bottom:.6rem;
  }
  figcaption h2{margin:0 0 .35rem;font-size:1.15rem;font-family:Georgia,serif}
  figcaption p{margin:0;color:var(--muted);font-size:.92rem;line-height:1.5;max-width:60ch}
  footer{max-width:1100px;margin:2.5rem auto 0;text-align:center;color:var(--muted2);font-size:.85rem}
  @media (min-width:860px){
    .grid{grid-template-columns:1fr 1fr}
    .card:nth-child(odd):last-child{grid-column:1/-1;max-width:640px;margin:0 auto}
  }
</style>
<header>
  <p class="eyebrow">Play Store · Feature Graphic</p>
  <h1>NovaShare — Five Directions</h1>
  <p>All built from the same palette and mark as the app. 1024×500, ready to upload as-is.</p>
</header>
<main class="grid">
${cards}
</main>
<footer>Tell me the option name or number — I'll hand you the exact file to upload.</footer>
`;

writeFileSync(join(process.cwd(), 'scratch_gallery.html'), html);
console.log('Gallery built:', html.length, 'bytes');
