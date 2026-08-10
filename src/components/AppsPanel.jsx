import { useState, useEffect } from 'react';
import { Share2, RefreshCw, AlertCircle, Smartphone, Search, Check } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { listInstalledApps, getAppApkFile, clearApkCache } from '../native';
import { mapWithConcurrency } from '../transferUtils';
import { rippleTap, BTN_PRIMARY } from '../uiHelpers';
import { AppIcon } from './AppIcon';
import { HighlightMatch } from './HighlightMatch';

// Installed-apps browser for the "Apps" home tab: lists user-installed
// packages (native bridge only), lets the user search and multi-select, and
// hands back ready-to-send Files built from each APK's bytes so they drop
// straight into the same selectedFiles queue the file dropzone uses.
export function AppsPanel({ onSelectApps, formatBytes }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [preparing, setPreparing] = useState(null); // { index, total }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listInstalledApps()
      .then((list) => {
        if (cancelled) return;
        setApps([...list].sort((a, b) => a.appName.localeCompare(b.appName)));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load installed apps.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = query.trim()
    ? apps.filter((a) => a.appName.toLowerCase().includes(query.toLowerCase()))
    : apps;

  const toggleSelected = (packageName) => {
    if (preparing) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) next.delete(packageName);
      else next.add(packageName);
      return next;
    });
  };

  const handleShareSelected = async () => {
    if (preparing || selected.size === 0) return;
    const picked = apps.filter((a) => selected.has(a.packageName));
    setError('');
    let completed = 0;
    setPreparing({ index: 0, total: picked.length });
    try {
      // A few APK cache-copy+fetch calls run concurrently — each is now a
      // plain native file copy rather than a heavy base64 bridge payload, so
      // parallelizing a handful at a time is safe and meaningfully faster
      // than preparing them one at a time.
      // Each app is prepped independently — one failure (over the size cap,
      // uninstalled mid-scan, etc.) must not drop the rest of the selection.
      const failed = [];
      const results = await mapWithConcurrency(picked, 3, async (app) => {
        try {
          const file = await getAppApkFile(app.packageName, app.appName, app.versionName);
          return file;
        } catch (err) {
          console.error(`Failed to prepare ${app.packageName}:`, err);
          failed.push(app.appName || app.packageName);
          return null;
        } finally {
          completed += 1;
          setPreparing({ index: completed, total: picked.length });
        }
      });
      const files = results.filter(Boolean);

      if (failed.length > 0) {
        setError(`Could not prepare: ${failed.join(', ')}${files.length > 0 ? ' — sending the rest.' : ''}`);
      }
      if (files.length > 0) onSelectApps(files);
    } catch (err) {
      setError(err.message || 'Could not prepare the selected apps.');
    } finally {
      setPreparing(null);
      clearApkCache();
    }
  };

  if (!Capacitor.isNativePlatform()) {
    return (
      <div className="flex flex-col items-center gap-3 text-text-muted text-center px-4 py-10">
        <Smartphone size={28} />
        <p>App sharing is only available in the installed NovaShare app.</p>
      </div>
    );
  }

  return (
    <div className="apps-panel flex-1 min-h-0 flex flex-col gap-4">
      <div className="relative flex items-center gap-[0.4rem] w-full min-w-0 flex-shrink-0">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center"><Search size={16} /></div>
        <input
          type="text"
          className="flex-1 min-w-0 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(125,211,255,0.12)]"
          placeholder="Search installed apps..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-[0.6rem] text-text-muted text-[0.85rem] py-8">
          <RefreshCw size={22} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
          <span>Loading installed apps&hellip;</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-text-secondary text-[0.9rem] px-2 py-8 text-center justify-center"><AlertCircle size={16} /> {error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-[0.85rem] text-text-muted text-center">
          {apps.length === 0 ? 'No user-installed apps found.' : `No apps match "${query}".`}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        // Responsive tile grid (was a vertical list): auto-fill sizes each
        // tile to a ~92px minimum and lets the track add/remove columns as
        // the panel width changes, so it self-adjusts across phone sizes
        // (and the wider modal/desktop width) with no manual breakpoints.
        // Behavior below (click-to-toggle, checkbox state, search highlight,
        // AppsPanel state/handlers) is unchanged from the list version.
        <div className="apps-list flex-1 min-h-0 grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] auto-rows-max gap-2.5 content-start overflow-y-auto pb-1 pr-[0.4rem]">
          {filtered.map((app) => {
            const isChecked = selected.has(app.packageName);
            return (
              <div
                key={app.packageName}
                title={`${app.packageName}${app.versionName ? ` · v${app.versionName}` : ''} · ${formatBytes(app.apkSize)}`}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 cursor-pointer transition-[background-color,border-color] duration-150 ease-linear border text-center ${isChecked ? 'bg-[rgba(125,211,255,0.14)] border-accent-purple' : 'bg-[rgba(30,41,59,0.4)] border-border hover:bg-[rgba(30,41,59,0.65)] hover:border-accent-purple'}`}
                onClick={() => toggleSelected(app.packageName)}
              >
                <span className={`absolute top-1.5 right-1.5 w-5 h-5 flex-shrink-0 rounded-md border-[1.5px] flex items-center justify-center text-white transition-all duration-150 ${isChecked ? 'bg-accent-purple border-accent-purple !text-[#06222c]' : 'border-border bg-[rgba(8,12,20,0.5)]'}`}>
                  {isChecked && <Check size={13} strokeWidth={3} />}
                </span>
                <AppIcon packageName={app.packageName} />
                <div className="w-full min-w-0 flex flex-col items-center">
                  <span className="w-full text-[0.78rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis"><HighlightMatch text={app.appName} query={query} /></span>
                  <span className="w-full text-[0.65rem] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
                    {app.versionName ? `v${app.versionName} · ` : ''}{formatBytes(app.apkSize)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!!preparing}
          onClick={(e) => rippleTap(e, handleShareSelected)}
        >
          {preparing
            ? <><RefreshCw size={16} className="animate-[spin_1.1s_linear_infinite]" /> Preparing {preparing.index}/{preparing.total}&hellip;</>
            : <><Share2 size={16} /> Share {selected.size} {selected.size === 1 ? 'App' : 'Apps'}</>}
        </button>
      )}
    </div>
  );
}
