# Migrations — drizzle-orm style, versioned, with down scripts

- `001_initial.js` — users, profiles
- `002_jobs_bids.js` — jobs, bids, indexes
- Future: `003_shipment_legs.js` etc. — each `addColumn` from `db.js:232` becomes a migration file with `up`/`down`.

Run: `node server/migrate.js up` or `down`. `db.js` still runs `addColumn` idempotently for single-writer boot (safe for Render), but team PRs must add a migration file here.
