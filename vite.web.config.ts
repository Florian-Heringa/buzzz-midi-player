// Builds the renderer as a standalone web page (GitHub Pages) into out/web. The page provides
// its own host API (src/renderer/src/web) since there is no Electron preload.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  // Relative URLs, so the site works under /buzzz-midi-player/ as well as at a domain root.
  base: './',
  // Served next to the page: soundfonts/GeneralUser-GS.sf2 (with its license) and icons/.
  publicDir: resolve('resources'),
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [
    react(),
    {
      name: 'web-favicon',
      transformIndexHtml: () => [
        {
          tag: 'link',
          attrs: { rel: 'icon', type: 'image/png', href: 'icons/icon.png' },
          injectTo: 'head'
        }
      ]
    },
    {
      // The license notices the desktop app shows from its Help menu, linked from the start page.
      // As .txt, which browsers display (GitHub Pages may offer .md files as downloads).
      name: 'web-licenses',
      apply: 'build',
      generateBundle() {
        const files = {
          'LICENSE.txt': 'LICENSE',
          'THIRD_PARTY_NOTICES.txt': 'THIRD_PARTY_NOTICES.md'
        }
        for (const [fileName, source] of Object.entries(files)) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(source)) })
        }
      }
    }
  ],
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true
  }
})
