import { useState, useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import { getAppIcon } from '../native';

// Module-scope cache so re-mounting the Apps tab doesn't refetch icons
// already fetched over the native bridge this session.
const appIconCache = new Map();

export function AppIcon({ packageName }) {
  const [icon, setIcon] = useState(appIconCache.get(packageName) || null);

  useEffect(() => {
    if (icon) return;
    let cancelled = false;
    getAppIcon(packageName)
      .then((src) => {
        if (cancelled || !src) return;
        appIconCache.set(packageName, src);
        setIcon(src);
      })
      .catch((err) => console.warn(`AppIcon: failed to load icon for ${packageName}`, err));
    return () => { cancelled = true; };
  }, [packageName, icon]);

  return icon
    ? <img src={icon} alt="" className="w-9 h-9 rounded-[9px] flex-shrink-0 object-cover" />
    : <div className="w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center bg-[rgba(125,211,255,0.15)] text-accent-purple"><Smartphone size={18} /></div>;
}
