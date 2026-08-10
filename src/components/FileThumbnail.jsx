import { useEffect, useMemo, useState } from 'react';
import { FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode, File as FileIcon, RefreshCw } from 'lucide-react';
import { getFileType } from '../transferUtils';

const ICON_BY_TYPE = {
  image: { Icon: FileImage },
  video: { Icon: FileVideo },
  audio: { Icon: FileAudio },
  pdf: { Icon: FileText, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  archive: { Icon: FileArchive, color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' },
  code: { Icon: FileCode, color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' }
};

// Live thumbnail for images/videos queued to send (an object URL onto the
// actual File the browser already has, revoked on unmount) — everything
// else, and anything before the object URL is ready, falls back to the
// same colored file-type icon the app already used everywhere.
export function FileThumbnail({ file, size = 'md' }) {
  const type = getFileType(file.name);
  // Guards against file-like objects that aren't real Blobs (e.g. a plain
  // {name, size} stand-in before the real File is attached) — createObjectURL
  // throws on anything else.
  const isPreviewable = (type === 'image' || type === 'video') && file instanceof Blob;
  const objectUrl = useMemo(() => (isPreviewable ? URL.createObjectURL(file) : null), [file, isPreviewable]);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  useEffect(() => {
    setVideoReady(false);
    if (type !== 'video') return;
    // Safety net: if `seeked` never fires (unsupported codec, odd device),
    // don't leave the spinner up forever — reveal whatever frame is there.
    const timer = setTimeout(() => setVideoReady(true), 1500);
    return () => clearTimeout(timer);
  }, [objectUrl, type]);

  const dims = size === 'sm' ? 'w-9 h-9 rounded-[9px]' : 'w-12 h-12 rounded-xl';
  const iconSize = size === 'sm' ? 18 : 24;

  if (objectUrl && type === 'image') {
    return <img src={objectUrl} alt="" className={`${dims} flex-shrink-0 object-cover`} />;
  }
  if (objectUrl && type === 'video') {
    // Most videos are black/blank at t=0, and some WebViews won't paint any
    // frame at all until a seek happens — nudge forward slightly once the
    // dimensions are known so an actual frame renders instead of nothing.
    // The video (and its momentary blank/play-icon frame) stays hidden
    // behind a spinner until that seek actually finishes, so only the real
    // thumbnail frame ever becomes visible.
    const onLoadedMetadata = (e) => {
      try { e.currentTarget.currentTime = Math.min(0.5, (e.currentTarget.duration || 1) / 4); } catch { /* ignore */ }
    };
    return (
      <div className={`${dims} flex-shrink-0 relative overflow-hidden bg-[rgba(125,211,255,0.15)]`}>
        {!videoReady && (
          <div className="absolute inset-0 flex items-center justify-center text-accent-cyan">
            <RefreshCw size={iconSize - 6} className="animate-[spin_1.1s_linear_infinite]" />
          </div>
        )}
        <video
          src={objectUrl}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoadedMetadata}
          onSeeked={() => setVideoReady(true)}
          className={`absolute inset-0 w-full h-full object-cover bg-black transition-opacity duration-150 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    );
  }

  const entry = ICON_BY_TYPE[type];
  const Icon = entry?.Icon || FileIcon;
  return (
    <div
      className={`${dims} flex-shrink-0 flex items-center justify-center bg-[rgba(125,211,255,0.15)] text-accent-cyan`}
      style={entry?.color ? { color: entry.color, backgroundColor: entry.bg } : undefined}
    >
      <Icon size={iconSize} />
    </div>
  );
}
