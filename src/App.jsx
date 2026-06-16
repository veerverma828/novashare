import { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { 
  Share2, 
  Download, 
  UploadCloud, 
  ShieldCheck, 
  Copy, 
  RefreshCw, 
  FileText, 
  FileImage, 
  FileVideo, 
  FileAudio, 
  FileArchive, 
  FileCode, 
  File, 
  X, 
  ArrowLeft, 
  AlertCircle, 
  Zap, 
  Laptop, 
  Info,
  ExternalLink
} from 'lucide-react';
import './App.css';

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for P2P WebRTC

function App() {
  // Navigation & Mode States
  const [mode, setMode] = useState('home'); // 'home' | 'p2p-send' | 'p2p-receive'
  
  // File States
  const [selectedFile, setSelectedFile] = useState(null);
  const [incomingFile, setIncomingFile] = useState(null); // { name, size, type }
  
  // Connection States
  const [roomCode, setRoomCode] = useState('');
  const [targetPeerId, setTargetPeerId] = useState('');
  const [transferState, setTransferState] = useState('idle'); // 'idle' | 'preparing' | 'waiting' | 'transferring' | 'complete' | 'error'
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('');
  const [timeRemaining, setTimeRemaining] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Link States
  const [downloadUrl, setDownloadUrl] = useState('');
  
  // Toast Notification
  const [toast, setToast] = useState(null);

  // Refs for background processes
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const transferStartTime = useRef(null);
  const receivedChunks = useRef([]);
  const receivedBytes = useRef(0);
  const incomingFileRef = useRef(null);
  const fileInputRef = useRef(null);

  // Format Helper: Bytes -> Human Readable
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format Helper: Speed
  const formatSpeed = (bytesPerSecond) => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format Helper: Time (ETA)
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return '--';
    if (seconds < 60) return Math.round(seconds) + 's';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins + 'm ' + secs + 's';
  };

  // Dynamic File Icon Selector
  const getFileType = (fileName) => {
    if (!fileName) return 'file';
    const ext = fileName.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'audio';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['txt', 'md', 'html', 'css', 'js', 'json', 'py', 'java', 'cpp'].includes(ext)) return 'code';
    return 'file';
  };

  // Show Toast Helper
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Clear Toast after delay
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Read URL Search Parameters on Load (Routing Fallback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');

    if (roomParam) {
      setMode('p2p-receive');
      setTargetPeerId(roomParam);
      // Wait for a small layout mount before connecting
      setTimeout(() => {
        startP2PReceive(roomParam);
      }, 500);
    }

    return () => cleanup();
  }, []);

  // Cleanup active peer/connections
  const cleanup = () => {
    if (connRef.current) {
      try { connRef.current.close(); } catch(e){}
      connRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch(e){}
      peerRef.current = null;
    }
    receivedChunks.current = [];
    receivedBytes.current = 0;
    transferStartTime.current = null;
    incomingFileRef.current = null;
  };

  // Reset UI back to Home State
  const resetToHome = () => {
    cleanup();
    setMode('home');
    setTransferState('idle');
    setSelectedFile(null);
    setIncomingFile(null);
    setRoomCode('');
    setTargetPeerId('');
    setTransferProgress(0);
    setTransferSpeed('');
    setTimeRemaining('');
    setErrorMsg('');
    setDownloadUrl('');
    
    // Clear URL search params without page reload
    window.history.pushState({}, document.title, window.location.pathname);
  };

  // Generate a random 6-character room code
  const generateRoomCode = () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = 'NS-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // Drag and Drop Handlers
  const [dragActive, setDragActive] = useState(false);
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // ----------------------------------------------------
  // SENDER P2P WORKFLOW
  // ----------------------------------------------------
  const startP2PSend = () => {
    if (!selectedFile) return;
    cleanup();
    setTransferState('preparing');
    setMode('p2p-send');

    const attemptConnection = (retryCount = 0) => {
      if (retryCount > 5) {
        setErrorMsg('Could not allocate a unique room code. Try again later.');
        setTransferState('error');
        return;
      }

      const code = generateRoomCode();
      setRoomCode(code);

      // Initialize peer with our room code
      const peer = new Peer(code, {
        debug: 1
      });

      peerRef.current = peer;

      peer.on('open', () => {
        setTransferState('waiting');
        showToast('Direct P2P Room Ready!', 'success');
      });

      peer.on('connection', (conn) => {
        // Only accept one connection for direct P2P transfer
        if (connRef.current) {
          conn.close();
          return;
        }

        connRef.current = conn;
        setTransferState('transferring');
        showToast('Receiver connected! Starting stream...', 'info');

        conn.on('open', () => {
          // Send metadata packet
          conn.send({
            type: 'metadata',
            name: selectedFile.name,
            size: selectedFile.size,
            mime: selectedFile.type || 'application/octet-stream'
          });

          // Begin chunk streaming
          streamChunks(conn, selectedFile);
        });

        conn.on('close', () => {
          showToast('Receiver closed the connection.', 'error');
          setTransferState('error');
          setErrorMsg('The receiver disconnected before the transfer finished.');
        });

        conn.on('error', (err) => {
          showToast('Transfer error: ' + err.message, 'error');
          setTransferState('error');
          setErrorMsg(err.message);
        });
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          peer.destroy();
          attemptConnection(retryCount + 1);
        } else {
          showToast('P2P Error: ' + err.message, 'error');
          setTransferState('error');
          setErrorMsg(err.message || 'Error connecting to peer network.');
        }
      });
    };

    attemptConnection(0);
  };

  const streamChunks = (conn, file) => {
    let offset = 0;
    const startTime = Date.now();
    transferStartTime.current = startTime;

    const sendNext = () => {
      // Check if connection was killed
      if (!connRef.current || connRef.current !== conn) return;

      // Completed!
      if (offset >= file.size) {
        setTransferProgress(100);
        setTransferState('complete');
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 }
        });
        showToast('Transfer completed!', 'success');
        return;
      }

      // Check for backpressure (We limit RTCDataChannel buffer to 1MB)
      if (conn.dataChannel && conn.dataChannel.bufferedAmount > 1024 * 1024) {
        setTimeout(sendNext, 40);
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (e) => {
        if (!connRef.current || connRef.current !== conn) return;

        try {
          conn.send({
            type: 'chunk',
            chunk: e.target.result,
            offset: offset,
            done: offset + CHUNK_SIZE >= file.size
          });

          offset += slice.size;

          const pct = Math.min((offset / file.size) * 100, 100);
          setTransferProgress(pct);

          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (offset / elapsed) : 0;
          setTransferSpeed(formatSpeed(speed));

          const remaining = file.size - offset;
          const eta = speed > 0 ? (remaining / speed) : 0;
          setTimeRemaining(formatTime(eta));

          sendNext();
        } catch (err) {
          setTransferState('error');
          setErrorMsg('Error streaming chunk: ' + err.message);
        }
      };

      reader.onerror = () => {
        setTransferState('error');
        setErrorMsg('Failed to read file from disk.');
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNext();
  };

  // ----------------------------------------------------
  // RECEIVER P2P WORKFLOW
  // ----------------------------------------------------
  const startP2PReceive = (roomCodeInput) => {
    const code = roomCodeInput || targetPeerId;
    if (!code) {
      showToast('Please enter a valid room code.', 'error');
      return;
    }

    cleanup();
    setTransferState('preparing');
    setMode('p2p-receive');
    setTargetPeerId(code);

    const peer = new Peer({
      debug: 1
    });

    peerRef.current = peer;

    peer.on('open', () => {
      showToast('Connecting to room ' + code + '...', 'info');

      const conn = peer.connect(code, { reliable: true });
      connRef.current = conn;

      conn.on('open', () => {
        setTransferState('transferring');
        showToast('Connected! Requesting file...', 'success');
        transferStartTime.current = Date.now();
        receivedChunks.current = [];
        receivedBytes.current = 0;
      });

      conn.on('data', (data) => {
        if (data.type === 'metadata') {
          incomingFileRef.current = {
            name: data.name,
            size: data.size,
            type: data.mime
          };
          setIncomingFile(incomingFileRef.current);
          setTransferProgress(0);
          setTransferSpeed('0 B/s');
          setTimeRemaining('--');
          receivedChunks.current = [];
          receivedBytes.current = 0;
          transferStartTime.current = Date.now();
        } else if (data.type === 'chunk') {
          receivedChunks.current.push(data.chunk);
          receivedBytes.current += data.chunk.byteLength;

          const totalSize = incomingFileRef.current ? incomingFileRef.current.size : 0;

          if (totalSize > 0) {
            const pct = Math.min((receivedBytes.current / totalSize) * 100, 100);
            setTransferProgress(pct);

            const elapsed = (Date.now() - transferStartTime.current) / 1000;
            const speed = elapsed > 0 ? (receivedBytes.current / elapsed) : 0;
            setTransferSpeed(formatSpeed(speed));

            const remaining = totalSize - receivedBytes.current;
            const eta = speed > 0 ? (remaining / speed) : 0;
            setTimeRemaining(formatTime(eta));
          }

          if (data.done) {
            const mimeType = incomingFileRef.current ? incomingFileRef.current.type : 'application/octet-stream';
            const blob = new Blob(receivedChunks.current, { type: mimeType });
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);
            setTransferState('complete');

            confetti({
              particleCount: 80,
              spread: 60,
              origin: { y: 0.6 }
            });

            showToast('Transfer completed!', 'success');

            // Trigger direct download
            const fileName = incomingFileRef.current ? incomingFileRef.current.name : 'downloaded-file';
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        }
      });

      conn.on('close', () => {
        setTransferState((prev) => {
          if (prev === 'complete') return 'complete';
          showToast('Sender disconnected.', 'error');
          setErrorMsg('The sender terminated the connection.');
          return 'error';
        });
      });

      conn.on('error', (err) => {
        showToast('Connection error: ' + err.message, 'error');
        setTransferState('error');
        setErrorMsg(err.message);
      });
    });

    peer.on('error', (err) => {
      showToast('Could not reach signaling server.', 'error');
      setTransferState('error');
      setErrorMsg('सिग्नलिंग सर्वर से कनेक्ट करने में विफल (Signaling server connection failed). Check code or try again.');
    });
  };

  const copyToClipboard = (text, message = 'Copied to clipboard!') => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message, 'success');
    }).catch(() => {
      showToast('Failed to copy.', 'error');
    });
  };

  const getSharingUrl = () => {
    let origin = window.location.origin;
    const localIp = import.meta.env.VITE_LOCAL_IP;
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && localIp && localIp !== 'localhost') {
      origin = `${window.location.protocol}//${localIp}:${window.location.port}`;
    }
    return `${origin}${window.location.pathname}?room=${roomCode}`;
  };

  // Helper file icon component inside local scope
  const renderFileIconComponent = (fileName) => {
    const type = getFileType(fileName);
    const wrapperClass = "file-icon-wrapper";
    switch (type) {
      case 'image': return <div className={wrapperClass}><FileImage size={24} /></div>;
      case 'video': return <div className={wrapperClass}><FileVideo size={24} /></div>;
      case 'audio': return <div className={wrapperClass}><FileAudio size={24} /></div>;
      case 'pdf': return <div className={wrapperClass} style={{color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.15)'}}><FileText size={24} /></div>;
      case 'archive': return <div className={wrapperClass} style={{color: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.15)'}}><FileArchive size={24} /></div>;
      case 'code': return <div className={wrapperClass} style={{color: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.15)'}}><FileCode size={24} /></div>;
      default: return <div className={wrapperClass}><File size={24} /></div>;
    }
  };

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="logo-container" onClick={resetToHome} style={{cursor: 'pointer'}}>
          <Zap size={32} className="logo-icon" fill="currentColor" />
          <h1 className="logo-text">NovaShare</h1>
          <span className="badge" style={{color: 'var(--accent-purple)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
            Direct P2P
          </span>
        </div>
        <div>
          <button className="btn-secondary" onClick={resetToHome} style={{padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.85rem'}}>
            Reset
          </button>
        </div>
      </header>

      {/* TOAST POPUP */}
      {toast && (
        <div className="toast">
          {toast.type === 'success' && <ShieldCheck size={20} style={{color: 'var(--accent-green)'}} />}
          {toast.type === 'error' && <AlertCircle size={20} style={{color: 'var(--accent-pink)'}} />}
          {toast.type === 'info' && <Info size={20} style={{color: 'var(--accent-cyan)'}} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MAIN LAYOUT CONTAINER */}
      <main className="app-main">
        <div className="glass-panel share-card">

          {/* ==================================================== */}
          {/* VIEW: HOME VIEW                                      */}
          {/* ==================================================== */}
          {mode === 'home' && (
            <div>
              <div className="hero-text-center">
                <h2 className="hero-title glow-text">Secure P2P File Sharing</h2>
                <p className="hero-subtitle">Transfer files directly browser-to-browser. Encrypted, private, with zero size limits.</p>
              </div>

              {/* FILE DROP ZONE (IF NO FILE SELECTED) */}
              {!selectedFile ? (
                <div 
                  className={`dropzone ${dragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileInput}
                >
                  <input 
                    type="file" 
                    className="file-input" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect} 
                  />
                  <div className="dropzone-content">
                    <div className="upload-icon-wrapper">
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h3 className="dropzone-title">Drag & drop your file here</h3>
                      <p className="dropzone-subtitle">or click to browse files from your device</p>
                    </div>
                    <span className="badge" style={{color: 'var(--accent-purple)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : (
                /* FILE SELECTED STATE CARD */
                <div>
                  <div className="file-card">
                    {renderFileIconComponent(selectedFile.name)}
                    <div className="file-details">
                      <h4 className="file-name">{selectedFile.name}</h4>
                      <p className="file-size">{formatBytes(selectedFile.size)}</p>
                    </div>
                    <button className="remove-file-btn" onClick={() => setSelectedFile(null)}>
                      <X size={18} />
                    </button>
                  </div>

                  <div className="action-buttons">
                    <button className="btn-primary" onClick={startP2PSend}>
                      <Zap size={18} /> Start P2P Sharing Room
                    </button>
                    <button className="btn-secondary" onClick={() => setSelectedFile(null)}>
                      Cancel Selection
                    </button>
                  </div>
                </div>
              )}

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT) */}
              {!selectedFile && (
                <div>
                  <div className="or-divider">or receive a file</div>
                  <div className="receive-block">
                    <div className="input-group">
                      <div className="input-icon-wrapper">
                        <Download size={20} />
                      </div>
                      <input 
                        type="text" 
                        placeholder="Enter Room Code (e.g. NS-4D8G2X)" 
                        className="code-input"
                        value={targetPeerId}
                        onChange={(e) => setTargetPeerId(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && startP2PReceive()}
                      />
                    </div>
                    <button className="btn-secondary" onClick={() => startP2PReceive()} style={{justifyContent: 'center'}}>
                      Connect & Download
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* VIEW: SENDER P2P STATE                              */}
          {/* ==================================================== */}
          {mode === 'p2p-send' && (
            <div className="p2p-setup-container">
              <div style={{width: '100%', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem'}}>
                <button className="btn-secondary" onClick={resetToHome} style={{padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', gap: '0.25rem'}}>
                  <ArrowLeft size={14} /> Back
                </button>
                <h3 className="gradient-text" style={{fontSize: '1.25rem', fontFamily: 'var(--font-heading)', margin: 0}}>
                  Direct P2P Sharing
                </h3>
              </div>

              {/* File Info Inline Pill */}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', background: 'rgba(255,255,255,0.03)', padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', maxWidth: '100%', width: 'fit-content' }}>
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>Sharing:</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{selectedFile?.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>({formatBytes(selectedFile?.size || 0)})</span>
              </div>

              {/* Waiting for connection */}
              {transferState === 'waiting' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', margin: '0.4rem 0 0.5rem 0' }}>
                    <RefreshCw size={14} className="radar-center-icon" style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-purple)' }} />
                    <p className="hero-subtitle" style={{ fontWeight: 500, margin: 0, fontSize: '0.9rem' }}>
                      Waiting for receiver to connect...
                    </p>
                  </div>

                  <div className="connection-details">
                    <div className="connection-info-left">
                      <div>
                        <div className="stat-label" style={{textAlign: 'left', marginBottom: '0.25rem'}}>Room Code</div>
                        <div className="code-display">
                          <span>{roomCode}</span>
                          <button className="btn-icon-copy" onClick={() => copyToClipboard(roomCode, 'Room code copied!')} title="Copy Code">
                            <Copy size={18} />
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="stat-label" style={{textAlign: 'left', marginBottom: '0.25rem'}}>Share Link</div>
                        <div className="link-value-container">
                          <div className="link-value">
                            {getSharingUrl()}
                          </div>
                          <button className="btn-icon-copy" onClick={() => copyToClipboard(getSharingUrl(), 'Share link copied!')} title="Copy Link">
                            <Copy size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="connection-qr-right">
                      <div className="qr-container">
                        <QRCodeSVG 
                          value={getSharingUrl()} 
                          size={96}
                          bgColor={"#0f172a"}
                          fgColor={"#f8fafc"}
                          level={"H"}
                          includeMargin={false}
                        />
                      </div>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0', textAlign: 'center', display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}>
                    <Info size={14} style={{ color: 'var(--accent-cyan)' }} /> Keep this tab open to stream files directly.
                  </p>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="transfer-status-container" style={{width: '100%'}}>
                  <div className="status-badge uploading">
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: 'spin 2s linear infinite'}} />
                    Streaming File...
                  </div>

                  <div className="progress-container">
                    <div className="progress-header">
                      <span>Progress</span>
                      <span>{Math.round(transferProgress)}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill striped" style={{width: `${transferProgress}%`}}></div>
                    </div>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-box">
                      <div className="stat-label">Speed</div>
                      <div className="stat-value">{transferSpeed || 'Connecting...'}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Estimated Time</div>
                      <div className="stat-value">{timeRemaining || '--'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Transfer Complete!</h3>
                    <p className="hero-subtitle">Your file was shared directly and securely.</p>
                  </div>
                  <button className="btn-primary" onClick={resetToHome} style={{width: '100%'}}>
                    Share Another File
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper" style={{color: 'var(--accent-pink)', backgroundColor: 'rgba(236, 72, 153, 0.15)', filter: 'none'}}>
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Connection Interrupted</h3>
                    <p className="hero-subtitle" style={{color: 'var(--accent-pink)', fontSize: '0.9rem'}}>{errorMsg}</p>
                  </div>
                  <div className="action-buttons" style={{width: '100%'}}>
                    <button className="btn-primary" onClick={startP2PSend}>
                      Retry Transfer
                    </button>
                    <button className="btn-secondary" onClick={resetToHome}>
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* VIEW: RECEIVER P2P STATE                            */}
          {/* ==================================================== */}
          {mode === 'p2p-receive' && (
            <div className="p2p-setup-container">
              <div style={{width: '100%', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem'}}>
                <button className="btn-secondary" onClick={resetToHome} style={{padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', gap: '0.25rem'}}>
                  <ArrowLeft size={14} /> Leave
                </button>
                <h3 className="gradient-text" style={{fontSize: '1.25rem', fontFamily: 'var(--font-heading)', margin: 0}}>
                  Direct P2P Receiver
                </h3>
              </div>

              {/* Connecting/Resolving */}
              {transferState === 'preparing' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', margin: '1rem 0' }}>
                    <RefreshCw size={24} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-cyan)' }} />
                    <p className="hero-subtitle" style={{ margin: 0, fontWeight: 500 }}>
                      Connecting to sender room <strong style={{ color: 'var(--accent-cyan)' }}>{targetPeerId}</strong>...
                    </p>
                  </div>
                  <p className="dropzone-subtitle" style={{ maxWidth: '280px', textAlign: 'center', margin: '0 auto' }}>
                    Establishing WebRTC data tunnel. Ensure the sender has the page active.
                  </p>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="transfer-status-container" style={{width: '100%'}}>
                  {incomingFile && (
                    <div className="file-card" style={{textAlign: 'left', width: '100%'}}>
                      {renderFileIconComponent(incomingFile.name)}
                      <div className="file-details">
                        <h4 className="file-name">{incomingFile.name}</h4>
                        <p className="file-size">{formatBytes(incomingFile.size)}</p>
                      </div>
                    </div>
                  )}

                  <div className="status-badge">
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: 'spin 2s linear infinite'}} />
                    Receiving File...
                  </div>

                  <div className="progress-container">
                    <div className="progress-header">
                      <span>Progress</span>
                      <span>{Math.round(transferProgress)}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill striped" style={{width: `${transferProgress}%`}}></div>
                    </div>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-box">
                      <div className="stat-label">Download Speed</div>
                      <div className="stat-value">{transferSpeed || 'Negotiating...'}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Time Remaining</div>
                      <div className="stat-value">{timeRemaining || '--'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>File Received!</h3>
                    <p className="hero-subtitle">
                      {incomingFile?.name || 'Shared file'} was successfully downloaded to your device.
                    </p>
                  </div>

                  {downloadUrl && (
                    <a href={downloadUrl} download={incomingFile?.name || 'shared-file'} className="btn-download-glow">
                      <Download size={20} /> Download File Again
                    </a>
                  )}

                  <button className="btn-secondary" onClick={resetToHome} style={{width: '100%', marginTop: '0.5rem'}}>
                    Close & Return
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper" style={{color: 'var(--accent-pink)', backgroundColor: 'rgba(236, 72, 153, 0.15)', filter: 'none'}}>
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Transfer Failed</h3>
                    <p className="hero-subtitle" style={{color: 'var(--accent-pink)', fontSize: '0.9rem'}}>{errorMsg}</p>
                  </div>
                  <div className="action-buttons" style={{width: '100%'}}>
                    <button className="btn-primary" onClick={() => startP2PReceive()}>
                      Try Reconnecting
                    </button>
                    <button className="btn-secondary" onClick={resetToHome}>
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* FOOTER */}
      <footer className="app-footer">
        <div className="footer-links">
          <span className="footer-link" style={{display: 'inline-flex', alignItems: 'center', gap: '0.25rem'}}>
            <ShieldCheck size={14} /> 100% Serverless, Private & Direct
          </span>
          <a href="https://peerjs.com/" target="_blank" rel="noopener noreferrer" className="footer-link" style={{display: 'inline-flex', alignItems: 'center', gap: '0.25rem'}}>
            PeerJS Network <ExternalLink size={12} />
          </a>
        </div>
        <p>&copy; {new Date().getFullYear()} NovaShare. Developed in React.js without database requirement.</p>
      </footer>
    </div>
  );
}

export default App;
