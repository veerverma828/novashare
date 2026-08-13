import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { initNative } from './native.js'
import { installGlobalErrorHandlers, recordError } from './crashLog.js'

installGlobalErrorHandlers()
// Anything thrown here would run before createRoot and take the whole app down with
// nothing rendered — and since the native splash is only dismissed from inside App,
// the user would be left staring at a splash that never leaves. None of this setup
// is required for the app to render, so a failure degrades instead of blocking.
try {
  initNative()
} catch (err) {
  recordError('initNative', err)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
