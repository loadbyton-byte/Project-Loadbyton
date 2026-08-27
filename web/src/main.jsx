import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { LocaleProvider } from './lib/i18n.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { initSentry, SentryErrorBoundary } from './lib/sentry.js';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient.js';
import './index.css';

// Initialize Sentry as early as possible
initSentry();

// Swap the deferred Google Fonts stylesheet to active — see index.html.
document.querySelectorAll('link[data-async-font]').forEach((link) => {
  link.media = 'all';
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LocaleProvider>
          <AuthProvider>
            <ToastProvider>
              <SentryErrorBoundary
                fallback={({ error, resetErrorBoundary }) => (
                  <div className="container-page flex min-h-[60vh] flex-col items-center justify-center text-center">
                    <p className="font-display text-xl font-semibold text-ink">Something went wrong</p>
                    <p className="mt-2 text-sm text-ink-muted">{error.message}</p>
                    <button
                      onClick={resetErrorBoundary}
                      className="mt-4 btn-secondary"
                    >
                      Try again
                    </button>
                  </div>
                )}
              >
                <App />
              </SentryErrorBoundary>
            </ToastProvider>
          </AuthProvider>
        </LocaleProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
