import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
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
  QrCode,
  Camera,
  Pause,
  Play
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import './App.css';

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for P2P WebRTC

function App() {
  // Navigation & Mode States
  const [mode, setMode] = useState('home'); // 'home' | 'p2p-send' | 'p2p-receive'
  
  // File States
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [incomingFile, setIncomingFile] = useState(null); // { name, size, type }

  // Connection States
  const [roomCode, setRoomCode] = useState('');
  const [targetPeerId, setTargetPeerId] = useState('');
  const [transferState, setTransferState] = useState('idle'); // 'idle' | 'preparing' | 'waiting' | 'transferring' | 'complete' | 'error'
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('');
  const [timeRemaining, setTimeRemaining] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Multi-file queue state
  const [sendFileIndex, setSendFileIndex] = useState(0);
  const [sendFileCount, setSendFileCount] = useState(1);
  const [receiveFileIndex, setReceiveFileIndex] = useState(0);
  const [receiveFileCount, setReceiveFileCount] = useState(1);
  const [completedFiles, setCompletedFiles] = useState([]); // receiver-side: [{ name, url, size }]

  // Pause/Resume state
  const [isPaused, setIsPaused] = useState(false);
  const [isPeerPaused, setIsPeerPaused] = useState(false);
  
  // Toast Notification
  const [toast, setToast] = useState(null);

  // QR Scanner State
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [showQrZoom, setShowQrZoom] = useState(false);

  // Refs for background processes
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const transferStartTime = useRef(null);
  const receivedChunks = useRef([]);
  const receivedBytes = useRef(0);
  const incomingFileRef = useRef(null);
  const fileInputRef = useRef(null);
  const scanVideoRef = useRef(null);
  const scanCanvasRef = useRef(null);
  const scanStreamRef = useRef(null);
  const scanRafRef = useRef(null);

  // Multi-file send queue refs
  const sendQueueRef = useRef([]);
  const sendQueueIndexRef = useRef(0);
  // Receiver-side collected downloads for this batch
  const receivedFilesRef = useRef([]);
  // Pause/resume refs (avoid stale closures inside the send loop)
  const isPausedRef = useRef(false);
  const pendingSendNextRef = useRef(null);

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
    sendQueueRef.current = [];
    sendQueueIndexRef.current = 0;
    receivedFilesRef.current = [];
    isPausedRef.current = false;
    pendingSendNextRef.current = null;
  };

  // Reset UI back to Home State
  const resetToHome = () => {
    cleanup();
    setMode('home');
    setTransferState('idle');
    setSelectedFiles([]);
    setIncomingFile(null);
    setRoomCode('');
    setTargetPeerId('');
    setTransferProgress(0);
    setTransferSpeed('');
    setTimeRemaining('');
    setErrorMsg('');
    setCompletedFiles([]);
    setSendFileIndex(0);
    setSendFileCount(1);
    setReceiveFileIndex(0);
    setReceiveFileCount(1);
    setIsPaused(false);
    setIsPeerPaused(false);

    // Clear URL search params without page reload
    window.history.pushState({}, document.title, window.location.pathname);
  };

  // Toggle pause/resume of an in-progress send (sender-side control)
  const togglePauseTransfer = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    if (connRef.current) {
      try { connRef.current.send({ type: 'control', action: next ? 'pause' : 'resume' }); } catch (e) {}
    }
    if (!next && pendingSendNextRef.current) {
      const fn = pendingSendNextRef.current;
      pendingSendNextRef.current = null;
      fn();
    }
  };

  // Generate a random 6-character room code
  const generateRoomCode = () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // ----------------------------------------------------
  // SENDER P2P WORKFLOW
  // ----------------------------------------------------
  const startP2PSend = () => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    cleanup();
    setTransferState('preparing');
    setMode('p2p-send');
    setIsPaused(false);
    isPausedRef.current = false;
    sendQueueRef.current = selectedFiles;
    sendQueueIndexRef.current = 0;
    setSendFileCount(selectedFiles.length);
    setSendFileIndex(0);

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
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
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
          conn.send({ type: 'batch-start', totalFiles: sendQueueRef.current.length });
          sendNextQueuedFile(conn);
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

  const sendNextQueuedFile = (conn) => {
    const idx = sendQueueIndexRef.current;
    const files = sendQueueRef.current;

    if (idx >= files.length) {
      conn.send({ type: 'batch-complete' });
      setTransferState('complete');
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
      showToast('Transfer completed!', 'success');
      return;
    }

    const file = files[idx];
    setSendFileIndex(idx);
    conn.send({
      type: 'metadata',
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      fileIndex: idx,
      totalFiles: files.length
    });

    streamChunks(conn, file);
  };

  const streamChunks = (conn, file) => {
    let offset = 0;
    const startTime = Date.now();
    transferStartTime.current = startTime;

    const sendNext = () => {
      // Check if connection was killed
      if (!connRef.current || connRef.current !== conn) return;

      // Paused: stash this continuation, togglePauseTransfer resumes it
      if (isPausedRef.current) {
        pendingSendNextRef.current = sendNext;
        return;
      }

      // This file done — advance to the next one in the queue
      if (offset >= file.size) {
        setTransferProgress(100);
        sendQueueIndexRef.current += 1;
        sendNextQueuedFile(conn);
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
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
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
        receivedFilesRef.current = [];
        setCompletedFiles([]);
      });

      conn.on('data', (data) => {
        if (data.type === 'batch-start') {
          receivedFilesRef.current = [];
          setCompletedFiles([]);
        } else if (data.type === 'metadata') {
          incomingFileRef.current = {
            name: data.name,
            size: data.size,
            type: data.mime
          };
          setIncomingFile(incomingFileRef.current);
          setReceiveFileIndex(data.fileIndex || 0);
          setReceiveFileCount(data.totalFiles || 1);
          setTransferProgress(0);
          setTransferSpeed('0 B/s');
          setTimeRemaining('--');
          receivedChunks.current = [];
          receivedBytes.current = 0;
          transferStartTime.current = Date.now();
        } else if (data.type === 'control') {
          setIsPeerPaused(data.action === 'pause');
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
            const fileName = incomingFileRef.current ? incomingFileRef.current.name : 'downloaded-file';
            const fileSize = incomingFileRef.current ? incomingFileRef.current.size : receivedBytes.current;

            receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, url, size: fileSize }];
            setCompletedFiles(receivedFilesRef.current);

            saveReceivedFile(blob, fileName, url);
          }
        } else if (data.type === 'batch-complete') {
          setTransferState('complete');
          confetti({
            particleCount: 80,
            spread: 60,
            origin: { y: 0.6 }
          });
          showToast('Transfer completed!', 'success');
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

  // Save a received file to actual device storage.
  // In a real browser, <a download> already writes to the Downloads folder.
  // Inside the Capacitor WebView that click is a no-op, so write bytes via Filesystem instead.
  const saveReceivedFile = async (blob, fileName, blobUrl) => {
    if (!Capacitor.isNativePlatform()) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    try {
      await Filesystem.requestPermissions();

      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      await Filesystem.writeFile({
        path: `Download/${fileName}`,
        data: base64Data,
        directory: Directory.ExternalStorage,
        recursive: true
      });

      showToast(`${fileName} saved to Downloads`, 'success');
    } catch (err) {
      showToast(`Could not save ${fileName} to Downloads: ${err.message}`, 'error');
    }
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

  // Extract a room code from raw scanned QR text (full share URL or bare code)
  const extractRoomCode = (text) => {
    try {
      const url = new URL(text);
      const room = url.searchParams.get('room');
      if (room) return room.toUpperCase();
    } catch {
      // Not a URL, fall through to treat as a bare code
    }
    return text.trim().toUpperCase();
  };

  // Stop camera stream and scan loop
  const stopScanner = () => {
    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach((track) => track.stop());
      scanStreamRef.current = null;
    }
    setShowScanner(false);
  };

  // Open camera and start scanning frames for a QR code
  const openScanner = async () => {
    setScannerError('');
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      scanStreamRef.current = stream;
      if (scanVideoRef.current) {
        scanVideoRef.current.srcObject = stream;
        await scanVideoRef.current.play();
      }

      const canvas = scanCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = () => {
        const video = scanVideoRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            const roomFromScan = extractRoomCode(code.data);
            stopScanner();
            setTargetPeerId(roomFromScan);
            startP2PReceive(roomFromScan);
            return;
          }
        }
        scanRafRef.current = requestAnimationFrame(tick);
      };
      scanRafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setScannerError('Camera access denied or unavailable.');
    }
  };

  // Clean up camera on unmount
  useEffect(() => {
    return () => stopScanner();
  }, []);

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

              {/* FILE DROP ZONE (IF NO FILES SELECTED) */}
              {selectedFiles.length === 0 ? (
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
                    multiple
                  />
                  <div className="dropzone-content">
                    <div className="upload-icon-wrapper">
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h3 className="dropzone-title">Drag & drop your files here</h3>
                      <p className="dropzone-subtitle">or click to browse files from your device</p>
                    </div>
                    <span className="badge" style={{color: 'var(--accent-purple)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : (
                /* FILES SELECTED STATE CARD */
                <div>
                  {selectedFiles.length === 1 ? (
                    <div className="file-card">
                      {renderFileIconComponent(selectedFiles[0].name)}
                      <div className="file-details">
                        <h4 className="file-name">{selectedFiles[0].name}</h4>
                        <p className="file-size">{formatBytes(selectedFiles[0].size)}</p>
                      </div>
                      <button className="remove-file-btn" onClick={() => setSelectedFiles([])}>
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div className="file-card">
                      <File size={24} />
                      <div className="file-details">
                        <h4 className="file-name">{selectedFiles.length} files selected</h4>
                        <p className="file-size">{formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))} total</p>
                      </div>
                      <button className="remove-file-btn" onClick={() => setSelectedFiles([])}>
                        <X size={18} />
                      </button>
                    </div>
                  )}

                  <div className="action-buttons">
                    <button className="btn-primary" onClick={startP2PSend}>
                      <Zap size={18} /> Start P2P Sharing Room
                    </button>
                    <button className="btn-secondary" onClick={() => setSelectedFiles([])}>
                      Cancel Selection
                    </button>
                  </div>
                </div>
              )}

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT) */}
              {selectedFiles.length === 0 && (
                <div>
                  <div className="or-divider">or receive a file</div>
                  <div className="receive-block">
                    <div className="input-group">
                      <div className="input-icon-wrapper">
                        <Download size={20} />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Room Code (e.g. 4D8G2X)"
                        className="code-input"
                        value={targetPeerId}
                        onChange={(e) => setTargetPeerId(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && startP2PReceive()}
                      />
                      <button className="btn-icon-copy" onClick={openScanner} title="Scan QR Code">
                        <QrCode size={20} />
                      </button>
                    </div>
                    <button className="btn-secondary" onClick={() => startP2PReceive()} style={{justifyContent: 'center'}}>
                      Connect & Download
                    </button>
                  </div>
                </div>
              )}

              {/* QR SCANNER MODAL */}
              {showScanner && (
                <div className="qr-scanner-overlay" onClick={stopScanner}>
                  <div className="qr-scanner-panel" onClick={(e) => e.stopPropagation()}>
                    <div className="qr-scanner-header">
                      <span style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                        <Camera size={16} /> Scan Room QR Code
                      </span>
                      <button className="btn-icon-copy" onClick={stopScanner} title="Close">
                        <X size={18} />
                      </button>
                    </div>
                    {scannerError ? (
                      <div className="qr-scanner-error">
                        <AlertCircle size={18} /> {scannerError}
                      </div>
                    ) : (
                      <div className="qr-scanner-video-wrapper">
                        <video ref={scanVideoRef} className="qr-scanner-video" playsInline muted />
                        <div className="qr-scanner-frame" />
                      </div>
                    )}
                    <canvas ref={scanCanvasRef} style={{ display: 'none' }} />
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
                <h3 className="signal-title">
                  Direct P2P Sharing
                </h3>
              </div>

              {/* File Info Inline Pill */}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', background: 'rgba(255,255,255,0.03)', padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', maxWidth: '100%', width: 'fit-content' }}>
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>Sharing:</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                  {selectedFiles.length > 1 ? `${selectedFiles.length} files` : selectedFiles[0]?.name}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>({formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))})</span>
              </div>

              {/* Waiting for connection */}
              {transferState === 'waiting' && (
                <>
                  <div className="signal-radar-wrap">
                    <div className="signal-radar">
                      <div className="orbit-track"></div>
                      <div className="orbit-track orbit-track-2"></div>
                      <div className="orbit-core"></div>
                      <div className="orbit-sat"></div>
                      <div className="orbit-sat orbit-sat-2"></div>
                    </div>
                  </div>

                  <div className="signal-fields">
                    <div className="signal-code-row">
                      <div className="signal-code-digits">
                        {roomCode.split('').map((ch, i) => <span key={i}>{ch}</span>)}
                      </div>
                      <button className="btn-icon-copy" onClick={() => copyToClipboard(roomCode, 'Room code copied!')} title="Copy Code">
                        <Copy size={16} />
                      </button>
                    </div>

                    <div className="signal-link-row">
                      <span>{getSharingUrl()}</span>
                      <button className="btn-icon-copy" onClick={() => copyToClipboard(getSharingUrl(), 'Share link copied!')} title="Copy Link">
                        <Copy size={14} />
                      </button>
                    </div>

                    <div className="signal-qr-row">
                      <div className="signal-qr" onClick={() => setShowQrZoom(true)} role="button" tabIndex={0} title="Tap to enlarge">
                        <QRCodeSVG
                          value={getSharingUrl()}
                          size={72}
                          bgColor={"#ffffff"}
                          fgColor={"#0b0e1c"}
                          level={"H"}
                          includeMargin={false}
                        />
                      </div>
                      <div className="signal-qr-note">
                        <b>Scan to connect</b>
                        Keep this tab open &mdash; the file streams directly, peer to peer. Tap the QR code to enlarge.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="transfer-status-container" style={{width: '100%'}}>
                  {sendFileCount > 1 && (
                    <div className="status-badge" style={{background: 'rgba(139, 92, 246, 0.08)'}}>
                      File {sendFileIndex + 1} of {sendFileCount}: {selectedFiles[sendFileIndex]?.name}
                    </div>
                  )}

                  <div className="status-badge uploading">
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: isPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPaused ? 'Paused' : 'Streaming File...'}
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
                      <div className="stat-value">{isPaused ? 'Paused' : (transferSpeed || 'Connecting...')}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Estimated Time</div>
                      <div className="stat-value">{isPaused ? '--' : (timeRemaining || '--')}</div>
                    </div>
                  </div>

                  <button className="btn-secondary" onClick={togglePauseTransfer} style={{width: '100%', justifyContent: 'center'}}>
                    {isPaused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
                  </button>
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
                    <p className="hero-subtitle">
                      {sendFileCount > 1 ? `Your ${sendFileCount} files were shared directly and securely.` : 'Your file was shared directly and securely.'}
                    </p>
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
                  {receiveFileCount > 1 && (
                    <div className="status-badge" style={{background: 'rgba(139, 92, 246, 0.08)'}}>
                      File {receiveFileIndex + 1} of {receiveFileCount}
                    </div>
                  )}

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
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: isPeerPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPeerPaused ? 'Paused by sender' : 'Receiving File...'}
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
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>
                      {completedFiles.length > 1 ? `${completedFiles.length} Files Received!` : 'File Received!'}
                    </h3>
                    <p className="hero-subtitle">
                      {completedFiles.length > 1
                        ? 'All files were downloaded to your device.'
                        : `${completedFiles[0]?.name || incomingFile?.name || 'Shared file'} was successfully downloaded to your device.`}
                    </p>
                  </div>

                  {completedFiles.length > 0 && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%'}}>
                      {completedFiles.map((f, i) => (
                        <a key={i} href={f.url} download={f.name} className="btn-download-glow" style={{fontSize: '0.85rem'}}>
                          <Download size={16} /> {f.name}
                        </a>
                      ))}
                    </div>
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

      {/* QR ZOOM MODAL */}
      {showQrZoom && createPortal(
        <div className="qr-zoom-overlay" onClick={() => setShowQrZoom(false)}>
          <div className="qr-zoom-panel" onClick={(e) => e.stopPropagation()}>
            <div className="qr-zoom-header">
              <span>Scan to Connect</span>
              <button className="qr-zoom-close" onClick={() => setShowQrZoom(false)} title="Close">
                <X size={18} />
              </button>
            </div>
            <div className="qr-zoom-code">
              <QRCodeSVG
                value={getSharingUrl()}
                size={240}
                bgColor={"#ffffff"}
                fgColor={"#0b0e1c"}
                level={"H"}
                includeMargin={false}
              />
            </div>
            <div className="qr-zoom-roomcode">
              {roomCode.split('').map((ch, i) => <span key={i}>{ch}</span>)}
            </div>
            <button className="qr-zoom-link" onClick={() => copyToClipboard(getSharingUrl(), 'Share link copied!')} title="Copy link">
              <span>{getSharingUrl()}</span>
              <Copy size={14} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
