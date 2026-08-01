import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initPwa } from './lib/pwa';
import AppErrorBoundary from './components/AppErrorBoundary';

initPwa();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>
);
