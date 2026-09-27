<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Dependencies: `npm ci` from the repo root (Node.js 22, `package-lock.json`). The optional `msnodesqlv8` package is Windows-only and is not required on Linux.
- App server: `npm run dev:app` — Next.js 16 with webpack on http://localhost:5500. Do not switch this to Turbopack; `next.config.ts` notes that Turbopack mis-resolves `/api/public/booking/*` when a `[code]` route is a sibling. `npm run dev` also starts the nightly-close watcher (`scripts/run-nightly-close.ts --watch`), which only fires at 02:00 Africa/Cairo and is not required to boot the UI.
- Checks: `npm test` (Vitest, one file at a time) and `npm run lint`. Lint currently exits non-zero because of existing issues across `src/`, `scripts/`, `print-service/`, and `tmp/`.
- SQL Server is required for a successful login and for tests that open a connection. Copy `.env.example` to `.env.local` and set `DB_SERVER`, `DB_PORT`, `DB_DATABASE` (or `DB_NAME`), `DB_USER`, and `DB_PASSWORD`. `db/migrations` is incremental and assumes an existing database; it is not a schema you can apply to an empty server. Windows development usually reaches SQL through the SSH tunnel in `docs/vps-sql-tunnel.md` (local port 14330). `SESSION_SECRET` is required only when `NODE_ENV=production`; development falls back to a built-in secret.
- Without a database these still work: `GET /login`, `GET /api/auth/login`, `GET /api/auth/session`, and the login form’s empty-field validation. A credential submit returns a connection error until SQL is reachable.
- `print-service/` is a Windows thermal-printer helper (port 7788, printer `XP-80`). It is not part of starting the Next.js app. `sync-service/` is gitignored and is not in this checkout.
