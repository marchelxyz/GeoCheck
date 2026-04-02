import { applyTelegramPolyfillFromUrl } from './telegramWebAppInit.js';
import { extractAuthTokenFromUrl, setupAuthTokenInterceptor } from './authFallback.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

applyTelegramPolyfillFromUrl();
extractAuthTokenFromUrl();
setupAuthTokenInterceptor();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
