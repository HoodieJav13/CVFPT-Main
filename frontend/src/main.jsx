import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initPwa } from './lib/pwa';
import { initErrorReporting } from './lib/errorReporting';
import { isPreviewMode } from './lib/previewFlag';
import { previewReady } from './lib/api';
import AppErrorBoundary from './components/AppErrorBoundary';

initPwa();
initErrorReporting();

const render = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>
);

// In preview mode the mock adapter must be installed before any page can
// fire an API call; in real mode previewReady is already resolved.
if (isPreviewMode) previewReady.then(render);
else render();
