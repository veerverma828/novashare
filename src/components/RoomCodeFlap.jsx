import { useState, useEffect } from 'react';

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Split-flap style reveal for the freshly generated room code: each
// character scrambles briefly before settling, staggered left to right.
export function RoomCodeFlap({ code }) {
  const [display, setDisplay] = useState(code.split(''));

  useEffect(() => {
    const target = code.split('');
    const timers = [];
    target.forEach((ch, i) => {
      let ticks = 0;
      const maxTicks = 5 + i * 2;
      const iv = setInterval(() => {
        ticks += 1;
        setDisplay((prev) => {
          const next = [...prev];
          next[i] = ticks >= maxTicks ? ch : FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
          return next;
        });
        if (ticks >= maxTicks) clearInterval(iv);
      }, 45);
      timers.push(iv);
    });
    return () => timers.forEach(clearInterval);
  }, [code]);

  return (
    <div className="flex gap-[0.3rem] font-[Georgia,serif] text-[1.1rem] max-[380px]:text-[0.95rem] tracking-[0.02em] text-accent-cyan [font-variant-numeric:lining-nums_tabular-nums]">
      {display.map((ch, i) => (
        <span key={i} className="bg-[rgba(125,211,255,0.08)] rounded-md px-[0.4rem] py-[0.1rem] [font-variant-numeric:tabular-nums]">{ch}</span>
      ))}
    </div>
  );
}
