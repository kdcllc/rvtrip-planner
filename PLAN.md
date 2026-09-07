# Trip Planner — Multi-User Upgrade Plan

Turn the current client-only SPA into a multi-user app with login and a backend,
staying entirely within the Azure subscription for **$0/month steady-state**
(revised down from ~$15/month on 2026-09-06 — see "Research findings").

## Decisions (locked)

- **Everything in Azure** — no external providers (no Supabase/Neon).
- **Database: Azure SQL Database, General Purpose *serverless*, on the free offer.**
  Changed 2026-09-06 (was PostgreSQL Flexible Server B1ms). 100,000 vCore-s + 32 GB data
  + 32 GB backup **free per database per month, perpetually**, explicitly "available
  regardless of your Azure subscription type." Two settings are load-bearing:
  **auto-pause delay = 15 minutes** (not the 60-min default) and
  **`freeLimitExhaustionBehavior = AutoPause`** (set explicitly in Bicep — see risks).
- **Auth:** classic DB-based username/password with hashed passwords (no SWA built-in auth / no OAuth IdP).
- **Password reset:** included in v1 (requires transactional email).
- **DB billing:** free offer, auto-pause on grant exhaustion (hard $0 ceiling).
- **Hosting: CLOSED 2026-09-07 — Static Web Apps Free + built-in *managed* Functions**
  ("Shape C"). Reopened 2026-09-06, researched, and settled back to the original choice.
  Managed Functions are available on **all plans including Free** and Microsoft documents
  the `/api` route as reaching the SPA *"without requiring custom CORS rules"* — so it is
  **same-origin by construction, always-warm static, and $0**. Container Apps remains the
  documented fallback (**Shape A**, also $0) if the blocking spike below fails.
- **Linking an external backend (Container App or BYO Functions) requires SWA Standard,
  $9.00/app/month.** There is no `staticwebapp.config.json` workaround — `rewrite` values
  must be root-relative and API route rules support only redirects and role-securing.
- **Cold start is acceptable (confirmed 2026-09-06).** Scale-to-zero / `minReplicas: 0`
  is the default posture. **Do not pin a warm replica** — that is the one choice that
  turns a $0 hosting bill into ~$4–10/mo. A few seconds of latency on the first request
  after idle is an accepted tradeoff.
- **⚠️ The backend MUST NOT hold an idle connection pool.** This is now an architectural
  constraint, not a preference: open sessions are the documented #1 reason a serverless
  database fails to auto-pause, and a database that never pauses burns the entire monthly
  grant in ~40 hours. Scale-to-zero compute and `pool.min = 0` are **required** to hold
  the $0. This constraint propagates into the backend-stack choice.
- **Subscription: pay-as-you-go with ~$700 of Azure credit (confirmed 2026-09-06).**
  Consequences: (a) the **Azure free-account 12-month offers do not apply** — this is not
  a new free account, so only **perpetual** free tiers/grants are usable; (b) at the
  ~$16/mo plan estimate the credit is ~43 months of runway, so cost work is about
  **extending runway and the post-credit bill**, not affordability.

## Current state (for reference)

- React 19 + Vite + TypeScript SPA, deployed to **Azure Static Web Apps (Free tier)** (`infra/main.bicep`).
- All data lives in the browser's **localStorage** (`src/services/storage/tripStorage.ts`). Nothing is per-user or server-side.
- Optional Google Drive sync exists (`src/services/drive/*`) — user backs up their own trips to their own Drive. Not a shared backend.
- Maps / routing / weather / geocoding all use free public APIs, no keys.

---

## Final cost picture

| Layer | Resource | Monthly |
|---|---|---|
| Database | **Azure SQL DB, GP serverless, free offer**, auto-pause 15 min | **$0** (~40% of grant used) |
| DB storage + backup | 32 GB data + 32 GB backup, included in the offer (we use <1 GiB) | **$0** |
| Static SPA + API | **Azure Static Web Apps Free + managed Functions** — verified: 100 GB/mo bandwidth (per subscription), 250 MB/env, 15,000 files, 2 custom domains, free managed TLS | **$0** |
| Password-reset email | Azure Communication Services, Azure-managed domain, pay-per-message | **~$0.005** (20 × $0.00025) |
| **Total** | | **~$0.005/mo steady-state** |

**SWA Free cannot generate a surprise bill.** Exceeding the 100 GB bandwidth quota
**blocks service rather than billing overage** — `Overage bandwidth: Unavailable` on Free.
Combined with the database's `AutoPause` ceiling, the architecture's worst case is
*downtime*, never an unexpected charge.

**Budget notes**
- The free offer's grant is consumed by **wall-clock database online time**, not request
  count. Our long idle periods are what *make* this free.
- **Set an Azure budget alert at $5**, low enough to catch a silent fall-off the free offer.
- **Region is locked permanently per subscription** at first free-database creation. Choose
  for colocation with the ACA app, not price — the free offer costs $0 everywhere.
- The ~$700 credit is now runway for essentially nothing. Its main use becomes covering the
  one paid line (email) and any experiment.

---

---

## Research findings — hosting (2026-09-06)

Source: [`_research/azure-backend-stack/report.md`](_research/azure-backend-stack/report.md).
Deep-research pass covering **hosting only** (prompt questions 1–3, part of 5). The
database, backend-stack, auth, email, and deploy-mechanics questions were **not**
answered — they are open, not settled.

### Confirmed, carry forward

- **ACA Consumption has a recurring monthly free grant**: 180,000 vCPU-s, 360,000 GiB-s,
  2M HTTP requests, **per subscription per calendar month**, pooled across all apps/jobs
  in the subscription. At ~300 req/day we would use **0.45%** of the request grant.
  No documented expiry (that it is permanent is an inference, not a quote).
- **Scale-to-zero costs $0 compute.** `minReplicas` defaults to 0; a revision at zero
  replicas incurs no resource-consumption charge. Requires the default HTTP scale rule —
  KEDA CPU/memory scalers cannot scale to zero.
- **No fixed environment management fee on Consumption**, unless you add a Dedicated
  workload profile, a private endpoint, or planned maintenance. We need none of those.
- **ACR is NOT required.** Microsoft Learn documents pulling public *and private* images
  from **GitHub Container Registry** into ACA via a registry credential secret
  (`registries` entry + `passwordSecretRef`, GitHub PAT with `read:packages`).
  `azd` documents third-party registries for `host: containerapp`.
- **Prefer GHCR over Docker Hub** — Docker Hub's documented pull-rate limit can make
  containers fail to start; GHCR has no comparable documented cap.
- **Skipping ACR Basic loses less than assumed.** Private link, geo-replication, CMK, and
  retention policy are Premium-only anyway. The real Basic-tier loss is
  **managed-identity keyless pull** and **same-region proximity**.
- **Cold start is dominated by image size.** Community-measured (not first-party):
  `node:18` ~480 MB → ~20 s; `node:18-alpine` ~140 MB → ~7 s. Microsoft documents that
  cold start exists but publishes **no duration**. This makes base-image size a
  first-order input to backend stack selection.

### The warm-replica trap (the actual decision point)

`minReplicas > 0` bills continuously. The free grant offsets only ~$1.62 (~14%) of it:

| Config | After free grant |
|---|---|
| min-replicas 0 (scale to zero) | **$0** |
| 0.25 vCPU / 0.5 GiB always-on | ~$4.29/mo |
| 0.5 vCPU / 1 GiB always-on | ~$10.21/mo |
| 0.5 vCPU / 1 GiB **failing** the idle test | ~$31.54/mo |

Idle criteria are strict: <0.01 vCPU **and** <1,000 bytes/sec network. A background timer
or keepalive ping moves vCPU to the active meter at **8× the rate**. If we ever pin a warm
replica, ACA stops being free and rivals the Postgres compute line.

### Risks and unverified items — do not treat as settled

- **⚠️ Unresolved "Environment Management Hour" meter.** Three `Environment` SKU meters
  ($0.10/hr, `effectiveStartDate` **2026-09-01**) were observed in the Azure Retail Prices
  API but appear on neither Learn nor the pricing page. If one applied to a plain
  Consumption environment it would be **~$73/mo** and invalidate the entire "$0 ACA"
  conclusion. **Must be settled empirically** — deploy a throwaway ACA environment and
  watch Cost Analysis for 48–72 h before committing to ACA.
- **ACR Basic's price is unverified** (~$5/mo is the circulating figure; the pricing page
  serves `$-` placeholders to fetchers). Moot if we choose GHCR.
- **`azd` + ghcr.io is a mechanism inference** — the azd doc only works through
  `docker.io`. Also, azd's stock ACA templates still provision an ACR by default.
- **A GHCR PAT is a manually-rotated secret** on the container app — recurring toil for a
  solo maintainer, and a real cost against ACA that no dollar figure captures.
- **$0 ACA excludes Log Analytics ingestion** (on by default, billed per GB) and egress.
  A genuinely $0 setup needs logging deliberately minimized.
- **SWA Free was never actually researched.** Its $0 claim, its quotas, its managed-Functions
  limits, and its cold-start behavior remain unverified. We cannot yet say ACA beats it
  *or* loses to it.

### Consequences for this plan

1. **The hosting decision is reopened but not resolved.** ACA + GHCR at min-replicas 0 has
   the same $0 floor as SWA Free, so containers are no longer a paid luxury. Choosing
   between them needs the SWA-side numbers we don't have.
2. **A single container serving both the SPA and the API puts the static page behind
   scale-to-zero** — the first page load pays the cold start, not just the API call. SWA
   serves static assets from a CDN that is always warm. If we go ACA, seriously consider
   **SWA Free for static + ACA for the API only** (a hybrid the research pass never
   costed).
3. **Hosting was never where the money was.** Postgres is ~$15 of the ~$16/mo estimate.
   The next research pass must be section B (questions 6–9) — particularly the
   **Azure SQL free offer** and **Postgres stop-server**, either of which would matter far
   more than this entire hosting debate.
4. **The warm-replica question is now closed** — cold start is acceptable, so
   `minReplicas: 0` stands and ACA's $0 floor is the live number. What remains open on the
   ACA side is only the unresolved Environment meter (verify empirically).
5. **Open: is the $700 credit one-time or monthly-recurring?** A one-time balance means
   minimize burn rate to extend runway. A recurring monthly credit means anything under
   the cap is effectively free and we should optimize for the *better* architecture rather
   than the cheapest. This changes the Phase 3 recommendation but not what pass 2 needs to
   find out.

---

---

## Research findings — database (2026-09-06)

Source: [`_research/azure-backend-stack-db/report.md`](_research/azure-backend-stack-db/report.md).
Pass 2 answered questions 1–3 and part of 5. **Question 4 (Cosmos / Table / Blob) and all of
Section C (SWA limits, linked backends) are unanswered** — gaps, not negatives.

### The decision: PostgreSQL B1ms is dropped

| | PostgreSQL B1ms | **Azure SQL free offer** |
|---|---|---|
| Compute | $12.41/mo (East US 2) · $14.02/mo (Central US) | **$0** |
| Storage | 32 GiB floor, scales **up only** *(rate unconfirmed)* | 32 GB included |
| Idle handling | none — stop/start defeated by a **7-day auto-restart** | **auto-pause to zero compute** |
| Support posture | "not recommended for production", no 24/7, no RCA | no SLA, "development and PoC" |
| Relational semantics | full | full |

Both carry the same class of support caveat. **Paying for Burstable PostgreSQL does not buy
production-grade support — it just costs more.** There was no cheaper Postgres SKU: B1ms is the
floor, and the `Standard_B1s` some sources claim exists for PostgreSQL **does not** (it is a VM
and MySQL SKU; the claim traces to Pulumi/Terraform docs and is false).

### The free offer, confirmed

- **100,000 vCore-seconds + 32 GB data + 32 GB backup, per database per month.** Up to
  **10 databases per subscription.**
- **Perpetual.** "The database is free forever, with monthly limits. There's no time limit."
- **Works on our subscription type**, stated explicitly: "this new offer is available regardless
  of your Azure subscription type." Only **Azure for Students Starter** is excluded. This is a
  *different offer* from the old 12-month free-account one — don't confuse them.
- **Grant exhaustion auto-pauses until next month** rather than billing — a hard $0 ceiling,
  and opting into billing is explicit *and irreversible*.
- Resume latency **generally under one minute**, sometimes ~1 s. Well inside our accepted
  cold-start tradeoff.

### The grant math

Billing charges a **0.7 vCore floor** (memory-derived), not the 0.5 `minCapacity`, so the real
budget is **~39.7 h/month of online time**, not 55.6.

| Usage pattern | Online time | vCore-s | Verdict |
|---|---|---|---|
| Heavy, **60-min default** delay | ~48 h/mo | ~121,000 | ❌ exceeds grant |
| Heavy, 15-min delay | ~39 h/mo | ~98,000 | ⚠️ at the line |
| **Realistic hobby, 15-min delay** | ~16 h/mo | ~40,000 | ✅ ~40% of grant |

### ⚠️ Risks that break the $0 — each one is silent

1. **An idle connection pool.** Open sessions are the documented #1 cause of failure to
   auto-pause. A leaked pool keeps the DB online 24/7 → **the whole monthly grant burns in
   ~40 hours**, and then the app is *inaccessible until the 1st of next month*. This is the
   single largest operational risk in the plan. Mitigate: `pool.min = 0`, short idle timeout,
   scale-to-zero compute, and a budget/metric alert on vCore-second consumption.
2. **`freeLimitExhaustionBehavior` defaulting to `BillOverUsage` in Bicep.** Undocumented for
   template deployment, and **irreversible**. Set it explicitly.
3. **Leaving auto-pause delay at the 60-minute default.** Turns a comfortable month into an
   over-grant month.
4. **Enabling LTR, a DNS alias, geo-replication, Data Sync, or elastic jobs.** Each blocks
   auto-pause *entirely*. LTR and DNS alias are the easy accidental ones.
5. **Losing the offer.** Terms already changed once (GA ~May 2025), and the GP-only auto-pause
   limitation is worded "**currently**". Re-check before committing infra.

### Corrections to earlier assumptions

- The plan's **"~$3.68/mo storage"** was never sourced and remains **unconfirmed** — moot now.
- The plan's separate **backup line item was unnecessary**; Postgres backup is free up to 100%
  of provisioned storage. Note the allowance is framed by **volume, not retention days**.
- **"PgBouncer enabled" may have been self-contradictory** — PgBouncer may not be available on
  Burstable at all. Unverified, and now moot.
- Region spread is real: **~13% between Central US and East US 2** for identical Postgres
  hardware. Irrelevant now, but a reminder not to treat regions as interchangeable on price.

---

---

## Research findings — hosting close (2026-09-07)

Source: [`_research/azure-backend-stack-hosting-close/report.md`](_research/azure-backend-stack-hosting-close/report.md).
Answered Q1, Q2, Q3, Q5. **Q4 (cross-origin cookies) deliberately unanswered — the
recommendation makes it moot**, but it must be researched in full if we ever leave Shape C.

### The decision: the original plan was right

| Shape | API host | Monthly | Same-origin | Page load after idle |
|---|---|---|---|---|
| **C — chosen** | **SWA managed Functions** | **$0** | ✅ by construction | **Warm (CDN)** |
| A — fallback | One ACA container serves SPA + API | $0 | ✅ by construction | Cold start |
| B — rejected | SWA **Standard** + linked ACA | **$9.00/app** | ✅ via server proxy | Warm (CDN) |

The prompt's Shape A/B framing was the thing that was wrong — both assumed the API had to
live on Container Apps. It doesn't. **Linking** an external backend is the Standard-gated
feature; **managed** Functions are on every plan. Shape C wins on all three axes at once:
$0, always-warm static, and same-origin cookies with no CORS.

Reopening this decision was still worth it — it is now settled on evidence rather than
assumption, and we learned the $9 number and the fallback path.

### Confirmed, carry forward

- **SWA Free quotas are orders of magnitude above our needs**: 100 GB/mo bandwidth (pooled
  **per subscription**), 250 MB per environment / 500 MB per app storage, 15,000 files,
  2 custom domains, 3 preview environments, 30 MB request limit.
- **Custom domains with free auto-renewing managed TLS work on FREE**, not Standard-only.
  (The contrary belief comes from *App Service*'s Free-tier prohibition — a different
  service.)
- **Bandwidth overage blocks, it does not bill.** No overage meter exists on Free.
- **Runtime is current: `node:22`** (and `node:20`), no end-of-support date, set via
  `apiRuntime` in `staticwebapp.config.json`. The stale Node 12–18 list on the
  `apis-functions` page is superseded by `languages-runtimes`.
- **No deprecation signal for SWA or managed Functions.** The two real retirements were
  **preview-only**: the Dedicated plan (2025-10-31) and Database Connections / `/data-api/*`
  (2025-11-30). Notably, the Database Connections replacement guidance is *"adding explicit
  endpoints to Azure Functions for CRUD operations"* — exactly this architecture.
- **ACS Email is ~$0.005/month** at 20 emails, purely per-message with no fixed resource
  charge, and the Azure-managed domain needs no DNS.

### ⚠️ The 45-second collision — the sharpest issue in this plan

**Not flagged by any research pass; it emerges from combining two of them.**

- SWA enforces a **45-second maximum duration per API request** (all plans).
- A paused Azure SQL serverless database resumes in **"generally on the order of one
  minute"**, with community reports around **~45 s**.

**So a login that blocks while waiting for the database to resume can hit the SWA request
ceiling and fail — exactly on the first login after an idle period, which is the common
case for this app.** "Cold start is acceptable" does not survive a hard timeout.

**Mitigation (design requirement, not a nice-to-have):**

1. **Warm-up ping on page load.** The static page is always warm and loads instantly; fire a
   cheap `GET /api/ping` that opens a connection the moment the SPA mounts. The database
   starts resuming while the user is still typing their credentials. This turns Shape C's
   always-warm CDN from a nicety into the actual fix.
2. **Never block a request on resume.** On error **40613**, return promptly (e.g. 503 +
   `Retry-After`) with a "waking up, retrying…" state in the UI, and let the client retry —
   rather than holding the request open toward the 45 s wall.

### ⚠️ Connection handling — reconciling two passes that pull opposite ways

- **Pass 2:** an idle connection pool prevents auto-pause; a database that never pauses
  burns the whole monthly grant in ~40 hours.
- **Pass 3:** Microsoft's Functions guidance is to **reuse a single client across
  invocations**, created at **module scope outside the handler**.

These are reconcilable but only deliberately: **reuse the client object, but configure its
pool with `min = 0` and a short idle timeout** so sockets actually close when traffic stops.
Functions worker recycling helps (the runtime *"can recycle your worker at any time"*), but
do not rely on it as the mechanism. Getting this wrong is silent and costs the whole grant.

### What Shape C costs us

- **No managed identity, no Key Vault references on managed Functions** — both documented
  `✕` for managed. **The SQL credential must be a stored secret in SWA application
  settings**, which `manage-connections` ranks as *"Only use shared secrets directly in app
  settings as a last resort."* A knowing deviation, acceptable at ~10 users with kilobytes
  of trip data. **Shape A regains managed identity at the same $0** if this is unacceptable.
- **HTTP triggers only** — no timer/queue/Durable. So **no scheduled `sessions` cleanup**;
  prune expired rows opportunistically inside request handlers.
- **45 s per request, 30 MB per request.** Fine for everything except the resume collision.
- **"Allow Azure services" is a broad allowlist covering any Azure tenant**, not just ours.
  Acceptable behind password-authenticated endpoints at this scale — worth knowing.

### Unverified / open

- **⚠️ BLOCKING: can SWA managed Functions reach Azure SQL through the server firewall?**
  No doc states their outbound IP behavior or whether *"Allow Azure services"* covers them.
  Expected to work — but that is inference, and being wrong invalidates the architecture.
- **The managed-Functions hosting sandbox is undocumented**, so outbound-connection limits,
  memory, cold-start duration and deployment-size ceiling are unknown for this surface. The
  widely-cited 100 MB deployment limit exists **only in an error string**.
- **`azurecomm.net` inbox placement is not addressed by Microsoft docs.** Password reset is
  precisely the flow where a spam-foldered message means a locked-out user. **Test against
  real Gmail and Outlook before shipping.** Fallback: Brevo's 300/day perpetual free plan
  (vendor-grade figure, confirm on signup).
- **ACS managed-domain rate limits are hard and unraisable**: **5 emails/minute, 10/hour,
  per subscription**. Fine at 20/month; a burst of 6 resets in a minute returns `429`.
  Handle it with a "try again shortly" message.
- Product-health evidence is **doc-level only** — two claims about the GitHub repo carrying
  no deprecation notice were refuted 0-3.

---

## Phase 1 — Infrastructure (`infra/main.bicep`)

The existing bicep only provisions the Static Web App. Add:

1. **Azure SQL logical server + database** — `Microsoft.Sql/servers` +
   `Microsoft.Sql/servers/databases`
   - **General Purpose serverless**, Standard-series (Gen5) — auto-pause is supported
     *only* on GP + vCore + Gen5. Not DTU, not Business Critical, **not Hyperscale**
     (Hyperscale serverless never reaches zero compute).
   - `autoPauseDelay: 15` — **15 minutes, not the 60-minute default.** At 60 min a heavy
     usage month exceeds the grant; at 15 min a realistic month uses ~40% of it.
   - `useFreeLimit: true` and **`freeLimitExhaustionBehavior: 'AutoPause'` — set this
     EXPLICITLY.** The auto-pause default is documented for the *portal* flow only; the
     Bicep/CLI default is undocumented, and switching to `BillOverUsage` is **irreversible**.
   - `minCapacity: 0.5`, max 4 vCores. Note billing charges a **0.7 vCore floor** (memory-
     derived), so plan against ~39.7 h/month of online time, not 55.6 h.
   - **Do NOT enable:** long-term backup retention (LTR), a DNS alias on the logical server,
     geo-replication / failover groups, SQL Data Sync, elastic jobs. Each **blocks
     auto-pause entirely** and would silently destroy the $0.
   - Also avoid: vulnerability-assessment periodic scans and auto-tuning — they *resume* a
     paused database on a schedule (~1.8% of grant per spurious resume).
   - Firewall rule **"Allow Azure services"** so SWA managed Functions can reach it.
     **⚠️ Unverified that this covers managed Functions — see the blocking spike below.**
     Note this allowlists *any* Azure tenant, not just ours.
2. **Azure Communication Services** + **Email Communication Service** with an **Azure-managed domain** (instant sender like `donotreply@<id>.azurecomm.net`, free, no DNS). ~$0.00025/email, no fixed charge. Hard limits: **5/min, 10/hour, per subscription, unraisable** on a managed domain.
3. **App settings / secrets** on the **Static Web App** (mark secure). Managed Functions
   support **neither managed identity nor Key Vault references**, so these are stored
   secrets — Microsoft's documented *"last resort"*, accepted knowingly:
   - `SQL_CONNECTION_STRING` (Azure SQL; pool min = 0 — see Phase 3)
   - `SESSION_SECRET`
   - `ACS_CONNECTION_STRING`
   - `APP_BASE_URL`

## Phase 2 — Database schema (migration script)

**Rewritten to T-SQL 2026-09-06** — the schema was PostgreSQL-specific (`uuid`, `jsonb`,
`timestamptz`) and none of those types exist in Azure SQL.

```sql
CREATE TABLE users (
  id             uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  email          nvarchar(320)    NOT NULL UNIQUE,
  password_hash  nvarchar(255)    NOT NULL,
  email_verified bit              NOT NULL DEFAULT 0,
  failed_attempts int             NOT NULL DEFAULT 0,
  locked_until   datetimeoffset   NULL,
  created_at     datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE sessions (
  token      nvarchar(128)    NOT NULL PRIMARY KEY,
  user_id    uniqueidentifier NOT NULL REFERENCES users(id),
  expires_at datetimeoffset   NOT NULL,
  created_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE password_reset_tokens (
  token      nvarchar(128)    NOT NULL PRIMARY KEY,
  user_id    uniqueidentifier NOT NULL REFERENCES users(id),
  expires_at datetimeoffset   NOT NULL,
  used       bit              NOT NULL DEFAULT 0
);

CREATE TABLE trips (
  id         uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  user_id    uniqueidentifier NOT NULL REFERENCES users(id),
  data       nvarchar(max)    NOT NULL CHECK (ISJSON(data) = 1),
  updated_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_trips_user_id ON trips(user_id);
```

`Trip` / `TripStop` types (`src/domain/trip/types.ts`) stay untouched — trips are stored as a
JSON string in `nvarchar(max)`, guarded by `ISJSON`. **The `UNIQUE` constraint on `email` is
the correctness guarantee that made a relational store worth keeping** — it is what the
Table Storage alternative would have forced us to hand-roll.

## Phase 3 — Auth API (new `api/` Functions folder)

| Endpoint | Does |
|---|---|
| `POST /api/register` | validate email/password, **argon2id** hash, insert user |
| `POST /api/login` | verify hash, check lockout, create session, set **HttpOnly Secure SameSite=Lax** cookie |
| `POST /api/logout` | delete session row, clear cookie |
| `GET /api/me` | validate session cookie → return current user |
| `POST /api/forgot-password` | create reset token, **email link via ACS** (always return 200 to avoid account enumeration) |
| `POST /api/reset-password` | validate token (unused + unexpired), set new hash, invalidate token + existing sessions |

Cross-cutting: parameterized queries only (`mssql` / `tedious`, **not** `pg` — see Phase 2),
per-account failed-attempt lockout, reset tokens single-use with short TTL (~1 hr).

Runtime: **`node:22`**, set via `apiRuntime` in `staticwebapp.config.json`.

**Four requirements that are not optional:**

- **`GET /api/ping`** — a trivial endpoint the SPA calls on mount to start the database
  resuming while the user types. See "the 45-second collision" above; this is the primary
  mitigation, not an optimization.
- **Handle error 40613 without blocking toward the 45 s wall.** A paused database returns
  "database is unavailable" on the *first* connection attempt and resumes in the background.
  Return promptly (503 + `Retry-After`) and let the client retry with a "waking up" state —
  **do not** hold the request open waiting, because SWA kills it at 45 seconds.
- **Reuse one client at module scope, but with `pool.min = 0` and a short idle timeout.**
  Microsoft's Functions guidance says reuse the client; pass 2 says an idle pool prevents
  auto-pause and burns the grant. Both are satisfied by reusing the *object* while letting
  the *sockets* close.
- **Prune expired `sessions` rows inside request handlers.** Managed Functions are
  **HTTP-trigger only** — there is no timer trigger, so no scheduled cleanup job exists.

## Phase 4 — Trips API

- `GET /api/trips` → session-validated, returns caller's `TripsState`.
- `PUT /api/trips` → upserts caller's trips.

A shared session-validation helper guards both (reads cookie → looks up `sessions` → checks expiry).

## Phase 5 — Frontend integration

- **Auth screens:** login, register, forgot-password, reset-password (reset page reads token from URL).
- **The one code seam:** `src/services/storage/tripStorage.ts` — when authenticated, `loadTripsFromStorage` / `saveTripsToStorage` call `/api/trips`; keep localStorage as the anonymous/offline fallback. Add auth/user state to `App.tsx`.
- **Migration:** on first login, if localStorage has trips, `PUT` them to the backend (reuse existing export-JSON logic), then treat the server as source of truth.

## Phase 6 — Config & deploy

- `staticwebapp.config.json`: set `platform.apiRuntime` to **`node:22`**; gate `/api/trips*`
  (auth endpoints stay public); no new `connect-src` domains needed — the API is same-origin.
- Deploy via the existing `azd` / GitHub Actions pipeline. Run the SQL migration once against
  the new server — note `db_datareader`/`db_datawriter` are DML-only, so the migration
  identity needs DDL rights.
- **If we ever buy SWA Standard**, the linked-backend proxy requires the backend's own
  endpoint to carry the `/api` prefix. Building `/api`-prefixed routes now keeps that upgrade
  path open for free.

---

## Security checklist (must-haves)

- [ ] argon2id (or bcrypt), never plain/SHA
- [ ] HttpOnly + Secure + SameSite cookies; server-side revocable sessions
- [ ] Parameterized queries everywhere
- [ ] Login rate-limit / lockout
- [ ] Reset tokens: single-use, short TTL, generic "email sent" response
- [ ] Secrets in SWA app settings, never committed
- [ ] Invalidate sessions on password reset
- [ ] **CSRF defense on all mutating endpoints** — `SameSite=Lax` alone is not sufficient.
      Origin/Referer check + double-submit token. *(Cite the OWASP CSRF Prevention Cheat
      Sheet — standard guidance, but not verified against a primary source by any pass.)*
- [ ] Acknowledged: the SQL credential is a **stored secret** in SWA app settings, since
      managed Functions support neither managed identity nor Key Vault references

## Cost checklist (must-haves — each item is a silent $0-breaker)

- [ ] `freeLimitExhaustionBehavior: 'AutoPause'` set **explicitly** in Bicep (irreversible if wrong)
- [ ] `autoPauseDelay: 15` (not the 60-minute default)
- [ ] `pool.min = 0` + short idle timeout; no long-lived connection held across requests
- [ ] Reuse one SQL client at module scope, but with `pool.min = 0` + short idle timeout
- [ ] Handle SQL error **40613** by returning fast (503 + `Retry-After`), not by blocking
- [ ] `GET /api/ping` warm-up called on SPA mount
- [ ] LTR, DNS alias, geo-replication, Data Sync, elastic jobs all **off**
- [ ] Vulnerability-assessment periodic scans and auto-tuning **off**
- [ ] Azure budget alert set at **$5**
- [ ] Alert on vCore-second consumption trending toward 100,000/month

## Blocking pre-implementation checks (do these before writing any Bicep)

- [ ] **Confirm the free offer applies to this subscription** — attempt to create the free
      database in the portal and look for the "Free offer applied!" banner. Five minutes, and
      it invalidates the whole plan if negative. *(Fallback if negative: research Q4 —
      Cosmos free tier / Table Storage.)*
- [ ] **Confirm the Bicep default for `freeLimitExhaustionBehavior`** empirically, since it is
      undocumented and the wrong value is irreversible.
- [ ] **Choose the region deliberately** — locked permanently per subscription at first free
      database creation. Colocate with the Static Web App.
- [ ] **⚠️ SPIKE: can SWA managed Functions reach Azure SQL through the firewall?** Deploy a
      trivial managed Function that opens a SQL connection with "Allow Azure services" on.
      Undocumented, expected to work, and **the whole architecture depends on it.** ~30 min.
      *(If it fails: fall back to Shape A — one ACA container serving SPA + API, also $0,
      and it regains managed identity.)*
- [ ] **Test password-reset email delivery to real Gmail and Outlook accounts.**
      `azurecomm.net` inbox placement is undocumented; a spam-foldered reset = locked-out
      user. *(Fallback: Brevo 300/day perpetual free.)*
