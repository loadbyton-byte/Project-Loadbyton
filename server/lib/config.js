const path = require('node:path');
const bcrypt = require('bcryptjs');
const { randomToken } = require('./http');

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const ADDITIONAL_ORIGINS = (process.env.ADDITIONAL_ORIGINS || 'https://loadbyton.ae')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
function isAllowedOrigin(origin) {
  return Boolean(origin) && (origin === FRONTEND_URL || ADDITIONAL_ORIGINS.includes(origin));
}
const INTERNAL_KEY = process.env.INTERNAL_KEY || randomToken(16);
if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_KEY) {
  console.warn('[config] WARNING: INTERNAL_KEY not set in production — generated ephemeral key. Set INTERNAL_KEY env for stable cron auth.');
}
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY must be set in production. Generate with: openssl rand -hex 32');
}
if (process.env.NODE_ENV === 'production' && process.env.PAYMENTS_PROVIDER === 'mock') {
  throw new Error('PAYMENTS_PROVIDER=mock is forbidden in production');
}
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.warn('[config] WARNING: DATABASE_URL not set in production — falling back to SQLite (ephemeral). Set USE_POSTGRES=true + DATABASE_URL for durable storage. See docs/DEVELOPER_GUIDE.md');
}
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL && process.env.USE_POSTGRES !== 'true') {
  console.warn('[config] WARNING: DATABASE_URL set but USE_POSTGRES!=true — SQLite still active. Set USE_POSTGRES=true to use Postgres.');
}
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-user-timing-guard', 10);
const DIST_DIR = path.join(__dirname, '..', '..', 'web', 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');

module.exports = {
  PORT, FRONTEND_URL, ADDITIONAL_ORIGINS, isAllowedOrigin,
  INTERNAL_KEY, DUMMY_PASSWORD_HASH, DIST_DIR, DIST_INDEX,
};
