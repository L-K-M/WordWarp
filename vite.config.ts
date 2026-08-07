import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const configuredBase = process.env.VITE_BASE_PATH ?? './';
const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
const appVersion = process.env.npm_package_version ?? '0.0.0';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['wordwarp-icon.svg', 'wordwarp-maskable.svg'],
      manifest: {
        id: base,
        name: 'WordWarp Text Effects Studio',
        short_name: 'WordWarp',
        description: 'Warped, metallic, dimensional text with transparent image export.',
        theme_color: '#04333a',
        background_color: '#03262c',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}wordwarp-icon.svg`, sizes: 'any', type: 'image/svg+xml' },
          { src: `${base}wordwarp-maskable.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{html,js,css,wasm,webmanifest,svg,png,webp,woff,woff2}'],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  test: {
    coverage: {
      reporter: ['text', 'html'],
    },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
