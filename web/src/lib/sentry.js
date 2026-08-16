// Sentry error tracking for the React app — safely no-ops if SENTRY_DSN is not set.

let Sentry = null;
let initialized = false;

export async function initSentry() {
  if (initialized) return;
  initialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] VITE_SENTRY_DSN not set — error tracking disabled');
    return;
  }

  try {
    const SentryModule = await import('@sentry/react');
    Sentry = SentryModule;
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE || 'development',
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      beforeSend(event, hint) {
        const error = hint.originalException;
        if (error && error.response && error.response.status < 500) {
          return null;
        }
        return event;
      },
    });
    console.log('[Sentry] initialized');
  } catch (e) {
    console.warn('[Sentry] failed to initialize:', e.message);
    Sentry = null;
  }
}

export function captureException(error, context = {}) {
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      if (context.userId) scope.setUser({ id: String(context.userId) });
      if (context.jobId) scope.setTag('job_id', String(context.jobId));
      if (context.extra) scope.setExtras(context.extra);
      Sentry.captureException(error);
    });
  } catch (e) {
    console.error('[Sentry] captureException failed:', e.message);
  }
}

export function captureMessage(message, level = 'info', context = {}) {
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      if (context.userId) scope.setUser({ id: String(context.userId) });
      if (context.extra) scope.setExtras(context.extra);
      Sentry.captureMessage(message, level);
    });
  } catch (e) {
    console.error('[Sentry] captureMessage failed:', e.message);
  }
}

export function setUserContext(user) {
  if (!Sentry) return;
  try {
    Sentry.setUser(user ? { id: String(user.id), email: user.email, role: user.role } : null);
  } catch (e) {
    console.error('[Sentry] setUserContext failed:', e.message);
  }
}

export const SentryErrorBoundary = Sentry
  ? Sentry.ErrorBoundary
  : ({ children, fallback: _fallback }) => children;