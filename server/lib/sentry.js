// Sentry error tracking — safely no-ops if SENTRY_DSN is not set.
// Mirrors server/lib/email.js and server/lib/whatsapp.js patterns.

let Sentry = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }
  // Render dashboard currently has SENTRY_DSN=f3aaa004... (not a URL) — treat any
  // non-URL as unset so the server still boots. A real DSN is https://<key>@<host>/<id>.
  if (!dsn.includes('://')) {
    console.log('[Sentry] SENTRY_DSN looks invalid (not a URL) — error tracking disabled');
    return;
  }

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
      beforeSend(event, hint) {
        const error = hint.originalException;
        if (error && error.status && error.status < 500) {
          return null;
        }
        // PII scrub: Sentry's requestHandler attaches the full request —
        // body, cookies, headers — which for this API contains passwords,
        // IBANs, TRN numbers, and file base64. Drop everything sensitive
        // before the event leaves the process.
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          delete event.request.body;
          if (event.request.headers) {
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
            delete event.request.headers['x-api-key'];
          }
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

function captureException(error, context = {}) {
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('request_id', context.requestId);
      if (context.userId) scope.setUser({ id: String(context.userId) });
      if (context.jobId) scope.setTag('job_id', String(context.jobId));
      if (context.extra) scope.setExtras(context.extra);
      Sentry.captureException(error);
    });
  } catch (e) {
    console.error('[Sentry] captureException failed:', e.message);
  }
}

function captureMessage(message, level = 'info', context = {}) {
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('request_id', context.requestId);
      if (context.userId) scope.setUser({ id: String(context.userId) });
      if (context.extra) scope.setExtras(context.extra);
      Sentry.captureMessage(message, level);
    });
  } catch (e) {
    console.error('[Sentry] captureMessage failed:', e.message);
  }
}

function expressErrorHandler() {
  if (!Sentry || !Sentry.Handlers || !Sentry.Handlers.errorHandler) return (err, req, res, next) => next(err);
  return Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      return error.status >= 500;
    },
  });
}

function requestHandler() {
  if (!Sentry || !Sentry.Handlers || !Sentry.Handlers.requestHandler) return (req, res, next) => next();
  return Sentry.Handlers.requestHandler();
}

module.exports = {
  init,
  captureException,
  captureMessage,
  expressErrorHandler,
  requestHandler,
  isEnabled: () => !!Sentry,
};