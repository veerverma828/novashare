// Circular transfer progress — reads the same speed/ETA lines the linear
// bar used to, just given a shape that matches the round dropzone/radar
// motifs already in the app.
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function TransferRing({ progress, gradientId = 'ringGrad' }) {
  const offset = RING_CIRCUMFERENCE - (Math.min(100, Math.max(0, progress)) / 100) * RING_CIRCUMFERENCE;
  return (
    <svg className="w-[130px] h-[130px]" viewBox="0 0 120 120" role="img" aria-label={`Transfer ${Math.round(progress)}% complete`}>
      <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <circle
        cx="60"
        cy="60"
        r={RING_RADIUS}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 60 60)"
        className="transition-[stroke-dashoffset] duration-200 ease-out"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-purple)" />
          <stop offset="100%" stopColor="var(--color-accent-cyan)" />
        </linearGradient>
      </defs>
      <text x="60" y="66" textAnchor="middle" className="font-heading text-[1.35rem] font-bold fill-text-primary [font-variant-numeric:tabular-nums]">{Math.round(progress)}%</text>
    </svg>
  );
}
