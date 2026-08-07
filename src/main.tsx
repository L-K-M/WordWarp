import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './app/App';
import { announceServiceWorkerUpdate } from './service-worker-update';
import { ensureUiFonts } from './text/fonts';
import './styles.css';

ensureUiFonts();

const updateServiceWorker: (reloadPage?: boolean) => Promise<void> = registerSW({
  immediate: true,
  onNeedRefresh: () => announceServiceWorkerUpdate(() => updateServiceWorker(true)),
  onRegisterError: (error) => console.error('WordWarp service worker registration failed', error),
});

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('WordWarp root element was not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
