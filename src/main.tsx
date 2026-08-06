import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('WordWarp root element was not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
