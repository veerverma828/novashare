import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// App.jsx pulls in native.js -> @capacitor/core's Capacitor.isNativePlatform().
// AppsPanel's list/search/select behavior only renders when that's true, so
// we mock @capacitor/core to force "native" for these tests, and mock
// native.js's app-listing/APK helpers so nothing touches a real bridge.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    convertFileSrc: (p) => p,
  },
  registerPlugin: () => ({
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  }),
}));

vi.mock('./native', () => ({
  listInstalledApps: vi.fn(),
  getAppIcon: vi.fn(() => Promise.resolve(null)),
  getAppApkFile: vi.fn(),
  clearApkCache: vi.fn(() => Promise.resolve()),
  triggerHaptic: vi.fn(),
}));

vi.mock('./history', () => ({
  getHistory: vi.fn(),
  addHistoryEntry: vi.fn(),
  clearHistory: vi.fn(),
}));

import { AppsPanel, HistoryPanel } from './App.jsx';
import { listInstalledApps, getAppApkFile } from './native';
import { getHistory } from './history';

const formatBytes = (n) => `${n}B`;

describe('AppsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state, then the list once listInstalledApps resolves', async () => {
    let resolveList;
    listInstalledApps.mockReturnValue(new Promise((res) => { resolveList = res; }));

    render(<AppsPanel onSelectApps={vi.fn()} formatBytes={formatBytes} />);

    expect(screen.getByText(/Loading installed apps/i)).toBeInTheDocument();

    resolveList([
      { packageName: 'com.a.app', appName: 'Alpha', versionName: '1.0', apkSize: 1000 },
      { packageName: 'com.b.app', appName: 'Beta', versionName: '2.0', apkSize: 2000 },
    ]);

    await waitFor(() => expect(screen.queryByText(/Loading installed apps/i)).not.toBeInTheDocument());

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('filters the list by search query, case-insensitively', async () => {
    listInstalledApps.mockResolvedValue([
      { packageName: 'com.a.app', appName: 'Alpha', versionName: '1.0', apkSize: 1000 },
      { packageName: 'com.b.app', appName: 'Beta', versionName: '2.0', apkSize: 2000 },
    ]);

    render(<AppsPanel onSelectApps={vi.fn()} formatBytes={formatBytes} />);

    await screen.findByText('Alpha');

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search installed apps/i), 'alp');

    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Alpha')).toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Beta')).not.toBeInTheDocument();
  });

  it('selects apps and calls onSelectApps with prepared Files on confirm', async () => {
    listInstalledApps.mockResolvedValue([
      { packageName: 'com.a.app', appName: 'Alpha', versionName: '1.0', apkSize: 1000 },
      { packageName: 'com.b.app', appName: 'Beta', versionName: '2.0', apkSize: 2000 },
    ]);
    const alphaFile = new File(['x'], 'Alpha-1.0.apk');
    const betaFile = new File(['y'], 'Beta-2.0.apk');
    getAppApkFile.mockImplementation((packageName) => {
      if (packageName === 'com.a.app') return Promise.resolve(alphaFile);
      if (packageName === 'com.b.app') return Promise.resolve(betaFile);
      return Promise.reject(new Error('unknown'));
    });

    const onSelectApps = vi.fn();
    render(<AppsPanel onSelectApps={onSelectApps} formatBytes={formatBytes} />);

    await screen.findByText('Alpha');

    const user = userEvent.setup();
    await user.click(screen.getByText('Alpha'));
    await user.click(screen.getByText('Beta'));

    const shareBtn = screen.getByRole('button', { name: /Share 2 Apps/i });
    await user.click(shareBtn);

    await waitFor(() => expect(onSelectApps).toHaveBeenCalledTimes(1));
    expect(onSelectApps).toHaveBeenCalledWith([alphaFile, betaFile]);
  });

  it('shows an error state when listInstalledApps rejects', async () => {
    listInstalledApps.mockRejectedValue(new Error('permission denied'));

    render(<AppsPanel onSelectApps={vi.fn()} formatBytes={formatBytes} />);

    await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
  });
});

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an empty state when there is no history', () => {
    getHistory.mockReturnValue([]);

    render(<HistoryPanel formatBytes={formatBytes} onResend={vi.fn()} onClear={vi.fn()} now={Date.now()} />);

    expect(screen.getByText(/No transfers yet/i)).toBeInTheDocument();
  });

  it('renders a list of entries with direction/status/file info', () => {
    const now = Date.now();
    getHistory.mockReturnValue([
      {
        id: '1',
        timestamp: now - 10000,
        direction: 'sent',
        kind: 'file',
        files: [{ name: 'report.pdf', size: 500 }],
        peerLabel: 'Laptop',
        roomCode: 'ABCD',
        status: 'complete',
      },
      {
        id: '2',
        timestamp: now - 86400000 * 2,
        direction: 'received',
        kind: 'text',
        files: [{ name: 'note.txt', size: 20 }, { name: 'note2.txt', size: 30 }],
        peerLabel: 'Phone',
        roomCode: 'WXYZ',
        status: 'complete',
      },
    ]);

    render(<HistoryPanel formatBytes={formatBytes} onResend={vi.fn()} onClear={vi.fn()} now={now} />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2 text snippets/)).toBeInTheDocument();
    expect(screen.getByText(/Sent/)).toBeInTheDocument();
    expect(screen.getByText(/Received/)).toBeInTheDocument();
    expect(screen.getByText('2 transfers')).toBeInTheDocument();
  });

  it('calls onClear when Clear is clicked', async () => {
    getHistory.mockReturnValue([
      { id: '1', timestamp: Date.now(), direction: 'sent', kind: 'file', files: [{ name: 'a.txt', size: 1 }], peerLabel: 'X', roomCode: 'AAAA', status: 'complete' },
    ]);
    const onClear = vi.fn();

    render(<HistoryPanel formatBytes={formatBytes} onResend={vi.fn()} onClear={onClear} now={Date.now()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Clear/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('calls onResend with the entry when Re-send is clicked (sent entries only)', async () => {
    const entry = { id: '1', timestamp: Date.now(), direction: 'sent', kind: 'file', files: [{ name: 'a.txt', size: 1 }], peerLabel: 'X', roomCode: 'AAAA', status: 'complete' };
    getHistory.mockReturnValue([entry]);
    const onResend = vi.fn();

    render(<HistoryPanel formatBytes={formatBytes} onResend={onResend} onClear={vi.fn()} now={Date.now()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Re-send/i }));

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledWith(entry);
  });

  it('does not render a Re-send button for received entries', () => {
    getHistory.mockReturnValue([
      { id: '1', timestamp: Date.now(), direction: 'received', kind: 'file', files: [{ name: 'a.txt', size: 1 }], peerLabel: 'X', roomCode: 'AAAA', status: 'complete' },
    ]);

    render(<HistoryPanel formatBytes={formatBytes} onResend={vi.fn()} onClear={vi.fn()} now={Date.now()} />);

    expect(screen.queryByRole('button', { name: /Re-send/i })).not.toBeInTheDocument();
  });

  it('formats relative time differently for a recent vs older entry', () => {
    const now = Date.now();
    getHistory.mockReturnValue([
      { id: 'recent', timestamp: now - 5000, direction: 'sent', kind: 'file', files: [{ name: 'recent.txt', size: 1 }], peerLabel: 'X', roomCode: 'AAAA', status: 'complete' },
      { id: 'old', timestamp: now - 86400000 * 5, direction: 'sent', kind: 'file', files: [{ name: 'old.txt', size: 1 }], peerLabel: 'X', roomCode: 'BBBB', status: 'complete' },
    ]);

    render(<HistoryPanel formatBytes={formatBytes} onResend={vi.fn()} onClear={vi.fn()} now={now} />);

    expect(screen.getByText(/just now/)).toBeInTheDocument();
    const oldDateLabel = new Date(now - 86400000 * 5).toLocaleDateString();
    expect(screen.getByText(new RegExp(oldDateLabel.replace(/\//g, '\\/')))).toBeInTheDocument();
  });
});
