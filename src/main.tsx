import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initPersistence } from './app/actions/persistence';
import { getState } from './app/store';
import { APP_VERSION } from './core/export';
import { App, ErrorBoundary } from './ui/App';
import './ui/styles/base.css';
import './ui/styles/layout.css';
import './ui/styles/editor.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

void initPersistence();

// Read-only hook for debugging and automated tests (see src/types/window.d.ts).
window.sprite8 = { version: APP_VERSION, getState };
