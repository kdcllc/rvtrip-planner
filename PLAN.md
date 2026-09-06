# Trip Planner — Multi-User Upgrade Plan

Turn the current client-only SPA into a multi-user app with login and a backend,
staying entirely within the Azure subscription for **~$15/month**.

## Decisions (locked)

- **Everything in Azure** — no external providers (no Cosmos DB, no Supabase/Neon).
- **Database:** Azure Database for PostgreSQL (not Cosmos).
- **Auth:** classic DB-based username/password with hashed passwords (no SWA built-in auth / no OAuth IdP).
- **Password reset:** included in v1 (requires transactional email).
- **DB billing:** pay-as-you-go (no 1-year reservation).

## Current state (for reference)

- React 19 + Vite + TypeScript SPA, deployed to **Azure Static Web Apps (Free tier)** (`infra/main.bicep`).
- All data lives in the browser's **localStorage** (`src/services/storage/tripStorage.ts`). Nothing is per-user or server-side.
- Optional Google Drive sync exists (`src/services/drive/*`) — user backs up their own trips to their own Drive. Not a shared backend.
- Maps / routing / weather / geocoding all use free public APIs, no keys.

---

## Final cost picture

| Layer | Resource | Monthly |
|---|---|---|
| Frontend + Auth API + Trips API | Azure Static Web Apps (Free) + managed Functions | $0 |
| Database | PostgreSQL Flexible Server **B1ms**, 32 GiB, PgBouncer, pay-as-you-go | ~$12–13 compute + ~$3.68 storage |
| Password-reset email | Azure Communication Services Email (Azure-managed domain) | ~pennies (per-email) |
| **Total** | | **~$15–17/mo** |

**Budget notes**
- Pay-as-you-go B1ms + the 32 GiB storage floor lands right at or just over $15 in most regions. Reservation was the only lever to force it strictly below and we've opted out.
- Pick a cheap region (e.g. Central US), keep storage at the 32 GiB minimum (trip JSON is tiny).
- **Set an Azure budget alert at $15.** Expect the bill to hover ~$16.
- Check whether this subscription still has the **Azure free-account 12-month B1ms offer** — if so, the DB is $0 for a year.

---

## Phase 1 — Infrastructure (`infra/main.bicep`)

The existing bicep only provisions the Static Web App. Add:

1. **PostgreSQL Flexible Server** — `Microsoft.DBforPostgreSQL/flexibleServers`
   - SKU `Standard_B1ms`, tier `Burstable`, 32 GiB storage, no HA, 7-day backup (free).
   - **Enable built-in PgBouncer** (`pgbouncer.enabled=true`, transaction pooling, port 6432) — mandatory given B1ms's ~35 connection cap and Functions scaling out.
   - Firewall rule **"Allow Azure services"** (0.0.0.0) so free-tier SWA Functions can reach it. (VNet / private endpoint would force SWA Standard — avoid.)
2. **Azure Communication Services** + **Email Communication Service** with an **Azure-managed domain** (instant sender like `donotreply@<id>.azurecomm.net`, free, no DNS).
3. **App settings** on the Static Web App (mark secure):
   - `PG_CONNECTION_STRING` (point at PgBouncer, port 6432)
   - `SESSION_SECRET`
   - `ACS_CONNECTION_STRING`
   - `APP_BASE_URL`

## Phase 2 — Database schema (migration script)

```sql
users (
  id uuid pk, email text unique not null, password_hash text not null,
  email_verified bool default false, failed_attempts int default 0,
  locked_until timestamptz, created_at timestamptz )

sessions (
  token text pk, user_id uuid fk, expires_at timestamptz, created_at timestamptz )

password_reset_tokens (
  token text pk, user_id uuid fk, expires_at timestamptz, used bool default false )

trips (
  id uuid pk, user_id uuid fk, data jsonb not null, updated_at timestamptz )
-- index trips(user_id)
```

`Trip` / `TripStop` types (`src/domain/trip/types.ts`) stay untouched — trips are stored as JSONB.

## Phase 3 — Auth API (new `api/` Functions folder)

| Endpoint | Does |
|---|---|
| `POST /api/register` | validate email/password, **argon2id** hash, insert user |
| `POST /api/login` | verify hash, check lockout, create session, set **HttpOnly Secure SameSite=Lax** cookie |
| `POST /api/logout` | delete session row, clear cookie |
| `GET /api/me` | validate session cookie → return current user |
| `POST /api/forgot-password` | create reset token, **email link via ACS** (always return 200 to avoid account enumeration) |
| `POST /api/reset-password` | validate token (unused + unexpired), set new hash, invalidate token + existing sessions |

Cross-cutting: parameterized queries only (`pg`), per-account failed-attempt lockout, reset tokens single-use with short TTL (~1 hr).

## Phase 4 — Trips API

- `GET /api/trips` → session-validated, returns caller's `TripsState`.
- `PUT /api/trips` → upserts caller's trips.

A shared session-validation helper guards both (reads cookie → looks up `sessions` → checks expiry).

## Phase 5 — Frontend integration

- **Auth screens:** login, register, forgot-password, reset-password (reset page reads token from URL).
- **The one code seam:** `src/services/storage/tripStorage.ts` — when authenticated, `loadTripsFromStorage` / `saveTripsToStorage` call `/api/trips`; keep localStorage as the anonymous/offline fallback. Add auth/user state to `App.tsx`.
- **Migration:** on first login, if localStorage has trips, `PUT` them to the backend (reuse existing export-JSON logic), then treat the server as source of truth.

## Phase 6 — Config & deploy

- `staticwebapp.config.json`: gate `/api/trips*` (auth endpoints stay public); no new `connect-src` domains needed — the API is same-origin.
- Deploy via existing `azd` / GitHub Actions pipeline. Run the SQL migration once against the new server.

---

## Security checklist (must-haves)

- [ ] argon2id (or bcrypt), never plain/SHA
- [ ] HttpOnly + Secure + SameSite cookies; server-side revocable sessions
- [ ] Parameterized queries everywhere
- [ ] Login rate-limit / lockout
- [ ] Reset tokens: single-use, short TTL, generic "email sent" response
- [ ] Secrets in SWA app settings, never committed
- [ ] Invalidate sessions on password reset
