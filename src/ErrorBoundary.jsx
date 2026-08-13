import { Component } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { AlertTriangle, RefreshCw, Share2 } from 'lucide-react';
import { recordError, formatCrashLogForShare } from './crashLog.js';
import { shareText } from './native.js';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info.componentStack);
    recordError('ErrorBoundary', error);

    // The only SplashScreen.hide() in the app is an effect inside App — the very tree that
    // just failed — and launchAutoHide is off, so a crash before that effect ran leaves the
    // native splash sitting on top of this screen with no way out. Releasing it here is what
    // makes the error (and its Reload button) reachable at all.
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeDuration: 200 }).catch(() => {});
    }
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleShare = () => {
    shareText(formatCrashLogForShare(), 'NovaShare error report').catch(() => {});
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary text-text-primary p-6">
        <div className="w-full max-w-[420px] flex flex-col items-center gap-4 text-center bg-bg-secondary border border-border rounded-[20px] p-8">
          <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center bg-[rgba(248,113,113,0.15)] text-accent-pink">
            <AlertTriangle size={28} />
          </div>
          <div className="flex flex-col gap-1">
            <b className="font-heading text-[1.05rem]">Something went wrong</b>
            <p className="text-[0.85rem] text-text-secondary leading-[1.5]">
              NovaShare hit an unexpected error. Reloading usually fixes it — your files aren't affected.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button
              className="relative overflow-hidden flex items-center justify-center gap-2 bg-accent-purple text-[#06222c] border-0 font-heading text-[0.95rem] font-semibold py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-px hover:brightness-110"
              onClick={this.handleReload}
            >
              <RefreshCw size={16} /> Reload App
            </button>
            <button
              className="relative overflow-hidden flex items-center justify-center gap-2 bg-transparent border border-border text-text-primary font-heading text-[0.9rem] font-medium py-[0.7rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary"
              onClick={this.handleShare}
            >
              <Share2 size={15} /> Share Error Report
            </button>
          </div>
        </div>
      </div>
    );
  }
}
