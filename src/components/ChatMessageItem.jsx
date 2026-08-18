import { useState, useRef } from 'react';
import { Reply, FileImage, FileVideo, Play, RefreshCw, Smartphone, File as FileIcon } from 'lucide-react';
import { triggerHaptic } from '../native';
import { formatBytes, getFileType } from '../transferUtils';

export function ChatMessageItem({
  message,
  myLabel = 'me',
  reactions = {},
  onReact,
  onReply,
  onOpenAttachment,
  onLongPress
}) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const longPressTimerRef = useRef(null);
  const thresholdHapticFiredRef = useRef(false);
  const isPointerDownRef = useRef(false);

  const mine = message.direction === 'sent';
  const SWIPE_THRESHOLD = 52;
  const MAX_SWIPE = 90;

  // Clear pending long-press timer
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e) => {
    // Only primary pointer button
    if (e.button !== undefined && e.button !== 0) return;
    
    isPointerDownRef.current = true;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    thresholdHapticFiredRef.current = false;

    // React nulls out currentTarget once the handler returns, so grab the element
    // now — reading it inside the timer below would throw on null.
    const bubbleEl = e.currentTarget;

    // Start long-press timer (~350ms)
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      if (isPointerDownRef.current) {
        triggerHaptic();
        const rect = bubbleEl.getBoundingClientRect();
        onLongPress(message, {
          top: rect.top,
          left: rect.left,
          isMine: mine
        });
        cancelLongPress();
      }
    }, 350);
  };

  const handlePointerMove = (e) => {
    if (!isPointerDownRef.current) return;

    const deltaX = e.clientX - startXRef.current;
    const deltaY = e.clientY - startYRef.current;

    // If user moves vertically or moves more than 10px before dragging horizontally, cancel long press
    if (Math.abs(deltaY) > 8 || Math.abs(deltaX) > 8) {
      cancelLongPress();
    }

    // Only swipe right to reply
    if (deltaX > 5 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      setIsDragging(true);
      const clampedX = Math.min(MAX_SWIPE, Math.max(0, deltaX));
      setDragX(clampedX);

      // Trigger threshold vibration once when passing swipe threshold
      if (clampedX >= SWIPE_THRESHOLD && !thresholdHapticFiredRef.current) {
        thresholdHapticFiredRef.current = true;
        triggerHaptic();
      }
    }
  };

  const handlePointerUp = () => {
    isPointerDownRef.current = false;
    cancelLongPress();

    if (isDragging) {
      if (dragX >= SWIPE_THRESHOLD) {
        triggerHaptic();
        onReply(message);
      }
      setDragX(0);
      setIsDragging(false);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    cancelLongPress();
    triggerHaptic();
    const rect = e.currentTarget.getBoundingClientRect();
    onLongPress(message, {
      top: rect.top,
      left: rect.left,
      isMine: mine
    });
  };

  // Scroll to original message when clicking quoted reply snippet
  const handleScrollToReplied = (e, replyToId) => {
    e.stopPropagation();
    if (!replyToId) return;
    const targetEl = document.getElementById(`msg-${replyToId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('ring-2', 'ring-accent-cyan', 'ring-offset-2', 'ring-offset-bg-primary');
      setTimeout(() => {
        targetEl.classList.remove('ring-2', 'ring-accent-cyan', 'ring-offset-2', 'ring-offset-bg-primary');
      }, 1500);
    }
  };

  const dragProgress = Math.min(1, dragX / SWIPE_THRESHOLD);
  const reactionsList = Object.entries(reactions).filter(([, senders]) => Array.isArray(senders) && senders.length > 0);

  // Render quoted reply preview box inside the message bubble
  const renderQuotedReply = () => {
    if (!message || !message.replyTo || typeof message.replyTo !== 'object') return null;
    const { id: replyId, text: replyText, name: replyName, kind: replyKind, sender: replySender } = message.replyTo;
    
    let displaySnippet = 'Attachment';
    if (typeof replyText === 'string' && replyText.trim()) {
      displaySnippet = replyText;
    } else if (typeof replyName === 'string' && replyName.trim()) {
      displaySnippet = `${replyKind === 'app' ? '📱' : '📁'} ${replyName}`;
    }

    const formatSenderTitle = (sender) => {
      if (!sender || sender === 'peer' || sender === 'Peer') return 'Peer Device';
      if (sender === myLabel || sender === 'me' || sender === 'You') return 'You';
      // Hide raw UIDs / Peer IDs (e.g., nova-8f3a9b) in favor of friendly device title
      if (typeof sender === 'string' && (sender.startsWith('nova-') || /^[a-f0-9-]{10,}$/i.test(sender))) {
        return 'Peer Device';
      }
      return sender;
    };

    const senderTitle = formatSenderTitle(replySender);

    return (
      <div
        className="mb-1.5 px-2.5 py-1.5 rounded-lg bg-black/30 border-l-3 border-accent-cyan flex flex-col text-[0.74rem] cursor-pointer hover:bg-black/40 transition-colors overflow-hidden max-w-full"
        onClick={(e) => handleScrollToReplied(e, replyId)}
        title="Click to jump to original message"
      >
        <span className="font-semibold text-accent-cyan truncate">
          {senderTitle}
        </span>
        <span className="text-text-secondary truncate italic">{displaySnippet}</span>
      </div>
    );
  };

  // Render reaction pill badges below the bubble
  const renderReactionBadges = () => {
    if (reactionsList.length === 0) return null;

    return (
      <div className={`flex flex-wrap gap-1 mt-1 z-10 ${mine ? 'justify-end' : 'justify-start'}`}>
        {reactionsList.map(([emoji, senders]) => {
          const hasMine = senders.includes(myLabel);
          return (
            <button
              key={emoji}
              type="button"
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.72rem] font-medium transition-transform duration-150 active:scale-95 cursor-pointer border ${
                hasMine
                  ? 'bg-accent-purple/20 border-accent-purple/50 text-white shadow-[0_0_8px_rgba(125,211,255,0.3)]'
                  : 'bg-bg-secondary/90 border-white/10 text-text-secondary hover:bg-white/10'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic();
                onReact(message.id, emoji);
              }}
              title={`Reacted by ${senders.join(', ')}`}
            >
              <span>{emoji}</span>
              <span className="text-[0.68rem] font-bold opacity-80">{senders.length}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      id={`msg-${message.id}`}
      className={`relative flex items-center w-full transition-all duration-200 select-none ${
        mine ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Swipe to reply icon indicator floating on left */}
      <div
        className="absolute left-2 flex items-center justify-center w-8 h-8 rounded-full bg-accent-purple/30 border border-accent-purple/50 text-accent-purple shadow-lg pointer-events-none transition-transform duration-75 z-0"
        style={{
          transform: `scale(${dragProgress * 1.1}) translateX(${(1 - dragProgress) * -15}px)`,
          opacity: dragProgress
        }}
      >
        <Reply size={16} />
      </div>

      {/* Main sliding message container */}
      <div
        className={`flex flex-col max-w-[82%] xs:max-w-[78%] z-10 [touch-action:pan-y] cursor-grab active:cursor-grabbing transition-transform ${
          mine ? 'items-end' : 'items-start'
        }`}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={handleContextMenu}
      >
        {/* TEXT MESSAGE */}
        {message.kind === 'text' && (
          <div
            className={`rounded-2xl px-3.5 py-2 text-[0.85rem] leading-snug break-words relative shadow-sm ${
              mine
                ? 'bg-[rgba(125,211,255,0.14)] border border-[rgba(125,211,255,0.32)] text-text-primary rounded-br-[6px]'
                : 'bg-bg-secondary border border-border text-text-primary rounded-bl-[6px]'
            }`}
          >
            {renderQuotedReply()}
            <div>{message.text}</div>
          </div>
        )}

        {/* IMAGE / VIDEO ATTACHMENT */}
        {(message.kind === 'file' || message.kind === 'app') && (getFileType(message.name) === 'image' || getFileType(message.name) === 'video') && (
          <div
            className={`group relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-200 hover:opacity-95 shadow-lg w-[240px] xs:w-[260px] max-w-full ${
              mine
                ? 'bg-[rgba(125,211,255,0.14)] border-[rgba(125,211,255,0.32)] rounded-br-[6px]'
                : 'bg-bg-secondary border-border rounded-bl-[6px]'
            }`}
            onClick={() => onOpenAttachment(message)}
            title={getFileType(message.name) === 'video' ? 'Click to play video' : 'Click to preview image'}
          >
            {message.replyTo && <div className="p-2 bg-black/40">{renderQuotedReply()}</div>}
            
            <div className="relative w-full h-[180px] xs:h-[200px] bg-black/40 flex items-center justify-center overflow-hidden">
              {(message.url || message.file) ? (
                getFileType(message.name) === 'image' ? (
                  <img
                    src={message.url || (message.file ? URL.createObjectURL(message.file) : '')}
                    alt={message.name}
                    className="w-full h-full object-cover block"
                  />
                ) : (
                  <>
                    <video
                      src={message.url || (message.file ? URL.createObjectURL(message.file) : '')}
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        try { e.currentTarget.currentTime = Math.min(0.5, (e.currentTarget.duration || 1) / 4); } catch { /* ignore video seek error */ }
                      }}
                      className="w-full h-full object-cover block opacity-90"
                    />
                    {message.status !== 'sending' && message.status !== 'receiving' && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                          <Play size={20} className="fill-white ml-0.5" />
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-text-muted">
                  {getFileType(message.name) === 'image' ? <FileImage size={28} className="opacity-60" /> : <FileVideo size={28} className="opacity-60" />}
                </div>
              )}

              {(message.status === 'sending' || message.status === 'receiving') && (
                <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] flex flex-col items-center justify-center gap-1 text-white text-[0.75rem] font-semibold z-20">
                  <RefreshCw size={20} className="animate-spin text-accent-cyan" />
                  <span>{message.status === 'sending' ? `Sending ${Math.round((message.progress || 0) * 100)}%` : `Receiving ${Math.round((message.progress || 0) * 100)}%`}</span>
                </div>
              )}
            </div>

            <div className="p-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent absolute bottom-0 inset-x-0 flex items-center justify-between gap-2 text-white z-10">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {getFileType(message.name) === 'video' ? <FileVideo size={13} className="text-accent-cyan flex-shrink-0" /> : <FileImage size={13} className="text-accent-cyan flex-shrink-0" />}
                <span className="text-[0.75rem] font-semibold truncate drop-shadow">{message.name}</span>
              </div>
              <span className="text-[0.68rem] text-white/80 flex-shrink-0 drop-shadow">{formatBytes(message.size)}</span>
            </div>
          </div>
        )}

        {/* FILE / APP ATTACHMENT */}
        {(message.kind === 'file' || message.kind === 'app') && getFileType(message.name) !== 'image' && getFileType(message.name) !== 'video' && (
          <div
            className={`flex flex-col rounded-2xl p-2.5 min-w-[200px] max-w-full overflow-hidden transition-all duration-150 ${
              mine
                ? 'bg-[rgba(125,211,255,0.14)] border border-[rgba(125,211,255,0.32)] rounded-br-[6px]'
                : 'bg-bg-secondary border border-border rounded-bl-[6px]'
            }`}
          >
            {renderQuotedReply()}

            <div
              className="flex items-center gap-2.5 cursor-pointer hover:opacity-90"
              onClick={() => onOpenAttachment(message)}
              title="Click to open attachment"
            >
              <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${mine ? 'bg-[rgba(125,211,255,0.18)] text-accent-purple' : 'bg-white/[0.06] text-text-secondary'}`}>
                {message.kind === 'app' ? <Smartphone size={17} /> : <FileIcon size={17} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[0.8rem] font-semibold text-text-primary truncate">{message.name}</div>
                <div className="text-[0.7rem] text-text-muted">
                  {formatBytes(message.size)} · {message.status === 'sending' ? `sending ${Math.round((message.progress || 0) * 100)}%` : message.status === 'receiving' ? `receiving ${Math.round((message.progress || 0) * 100)}%` : mine ? 'delivered' : 'received'}
                </div>
              </div>
              <button
                type="button"
                className="flex-shrink-0 text-[0.72rem] font-semibold text-accent-purple bg-[rgba(125,211,255,0.12)] border border-[rgba(125,211,255,0.3)] rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-[rgba(125,211,255,0.25)] transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAttachment(message);
                }}
              >
                Open
              </button>
            </div>
          </div>
        )}

        {/* Reaction badges */}
        {renderReactionBadges()}
      </div>
    </div>
  );
}
