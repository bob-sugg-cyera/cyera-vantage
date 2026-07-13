import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves from /<repo>/ — assets need this base path to resolve.
  base: "/cyera-vantage/",
  plugins: [react()],
  server: {
    // Allow tunnel hosts (localtunnel / cloudflare) to reach the dev server.
    // Safe for a synthetic-data demo; tighten if this ever serves real data.
    allowedHosts: true,
  },
})
