import { useState } from 'react';
import {
  Radio,
  MessageCircle,
  Smartphone,
  RefreshCw,
  Trash2,
  Zap,
  ArrowRight,
  Wifi,
  CheckCircle2,
  Copy,
  Share2,
  QrCode,
  Key,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  getRecentConnections,
  removeRecentConnection,
  clearRecentConnections
} from '../recentConnections';
import { rippleTap } from '../uiHelpers';
import { triggerHaptic } from '../native';

export function ConnectPanel({
  mode,
  roomCode,
  targetPeerId,
  chatPeerLabel,
  connectedCount,
  nearbyPeers = [],
  wifiDirectPeers = [],
  onOpenChat,
  unreadCount = 0,
  onReconnectRoom,
  onConnectPeer,
  onHostRoom,
  onCopyRoomCode,
  onShareRoomCode,
  onShowQr,
  formatWhen
}) {
  const [recentList, setRecentList] = useState(() => getRecentConnections());
  const [customRoom, setCustomRoom] = useState('');
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isLiveConnected =
    (mode === 'p2p-send' && connectedCount > 0) ||
    (mode === 'p2p-receive' && (targetPeerId || roomCode));

  const displayRoomCode = roomCode || (mode === 'p2p-receive' ? targetPeerId : '');

  const handleDiscard = (id) => {
    removeRecentConnection(id);
    setRecentList((prev) => prev.filter((item) => item.id !== id));
    triggerHaptic();
  };

  const handleClearAll = () => {
    clearRecentConnections();
    setRecentList([]);
    triggerHaptic();
  };

  const handleCustomConnect = () => {
    const code = customRoom.trim().toUpperCase();
    if (!code) return;
    triggerHaptic();
    onReconnectRoom(code, true);
    setCustomRoom('');
  };

  const handleCopyCode = (code) => {
    triggerHaptic();
    if (onCopyRoomCode) {
      onCopyRoomCode(code);
    } else {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareCode = (code) => {
    triggerHaptic();
    if (onShareRoomCode) {
      onShareRoomCode(code);
    } else if (navigator.share) {
      navigator.share({
        title: 'NovaShare Room Code',
        text: `Connect to my NovaShare room using code: ${code}`
      }).catch(() => {});
    } else {
      handleCopyCode(code);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 pb-6 select-none animate-[fadeIn_0.2s_ease]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[1.1rem] font-bold font-heading text-text-primary flex items-center gap-2">
            <Radio size={20} className="text-accent-cyan" /> Connect & Chat
          </h2>
          <p className="text-[0.78rem] text-text-muted">
            Manage active sessions, share your room code, and connect with nearby devices.
          </p>
        </div>
      </div>

      {/* YOUR ROOM CODE CARD */}
      <div className="bg-bg-secondary/90 border border-accent-purple/30 rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-[0_2px_12px_rgba(168,85,247,0.1)] transition-all">
        {/* Top Header Row */}
        <div
          className="flex items-center justify-between gap-2 cursor-pointer"
          onClick={() => {
            triggerHaptic();
            setIsExpanded((prev) => !prev);
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-accent-purple/20 text-accent-purple flex items-center justify-center border border-accent-purple/30 flex-shrink-0">
              <Key size={14} />
            </div>
            <span className="text-[0.85rem] font-semibold text-text-primary font-heading">
              Your Room Code
            </span>
          </div>

          <button
            type="button"
            className="p-1 text-text-muted hover:text-text-primary bg-transparent border-0 cursor-pointer flex items-center gap-1 text-[0.72rem] font-medium"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic();
              setIsExpanded((prev) => !prev);
            }}
          >
            <span>{isExpanded ? 'Hide' : 'More'}</span>
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {/* Room Code & Quick Actions Bar */}
        {displayRoomCode && (
          <div className="flex items-center justify-between gap-2 bg-bg-primary/60 border border-border rounded-xl p-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 font-mono font-bold text-[0.92rem] text-accent-cyan tracking-wider bg-white/5 border border-accent-cyan/30 px-3 py-1 rounded-lg">
                <span>{displayRoomCode}</span>
                <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" title="Room Ready" />
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                className="py-1 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-text-primary text-[0.75rem] font-semibold flex items-center gap-1 border border-white/10 cursor-pointer transition-colors active:scale-95"
                onClick={(e) => rippleTap(e, () => handleCopyCode(displayRoomCode))}
                title="Copy Code"
              >
                {copied ? <CheckCircle2 size={13} className="text-accent-green" /> : <Copy size={13} className="text-accent-cyan" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                className="p-1.5 rounded-lg bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple border border-accent-purple/30 cursor-pointer transition-colors active:scale-95"
                onClick={(e) => rippleTap(e, () => handleShareCode(displayRoomCode))}
                title="Share room code"
              >
                <Share2 size={14} />
              </button>

              {onShowQr && (
                <button
                  type="button"
                  className="p-1.5 rounded-lg bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan border border-accent-cyan/30 cursor-pointer transition-colors active:scale-95"
                  onClick={(e) => rippleTap(e, onShowQr)}
                  title="Show QR code"
                >
                  <QrCode size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Options */}
        {isExpanded && (
          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2 animate-[fadeIn_0.15s_ease]">
            <span className="text-[0.78rem] text-text-muted">
              {displayRoomCode ? 'Change room code?' : 'No active room code generated yet.'}
            </span>
            {onHostRoom && (
              <button
                type="button"
                className="py-1.5 px-3 rounded-lg bg-accent-purple text-[#06222c] font-heading text-[0.78rem] font-bold flex items-center gap-1 border-0 cursor-pointer transition-transform active:scale-95"
                onClick={(e) => rippleTap(e, onHostRoom)}
              >
                <Zap size={13} /> {displayRoomCode ? 'New Code' : 'Generate Code'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ACTIVE LIVE CONNECTION CARD */}
      {isLiveConnected && (
        <div className="bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.3)] rounded-2xl p-4 flex flex-col gap-3 shadow-[0_4px_20px_rgba(16,185,129,0.15)] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-accent-green/20 text-accent-green flex items-center justify-center">
                  <Smartphone size={20} />
                </div>
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-green border-2 border-bg-primary animate-ping" />
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-green border-2 border-bg-primary" />
              </div>
              <div>
                <div className="font-heading font-semibold text-[0.95rem] text-text-primary flex items-center gap-2">
                  <span>{chatPeerLabel || 'Connected Device'}</span>
                  <span className="text-[0.68rem] px-2 py-0.5 rounded-full bg-accent-green/20 text-accent-green font-semibold">
                    Live
                  </span>
                </div>
                <div className="text-[0.75rem] text-text-muted">
                  Room code: <strong className="text-accent-cyan font-mono">{roomCode || targetPeerId}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="relative flex-1 py-2 px-3 rounded-xl bg-accent-purple text-[#06222c] font-heading text-[0.82rem] font-bold flex items-center justify-center gap-2 border-0 cursor-pointer shadow-[0_2px_12px_rgba(125,211,255,0.35)] transition-transform active:scale-[0.98]"
              onClick={(e) => rippleTap(e, onOpenChat)}
            >
              <div className="relative flex items-center justify-center">
                <MessageCircle size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-2 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-accent-pink text-white text-[0.6rem] font-extrabold flex items-center justify-center border-2 border-bg-primary shadow-sm animate-pulse">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              Open Chat
            </button>
          </div>
        </div>
      )}

      {/* QUICK CONNECT TO ROOM CODE */}
      <div className="bg-bg-secondary/60 border border-border/80 rounded-2xl p-4 flex flex-col gap-2.5 shadow-sm">
        <span className="text-[0.78rem] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
          <Key size={13} className="text-accent-purple" /> Quick Connect to Room
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Enter room code..."
            value={customRoom}
            onChange={(e) => setCustomRoom(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomConnect()}
            maxLength={10}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[0.85rem] font-mono font-semibold text-text-primary placeholder:text-text-muted/70 placeholder:normal-case focus:outline-none focus:border-accent-purple uppercase tracking-wider min-w-0"
          />
          <button
            type="button"
            disabled={!customRoom.trim()}
            className={`py-2 px-3.5 rounded-xl font-heading text-[0.82rem] font-bold flex items-center gap-1.5 border-0 transition-all flex-shrink-0 ${
              customRoom.trim()
                ? 'bg-gradient-to-r from-accent-cyan to-accent-purple text-[#06222c] cursor-pointer shadow-[0_2px_12px_rgba(45,212,191,0.35)] active:scale-95'
                : 'bg-white/5 text-text-muted border border-white/10 opacity-70 cursor-not-allowed'
            }`}
            onClick={(e) => rippleTap(e, handleCustomConnect)}
          >
            <span className="whitespace-nowrap">Join Chat</span> <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* NEARBY DISCOVERED DEVICES */}
      {(nearbyPeers.length > 0 || wifiDirectPeers.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.78rem] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
              <Wifi size={14} className="text-accent-cyan" /> Nearby Active Devices
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {nearbyPeers.map((peer) => (
              <div
                key={peer.roomCode}
                className="bg-bg-secondary border border-border/80 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-accent-cyan/50 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-accent-cyan/15 text-accent-cyan flex items-center justify-center flex-shrink-0">
                    <Smartphone size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.85rem] font-semibold text-text-primary truncate">
                      {peer.deviceName || 'Nearby Device'}
                    </div>
                    <div className="text-[0.72rem] text-text-muted font-mono">
                      Room {peer.roomCode}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="py-1.5 px-3 rounded-lg bg-accent-cyan/15 border border-accent-cyan/30 text-accent-cyan font-heading text-[0.78rem] font-semibold flex items-center gap-1 cursor-pointer transition-colors hover:bg-accent-cyan/25"
                  onClick={(e) =>
                    rippleTap(e, () => {
                      triggerHaptic();
                      onReconnectRoom(peer.roomCode, true);
                    })
                  }
                >
                  <MessageCircle size={13} /> Chat
                </button>
              </div>
            ))}

            {wifiDirectPeers.map((peer) => (
              <div
                key={peer.deviceAddress}
                className="bg-bg-secondary border border-border/80 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-accent-purple/50 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-accent-purple/15 text-accent-purple flex items-center justify-center flex-shrink-0">
                    <Zap size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.85rem] font-semibold text-text-primary truncate">
                      {peer.deviceName || peer.deviceAddress}
                    </div>
                    <div className="text-[0.72rem] text-text-muted">
                      Direct Wi-Fi Link
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="py-1.5 px-3 rounded-lg bg-accent-purple/15 border border-accent-purple/30 text-accent-purple font-heading text-[0.78rem] font-semibold flex items-center gap-1 cursor-pointer transition-colors hover:bg-accent-purple/25"
                  onClick={(e) =>
                    rippleTap(e, () => {
                      triggerHaptic();
                      onConnectPeer(peer);
                    })
                  }
                >
                  <MessageCircle size={13} /> Connect & Chat
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECENT CONNECTED DEVICES & CHATS LIST */}
      <div className="flex-1 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[0.78rem] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
            <Smartphone size={13} className="text-accent-cyan" /> Recent Connected Devices ({recentList.length})
          </span>
          {recentList.length > 0 && (
            <button
              type="button"
              className="text-[0.75rem] text-text-muted hover:text-accent-pink flex items-center gap-1 bg-transparent border-0 cursor-pointer p-1"
              onClick={handleClearAll}
            >
              <Trash2 size={12} /> Clear History
            </button>
          )}
        </div>

        {recentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-7 text-text-muted bg-bg-secondary/40 border border-white/[0.08] backdrop-blur-xl rounded-2xl px-5 shadow-inner">
            <div className="w-11 h-11 rounded-2xl bg-accent-purple/10 border border-accent-purple/20 flex items-center justify-center text-accent-purple">
              <Smartphone size={22} className="opacity-80" />
            </div>
            <p className="text-[0.82rem] leading-relaxed max-w-[280px]">
              No recent device connected yet. To connect to devices, use the room code.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentList.map((item) => (
              <div
                key={item.id}
                className="bg-bg-secondary/80 border border-border rounded-xl p-3 flex items-center justify-between gap-3 transition-all hover:border-accent-purple/40"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-white/5 border border-border flex items-center justify-center text-text-secondary flex-shrink-0">
                    <Smartphone size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.88rem] font-semibold text-text-primary truncate">
                      {item.deviceName}
                    </div>
                    <div className="text-[0.72rem] text-text-muted flex items-center gap-1.5 flex-wrap">
                      <span>Room <strong className="text-accent-cyan font-mono">{item.roomCode}</strong></span>
                      {formatWhen && item.timestamp && (
                        <>
                          <span>·</span>
                          <span>{formatWhen(item.timestamp)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    className="py-1.5 px-3 rounded-lg bg-accent-purple/15 border border-accent-purple/30 text-accent-purple font-heading text-[0.78rem] font-semibold flex items-center gap-1 cursor-pointer transition-all hover:bg-accent-purple hover:text-[#06222c]"
                    onClick={(e) =>
                      rippleTap(e, () => {
                        triggerHaptic();
                        onReconnectRoom(item.roomCode, true);
                      })
                    }
                    title="Reconnect and start fresh chat"
                  >
                    <RefreshCw size={12} /> Start Fresh Chat
                  </button>

                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-text-muted hover:text-accent-pink hover:bg-accent-pink/10 border-0 bg-transparent cursor-pointer"
                    onClick={() => handleDiscard(item.id)}
                    title="Remove device"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
