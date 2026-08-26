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
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-user-timing-guard', 10);
const DIST_DIR = path.join(__dirname, '..', '..', 'web', 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');

module.exports = {
  PORT, FRONTEND_URL, ADDITIONAL_ORIGINS, isAllowedOrigin,
  INTERNAL_KEY, DUMMY_PASSWORD_HASH, DIST_DIR, DIST_INDEX,
};
