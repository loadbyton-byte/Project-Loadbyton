const bcrypt = require('bcryptjs');
const db = require('../db');
const { sendError } = require('../lib/http');
const { SEAT_ROLES } = require('../lib/constants');
const { writeAudit } = require('../lib/helpers');
const { auth, requireSeatRole } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/org/members', auth(['SHIPPER', 'CARRIER']), async (req, res) => {
  const seats = await db
    .prepare('SELECT id, email, display_name, seat_role, is_active, created_at FROM users WHERE org_owner_id=? ORDER BY created_at ASC')
    .all(req.user.id);
  res.json({
    root: { id: req.user.id, email: req.user.email, displayName: req.user.profile ? req.user.profile.company_name : req.user.email },
    seats,
  });
});

router.post('/api/org/members', auth(['SHIPPER', 'CARRIER']), requireSeatRole([]), async (req, res) => {
  const { email, password, seatRole, displayName } = req.body || {};
  if (!email || !password) return sendError(res, 400, 'email and password are required');
  if (!SEAT_ROLES.includes(seatRole)) return sendError(res, 422, `seatRole must be one of ${SEAT_ROLES.join(', ')}`);
  // DRIVER seats must be created via POST /api/fleet/drivers/:id/seat, which
  // links the seat to a roster row (drivers.seat_user_id) — the link every
  // DRIVER-seat authorization check (lib/helpers.js's
  // getAssignedDriverSeatId) depends on. A seat created here would have no
  // roster row and, correctly, no access to anything.
  if (seatRole === 'DRIVER') return sendError(res, 422, 'DRIVER seats are created from the driver roster (Fleet), not here');
  if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) return sendError(res, 400, 'An account with that email already exists');

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = await db
    .prepare('INSERT INTO users (email, password_hash, role, tier, org_owner_id, seat_role, display_name, is_verified) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
    .run(email, passwordHash, req.user.role, 'BRONZE', req.user.id, seatRole, displayName || null, req.user.is_verified ? 1 : 0);
  const seatId = Number(result.lastInsertRowid);
  await writeAudit(req, { userId: req.actorId, action: 'ORG_MEMBER_ADD', details: `Added seat ${email} (${seatRole})`, entityType: 'user', entityId: seatId });
  const seat = await db.prepare('SELECT id, email, display_name, seat_role, is_active, created_at FROM users WHERE id=?').get(seatId);
  res.status(201).json({ seat });
});

router.patch('/api/org/members/:id', auth(['SHIPPER', 'CARRIER']), requireSeatRole([]), async (req, res) => {
  const seat = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!seat || seat.org_owner_id !== req.user.id) return sendError(res, 404, 'Seat not found');
  const { seatRole, isActive } = req.body || {};
  if (seatRole !== undefined && !SEAT_ROLES.includes(seatRole)) return sendError(res, 422, `seatRole must be one of ${SEAT_ROLES.join(', ')}`);
  // A DRIVER seat's role is tied to its drivers.seat_user_id roster link —
  // changing it here (either direction) would desync that link. isActive
  // (e.g. deactivating a driver's login) still works fine below.
  if (seatRole !== undefined && (seatRole === 'DRIVER' || seat.seat_role === 'DRIVER')) {
    return sendError(res, 422, 'Driver seat roles are managed from the driver roster (Fleet), not here');
  }

  const sets = [];
  const params = [];
  if (seatRole !== undefined) { sets.push('seat_role=?'); params.push(seatRole); }
  if (isActive !== undefined) { sets.push('is_active=?'); params.push(isActive ? 1 : 0); }
  if (sets.length) {
    params.push(seat.id);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id=?`).run(...params);
    // Deactivating a seat must also kill any live session for it immediately —
    // otherwise a seat already logged in stays fully active until their
    // cookie naturally expires, up to 7 days later.
    if (isActive === false) await db.prepare('DELETE FROM sessions WHERE acting_seat_id=?').run(seat.id);
  }
  await writeAudit(req, { userId: req.actorId, action: 'ORG_MEMBER_UPDATE', details: `Updated seat #${seat.id}`, entityType: 'user', entityId: seat.id });
  const updated = await db.prepare('SELECT id, email, display_name, seat_role, is_active, created_at FROM users WHERE id=?').get(seat.id);
  res.json({ seat: updated });
});

module.exports = router;
