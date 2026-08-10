import { useState } from 'react';
import { Sliders, ShieldCheck, Trash2, Smartphone, Zap, RefreshCw, Volume2, HardDrive, Info, ChevronDown, Download } from 'lucide-react';
import { RATE_PRESETS } from '../transferUtils';
import { clearHistory, getHistory } from '../history';
import { rippleTap } from '../uiHelpers';
import { triggerHaptic } from '../native';

export function SettingsPanel({
  formatBytes,
  maxRateKBps,
  onSelectMaxRate,
  appUpdate,
  onCheckUpdate,
  onStartUpdate,
  onRestartUpdate,
  showToast
}) {
  const [historyCount, setHistoryCount] = useState(() => getHistory().length);
  const [hapticEnabled, setHapticEnabled] = useState(() => {
    return localStorage.getItem('novashare_haptics') !== 'false';
  });

  const toggleHaptics = () => {
    const next = !hapticEnabled;
    setHapticEnabled(next);
    localStorage.setItem('novashare_haptics', String(next));
    if (next) triggerHaptic();
    showToast(next ? 'Haptic feedback enabled' : 'Haptic feedback muted', 'info');
  };

  const handleClearHistory = (e) => {
    rippleTap(e, () => {
      clearHistory();
      setHistoryCount(0);
      showToast('Transfer history cleared', 'success');
    });
  };

  return (
    <div className="flex-1 flex flex-col gap-5 pb-2 animate-[fadeIn_0.2s_ease-out]">
      {/* SECTION 1: TRANSFER & SPEED LIMITS */}
      <div className="bg-[rgba(30,41,59,0.35)] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-accent-cyan font-heading font-semibold text-[0.92rem]">
          <Sliders size={18} />
          <span>Transfer Bandwidth Limit</span>
        </div>
        <p className="text-[0.78rem] text-text-muted m-0">
          Cap outgoing P2P bandwidth to conserve mobile data or network resources.
        </p>

        <div className="relative w-full mt-1">
          <select
            value={maxRateKBps}
            onChange={(e) => {
              const val = Number(e.target.value);
              onSelectMaxRate(val);
              triggerHaptic();
            }}
            className="w-full bg-[rgba(8,12,20,0.6)] border border-white/15 rounded-xl py-3 px-4 text-[0.88rem] font-heading font-medium text-text-primary outline-none appearance-none cursor-pointer transition-all duration-200 focus:border-accent-purple focus:shadow-[0_0_12px_rgba(125,211,255,0.15)] pr-10"
          >
            {RATE_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.kbps} className="bg-[#0f172a] text-text-primary">
                {preset.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-accent-cyan pointer-events-none flex items-center">
            <ChevronDown size={18} />
          </div>
        </div>
      </div>

      {/* SECTION 2: APP PREFERENCES */}
      <div className="bg-[rgba(30,41,59,0.35)] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-accent-purple font-heading font-semibold text-[0.92rem]">
          <Volume2 size={18} />
          <span>Sound & Feedback</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex flex-col">
            <span className="text-[0.85rem] font-medium text-text-primary">Haptic Vibration</span>
            <span className="text-[0.75rem] text-text-muted">Touch feedback on buttons and swipe gestures</span>
          </div>
          <button
            type="button"
            className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200 flex items-center ${
              hapticEnabled ? 'bg-accent-purple justify-end' : 'bg-white/10 justify-start'
            }`}
            onClick={toggleHaptics}
          >
            <div className={`w-4 h-4 rounded-full ${hapticEnabled ? 'bg-[#06222c]' : 'bg-text-muted'}`} />
          </button>
        </div>
      </div>

      {/* SECTION 3: STORAGE & HISTORY */}
      <div className="bg-[rgba(30,41,59,0.35)] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-accent-pink font-heading font-semibold text-[0.92rem]">
          <HardDrive size={18} />
          <span>Storage & Transfer Log</span>
        </div>

        <div className="flex items-center justify-between text-[0.82rem] text-text-secondary py-1">
          <span>Saved Transfer Entries</span>
          <span className="font-semibold text-text-primary">{historyCount} transfer{historyCount === 1 ? '' : 's'}</span>
        </div>

        <button
          type="button"
          disabled={historyCount === 0}
          className="flex items-center justify-center gap-2 bg-accent-pink/10 border border-accent-pink/30 text-accent-pink text-[0.82rem] font-medium py-2 px-3 rounded-xl cursor-pointer transition-colors hover:bg-accent-pink/20 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
          onClick={handleClearHistory}
        >
          <Trash2 size={15} /> Clear All History
        </button>
      </div>

      {/* SECTION 4: ABOUT & APP VERSION */}
      <div className="bg-[rgba(30,41,59,0.35)] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-accent-cyan font-heading font-semibold text-[0.92rem]">
          <Info size={18} />
          <span>About NovaShare</span>
        </div>

        <div className="flex items-center justify-between text-[0.82rem] text-text-secondary">
          <span>App Version</span>
          <span className="font-mono text-accent-cyan bg-accent-cyan/10 px-2 py-0.5 rounded-md border border-accent-cyan/20">v1.2</span>
        </div>

        <div className="flex items-center justify-between text-[0.82rem] text-text-secondary">
          <span>Encryption</span>
          <span className="flex items-center gap-1 text-accent-green font-medium">
            <ShieldCheck size={14} /> WebRTC DTLS / SHA-256
          </span>
        </div>

        {appUpdate && appUpdate.status === 'downloaded' ? (
          <button
            type="button"
            className="flex items-center justify-center gap-2 bg-accent-green/15 border border-accent-green text-accent-green font-medium text-[0.82rem] py-2 px-3 rounded-xl cursor-pointer transition-colors hover:bg-accent-green/25 mt-2"
            onClick={onRestartUpdate}
          >
            <RefreshCw size={15} /> Restart to Update
          </button>
        ) : appUpdate && appUpdate.status === 'downloading' ? (
          <div className="flex items-center justify-center gap-2 bg-accent-purple/15 border border-accent-purple/30 text-accent-cyan font-medium text-[0.82rem] py-2 px-3 rounded-xl mt-2">
            <RefreshCw size={15} className="animate-[spin_1.1s_linear_infinite]" /> Downloading update ({appUpdate.progress}%)...
          </div>
        ) : appUpdate && appUpdate.status === 'available' ? (
          <button
            type="button"
            className="flex items-center justify-center gap-2 bg-accent-purple/20 border border-accent-purple text-accent-cyan font-medium text-[0.82rem] py-2 px-3 rounded-xl cursor-pointer transition-colors hover:bg-accent-purple/30 mt-2"
            onClick={onStartUpdate}
          >
            <Download size={15} /> Download & Install Update
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center justify-center gap-2 bg-white/[0.04] border border-white/10 text-text-primary font-medium text-[0.82rem] py-2 px-3 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.08] mt-2"
            onClick={(e) => rippleTap(e, onCheckUpdate)}
          >
            <RefreshCw size={15} /> Check for App Updates
          </button>
        )}
      </div>
    </div>
  );
}
