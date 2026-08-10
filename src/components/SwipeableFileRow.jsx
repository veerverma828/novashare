import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { rippleTap } from '../uiHelpers';
import { FileThumbnail } from './FileThumbnail';

// One row in the multi-file send queue: drag/swipe left (or tap the X) to
// drop a file before the transfer starts. Pointer Events cover mouse,
// touch, and pen with one handler set.
export function SwipeableFileRow({ file, sizeLabel, onRemove }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const removedRef = useRef(false);

  const REMOVE_THRESHOLD = -72;

  const onPointerDown = (e) => {
    startXRef.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const delta = Math.min(0, e.clientX - startXRef.current);
    setDragX(delta);
  };

  const finishDrag = () => {
    setDragging(false);
    if (dragX < REMOVE_THRESHOLD && !removedRef.current) {
      removedRef.current = true;
      onRemove();
    } else {
      setDragX(0);
    }
  };

  const dragProgress = dragX < 0 ? Math.min(1, dragX / REMOVE_THRESHOLD) : 0;

  return (
    <div
      className="relative flex items-center gap-[0.7rem] bg-[rgba(30,41,59,0.5)] border border-border rounded-xl py-[0.65rem] px-[0.8rem] [touch-action:pan-y] cursor-grab flex-shrink-0"
      style={{
        transform: `translateX(${dragX}px)`,
        opacity: 1 - dragProgress * 0.5,
        borderColor: dragProgress > 0
          ? `rgba(248,113,113, ${0.25 + dragProgress * 0.75})`
          : undefined,
        background: dragProgress > 0
          ? `rgba(248,113,113, ${dragProgress * 0.22})`
          : undefined,
        transition: dragging ? 'none' : 'transform 0.25s ease'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerLeave={() => dragging && finishDrag()}
    >
      <FileThumbnail file={file} size="sm" />
      <span className="text-[0.85rem] text-text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: dragProgress > 0 ? 'var(--color-accent-pink)' : undefined }}>{file.name}</span>
      <span className="text-[0.72rem] text-text-muted flex-shrink-0">{sizeLabel}</span>
      <button
        type="button"
        className="relative overflow-hidden w-[22px] h-[22px] rounded-full bg-[rgba(248,113,113,0.15)] text-accent-pink border-0 flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); rippleTap(e, onRemove); }}
        aria-label={`Remove ${file.name}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
