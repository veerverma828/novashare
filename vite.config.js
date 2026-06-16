import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { networkInterfaces } from 'os'

function getLocalIP() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      const family = iface.family;
      // Handle both string and numeric IP families
      if ((family === 'IPv4' || family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network interfaces to expose to local network
  },
  define: {
    'import.meta.env.VITE_LOCAL_IP': JSON.stringify(getLocalIP()),
  }
})
