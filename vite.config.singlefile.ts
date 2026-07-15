import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build a SINGLE self-contained index.html (JS + CSS inlined) for hosting on
// Cyera Pages, which serves one static HTML file. Kept separate from the main
// vite.config.ts so the GitHub Pages build (with its /cyera-vantage/ base) is
// untouched. Output goes to dist-singlefile/.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-singlefile',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
})
