import { triggerHaptic } from './native';

// Spawns a ripple span inside whatever element was tapped, and gives it a
// light haptic tick on-device. Purely a feedback layer; never blocks the
// actual click handler.
export function rippleTap(e, handler) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.6;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${size}px`;
  const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  el.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
  triggerHaptic();
  if (handler) handler(e);
}

// Reusable Tailwind class strings for the two button variants used all over
// the app — kept as constants instead of @apply so JSX stays the source of
// truth for styling, while avoiding retyping this string 30+ times.
export const BTN_PRIMARY = 'relative overflow-hidden flex items-center justify-center gap-2 bg-accent-purple text-[#06222c] border-0 font-heading text-[0.95rem] font-semibold py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_SECONDARY = 'relative overflow-hidden flex items-center justify-center gap-2 bg-transparent border border-border text-text-primary font-heading text-[0.95rem] font-medium py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed';
