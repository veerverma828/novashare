import React, { useState, useRef, useEffect } from 'react';
import { Reply, Copy, Download, Trash2, User, Users, ChevronLeft } from 'lucide-react';
import { rippleTap } from '../uiHelpers';
import { triggerHaptic } from '../native';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];

export function ChatReactionPicker({
  message,
  reactions = {},
  myLabel = 'me',
  onReact,
  onReply,
  onCopy,
  onSave,
  onDelete,
  onClose,
  position = { top: 0, left: 0, isMine: false }
}) {
  const popoverRef = useRef(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isText = message.kind === 'text';
  const hasFile = message.kind === 'file' || message.kind === 'app' || message.file || message.url;
  const isSentByMe = message.direction === 'sent' || position.isMine;

  // Listen for pointer/touch events outside popover container to ensure reliable dismissal
  useEffect(() => {
    const handleOutsidePointer = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handleOutsidePointer, true);
      window.addEventListener('touchstart', handleOutsidePointer, true);
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', handleOutsidePointer, true);
      window.removeEventListener('touchstart', handleOutsidePointer, true);
    };
  }, [onClose]);

  // Check which emojis I have already reacted with
  const myReactions = new Set(
    Object.entries(reactions)
      .filter(([_, senders]) => Array.isArray(senders) && senders.includes(myLabel))
      .map(([emoji]) => emoji)
  );

  const handleEmojiClick = (e, emoji) => {
    e.stopPropagation();
    triggerHaptic();
    onReact(emoji);
    onClose();
  };

  // Compute smart horizontal position bounded by screen edges (12px padding)
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
  const popoverWidth = Math.min(330, screenWidth - 24);

  let leftPos = 12;
  if (position.left) {
    leftPos = Math.max(12, Math.min(screenWidth - popoverWidth - 12, position.left - popoverWidth / 2));
  } else if (position.isMine) {
    leftPos = screenWidth - popoverWidth - 12;
  }

  return (
    <>
      {/* Backdrop overlay to close when clicking outside */}
      <div
        className="fixed inset-0 z-[2500] bg-black/40 backdrop-blur-[2px] animate-[fadeIn_0.15s_ease-out]"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Popover container floating near the message */}
      <div
        ref={popoverRef}
        className={`fixed z-[2510] flex flex-col gap-2 select-none animate-[popIn_0.18s_cubic-bezier(0.175,0.885,0.32,1.275)] ${
          position.isMine ? 'items-end' : 'items-start'
        }`}
        style={{
          top: Math.max(70, Math.min(window.innerHeight - 260, position.top)),
          left: `${leftPos}px`,
          maxWidth: 'calc(100vw - 24px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Responsive Emoji reaction quick bar */}
        {!showDeleteConfirm && (
          <div className="flex items-center gap-1 max-w-full overflow-x-auto no-scrollbar p-1.5 bg-[#0e1626]/95 border border-white/15 rounded-full shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl">
            {QUICK_EMOJIS.map((emoji) => {
              const active = myReactions.has(emoji);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`w-8 h-8 min-[380px]:w-9 min-[380px]:h-9 rounded-full flex items-center justify-center text-[1.1rem] min-[380px]:text-[1.25rem] flex-shrink-0 transition-transform duration-150 active:scale-125 cursor-pointer border-0 ${
                    active
                      ? 'bg-accent-purple/30 border border-accent-purple/60 scale-110 shadow-[0_0_12px_rgba(125,211,255,0.4)]'
                      : 'bg-transparent hover:bg-white/10 hover:scale-115'
                  }`}
                  onClick={(e) => handleEmojiClick(e, emoji)}
                  title={`React ${emoji}`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}

        {/* Action options menu */}
        <div className={`${showDeleteConfirm ? 'w-[220px]' : 'w-[190px]'} bg-[#0e1626]/95 border border-white/15 rounded-2xl p-2 shadow-[0_16px_36px_rgba(0,0,0,0.7)] backdrop-blur-xl flex flex-col gap-1 transition-all`}>
          {!showDeleteConfirm ? (
            <>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.82rem] font-medium text-text-primary hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic();
                  onReply(message);
                  onClose();
                }}
              >
                <Reply size={16} className="text-accent-cyan" />
                <span>Reply</span>
              </button>

              {isText && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.82rem] font-medium text-text-primary hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic();
                    onCopy(message.text);
                    onClose();
                  }}
                >
                  <Copy size={16} className="text-accent-purple" />
                  <span>Copy Text</span>
                </button>
              )}

              {hasFile && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.82rem] font-medium text-text-primary hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic();
                    onSave(message);
                    onClose();
                  }}
                >
                  <Download size={16} className="text-accent-green" />
                  <span>Save / Open File</span>
                </button>
              )}

              <div className="h-[1px] bg-white/10 my-0.5" />

              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[0.82rem] font-medium text-accent-pink hover:bg-accent-pink/15 transition-colors cursor-pointer border-0 bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic();
                  if (isSentByMe) {
                    setShowDeleteConfirm(true);
                  } else {
                    onDelete(message.id, 'me');
                    onClose();
                  }
                }}
              >
                <Trash2 size={16} />
                <span>{isSentByMe ? 'Delete…' : 'Delete for me'}</span>
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 animate-[fadeIn_0.15s_ease-out]">
              <div className="px-2 py-1 flex items-center justify-between border-b border-white/10 mb-0.5">
                <span className="text-[0.76rem] font-semibold text-text-muted uppercase tracking-wider">Delete Message</span>
                <button
                  type="button"
                  className="p-0.5 rounded-lg text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(false);
                  }}
                  title="Back"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>

              {/* Delete for me */}
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent group"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic();
                  onDelete(message.id, 'me');
                  onClose();
                }}
              >
                <div className="w-7 h-7 rounded-lg bg-accent-cyan/15 flex items-center justify-center text-accent-cyan group-hover:scale-105 transition-transform flex-shrink-0">
                  <User size={15} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[0.82rem] font-medium text-text-primary group-hover:text-white transition-colors">Delete for me</span>
                  <span className="text-[0.68rem] text-text-muted truncate">Remove on this device</span>
                </div>
              </button>

              {/* Delete for both sides (Only for own messages) */}
              {isSentByMe && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-accent-pink/15 transition-colors cursor-pointer border-0 bg-transparent group"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic();
                    onDelete(message.id, 'both');
                    onClose();
                  }}
                >
                  <div className="w-7 h-7 rounded-lg bg-accent-pink/20 flex items-center justify-center text-accent-pink group-hover:scale-105 transition-transform flex-shrink-0">
                    <Users size={15} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[0.82rem] font-medium text-accent-pink group-hover:text-accent-pink transition-colors">Delete for both sides</span>
                    <span className="text-[0.68rem] text-accent-pink/70 truncate">Remove for everyone</span>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

