import { useState, useRef } from 'react';
import { UploadCloud, Download, RefreshCw, Trash2 } from 'lucide-react';
import { rippleTap } from '../uiHelpers';
import { triggerHaptic } from '../native';

// Swipe left on any history row to discard/delete it.
// Uses Pointer Events to seamlessly handle touch (mobile), mouse, and stylus.
export function SwipeableHistoryRow({ entry, formatBytes, formatWhen, onResend, onDiscard }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const removedRef = useRef(false);

  const REMOVE_THRESHOLD = -72;

  const onPointerDown = (e) => {
    // Only primary button/touch
    if (e.button !== undefined && e.button !== 0) return;
    startXRef.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const delta = Math.min(0, e.clientX - startXRef.current);
    setDragX(delta);
  };

  const finishDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX < REMOVE_THRESHOLD && !removedRef.current) {
      removedRef.current = true;
      triggerHaptic();
      onDiscard(entry.id);
    } else {
      setDragX(0);
    }
  };

  const dragProgress = dragX < 0 ? Math.min(1, dragX / REMOVE_THRESHOLD) : 0;
  const filesList = Array.isArray(entry.files) ? entry.files : [];
  const totalSize = filesList.reduce((sum, f) => sum + (f?.size || 0), 0);
  const label = filesList.length > 1
    ? `${filesList.length} ${entry.kind === 'text' ? 'text snippets' : 'files'}`
    : (filesList[0]?.name || (entry.kind === 'text' ? 'Text snippet' : 'Shared item'));
  const roomInfo = entry.roomCode ? ` · room ${entry.roomCode}` : (entry.peerLabel ? ` · ${entry.peerLabel}` : '');

  return (
    <div className="relative overflow-hidden rounded-xl flex-shrink-0 select-none">
      {/* Background discard action visual hint behind the sliding row */}
      <div
        className="absolute inset-0 rounded-xl bg-[rgba(248,113,113,0.18)] border border-[rgba(248,113,113,0.4)] flex items-center justify-end pr-4 text-accent-pink pointer-events-none transition-opacity duration-150"
        style={{ opacity: dragProgress > 0.1 ? dragProgress : 0 }}
      >
        <div className="flex items-center gap-1 text-[0.78rem] font-medium" style={{ transform: `scale(${0.8 + dragProgress * 0.2})` }}>
          <Trash2 size={16} /> Discard
        </div>
      </div>

      {/* Main sliding row */}
      <div
        className="relative flex items-center gap-3 bg-[rgba(30,41,59,0.4)] border border-border rounded-xl py-[0.6rem] px-[0.8rem] [touch-action:pan-y] cursor-grab active:cursor-grabbing"
        style={{
          transform: `translateX(${dragX}px)`,
          opacity: 1 - dragProgress * 0.4,
          borderColor: dragProgress > 0
            ? `rgba(248,113,113, ${0.25 + dragProgress * 0.75})`
            : undefined,
          background: dragProgress > 0
            ? `rgba(248,113,113, ${dragProgress * 0.18})`
            : undefined,
          transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease, background 0.25s ease'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerLeave={() => dragging && finishDrag()}
      >
        <div className={`w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center ${entry.direction === 'sent' ? 'bg-[rgba(125,211,255,0.15)] text-accent-purple' : 'bg-[rgba(125,211,255,0.15)] text-accent-cyan'}`}>
          {entry.direction === 'sent' ? <UploadCloud size={16} /> : <Download size={16} />}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <span
            className="text-[0.85rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-150"
            style={{ color: dragProgress > 0.4 ? 'var(--color-accent-pink)' : undefined }}
          >
            {label}
          </span>
          <span className="text-[0.72rem] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
            {entry.direction === 'sent' ? 'Sent' : 'Received'} · {formatBytes(totalSize)} · {formatWhen(entry.timestamp)}{roomInfo}
          </span>
        </div>

        {entry.direction === 'sent' && (
          <button
            type="button"
            className="relative overflow-hidden flex-shrink-0 bg-transparent border border-border text-text-secondary cursor-pointer flex items-center gap-1 py-[0.4rem] px-[0.6rem] rounded-lg text-[0.75rem] transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              rippleTap(e, () => onResend(entry));
            }}
            title="Re-send"
          >
            <RefreshCw size={13} /> Re-send
          </button>
        )}
      </div>
    </div>
  );
}
