import { defineConfig } from 'vite';
import { licenseNotices } from './src/build/licenses';

// A separate bundle keeps native resources independent of the PWA service worker.
// The native hosts map this directory to a local, app-owned origin.
export default defineConfig({
  plugins: [licenseNotices()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  build: {
    outDir: 'dist-native',
    emptyOutDir: true,
    rolldownOptions: { input: 'native.html' },
  },
});
