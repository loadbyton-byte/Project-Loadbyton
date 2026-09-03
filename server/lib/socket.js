// Real-time messaging — Socket.IO layer on top of the existing REST
// messaging endpoint (job-extras.routes.js POST /api/jobs/:id/messages).
// Messages are still created and persisted exactly as before through that
// one write path; this module only adds push delivery to anyone already
// connected, plus the connection-time auth/room-membership checks that
// gate who can receive that push. No new way to create a message exists.
const db = require('../db');
const { parseCookies } = require('./http');
const { isParticipantOrBidder } = require('./helpers');
const { isAllowedOrigin } = require('./config');

let io = null;

// Mirrors middleware/auth.js's session resolution (session lookup, expiry,
// active-user check) rather than importing it directly — that middleware is
// built around (req, res, next), and a socket handshake isn't an Express
// request; duplicating these few lines is simpler and lower-risk than
// reshaping the HTTP middleware to serve both.
async function resolveUserFromCookie(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const token = cookies.lb_session;
  if (!token) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(session.user_id);
  return user || null;
}

function initSocket(httpServer) {
  const { Server } = require('socket.io');
  io = new Server(httpServer, {
    // Lives under /api/ specifically so it rides the same Vercel rewrite
    // ("/api/:path*" -> this Render service) the REST API already uses —
    // no separate cross-origin URL/env var needed for the common deploy
    // shape. If the WebSocket upgrade itself doesn't proxy cleanly through
    // an edge/CDN in front of this, socket.io-client transparently falls
    // back to HTTP long-polling over the same path; either way it works,
    // the only difference is push latency.
    path: '/api/socket.io',
    cors: {
      origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const user = await resolveUserFromCookie(socket.handshake.headers.cookie);
      if (!user) return next(new Error('unauthenticated'));
      socket.user = user;
      next();
    } catch (e) {
      next(new Error('auth_error'));
    }
  });

  io.on('connection', (socket) => {
    // One job room per join — a client viewing job N only receives pushes
    // for job N, not every message on the platform.
    socket.on('join_job', async (jobId, ack) => {
      try {
        const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(jobId));
        if (!job || !(await isParticipantOrBidder(job, socket.user))) {
          if (typeof ack === 'function') ack({ ok: false });
          return;
        }
        socket.join(`job:${job.id}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    });

    socket.on('leave_job', (jobId) => {
      socket.leave(`job:${Number(jobId)}`);
    });
  });

  console.log('[socket] real-time messaging enabled');
  return io;
}

// Called by job-extras.routes.js right after a message is inserted via the
// normal REST path — the only place this fires from.
function emitNewMessage(jobId, message) {
  if (!io) return;
  io.to(`job:${jobId}`).emit('new_message', message);
}

module.exports = { initSocket, emitNewMessage };
