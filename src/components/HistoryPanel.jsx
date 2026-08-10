import { useState } from 'react';
import { History as HistoryIcon, Trash2 } from 'lucide-react';
import { getHistory, removeHistoryEntry } from '../history';
import { rippleTap } from '../uiHelpers';
import { SwipeableHistoryRow } from './SwipeableHistoryRow';

// Past sent/received transfers (feature #3), read fresh from localStorage
// each time it mounts (parent remounts it via a `key` bump). Re-send only
// works for "sent" entries whose File objects are still alive in
// sentFilesMemory (this session only) — otherwise it prompts to reselect.
export function HistoryPanel({ formatBytes, onResend, onClear, now }) {
  const [entries, setEntries] = useState(() => getHistory());

  const handleDiscard = (id) => {
    removeHistoryEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-text-muted text-center px-4 py-10">
        <HistoryIcon size={28} />
        <p>No transfers yet — sent and received files will show up here.</p>
      </div>
    );
  }

  // `now` is captured by the caller (at the moment the History tab was
  // opened, in an event handler) rather than read here via Date.now() —
  // component render must stay pure/idempotent.
  const formatWhen = (ts) => {
    const diff = now - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-[0.8rem] text-text-muted">{entries.length} transfer{entries.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="relative overflow-hidden flex items-center gap-1 bg-transparent border-0 text-text-muted text-[0.78rem] cursor-pointer py-1 px-2 rounded-md hover:text-accent-pink hover:bg-[rgba(248,113,113,0.1)]"
          onClick={(e) => rippleTap(e, onClear)}
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-[0.4rem]">
        {entries.map((entry) => (
          <SwipeableHistoryRow
            key={entry.id}
            entry={entry}
            formatBytes={formatBytes}
            formatWhen={formatWhen}
            onResend={onResend}
            onDiscard={handleDiscard}
          />
        ))}
      </div>
    </div>
  );
}

