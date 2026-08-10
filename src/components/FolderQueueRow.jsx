import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, X } from 'lucide-react';
import { rippleTap } from '../uiHelpers';
import { SwipeableFileRow } from './SwipeableFileRow';

// A picked folder's files ride in the same flat selectedFiles queue as loose
// files (webkitRelativePath is how we tell them apart), but shown flat that
// queue turns into a wall of individual filenames for a big folder. This
// collapses a folder's files behind one row — tap to expand and browse what's
// actually going to send, tap X to drop the whole folder at once.
export function FolderQueueRow({ name, entries, formatBytes, onRemoveAll, onRemoveOne }) {
  const [open, setOpen] = useState(false);
  const totalSize = entries.reduce((sum, { file }) => sum + file.size, 0);

  return (
    <div className="rounded-xl border border-border bg-[rgba(30,41,59,0.5)] overflow-hidden flex-shrink-0">
      <div
        className="relative flex items-center gap-[0.7rem] py-[0.65rem] px-[0.8rem] cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={14} className="text-text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-text-muted flex-shrink-0" />}
        <Folder size={16} className="text-accent-cyan flex-shrink-0" />
        <span className="text-[0.85rem] text-text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
        <span className="text-[0.72rem] text-text-muted flex-shrink-0">{entries.length} file{entries.length === 1 ? '' : 's'} &middot; {formatBytes(totalSize)}</span>
        <button
          type="button"
          className="relative overflow-hidden w-[22px] h-[22px] rounded-full bg-[rgba(248,113,113,0.15)] text-accent-pink border-0 flex items-center justify-center flex-shrink-0 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); rippleTap(e, onRemoveAll); }}
          aria-label={`Remove folder ${name}`}
        >
          <X size={12} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-[0.4rem] p-[0.5rem] pt-0 pl-8">
          {entries.map(({ file, index }) => (
            <SwipeableFileRow
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              sizeLabel={formatBytes(file.size)}
              onRemove={() => onRemoveOne(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
