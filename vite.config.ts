import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages はリポジトリ名がパスの先頭に付く。ローカル確認は `VITE_BASE=/` で上書き。
const base = process.env.VITE_BASE ?? '/tiktok-live-pocket/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'TikTok LIVE ポケット',
        short_name: 'LIVEポケット',
        description: 'TikTok LIVE のコメント・入室・ギフトを手元の iPhone で見る',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1116',
        theme_color: '#0f1116',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリシェルだけをプリキャッシュ。TikTok CDN の画像は署名付き URL で期限切れになるので
        // ランタイムキャッシュもしない(古い画像を出すより毎回取り直す方が安全)。
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,ndjson}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
