# Research Request: Cheapest Azure backend stack for a small multi-user SPA (hosting + database + auth)

## Context (self-contained — assume no access to our codebase)

### The application

**RV Trip Planner** is a small hobby/side-project web app that lets a person plan an RV
road trip: add a list of stops with arrival/departure dates, see a route on a map,
per-stop daily weather forecasts, and an estimated fuel cost.

**Current shipped architecture (today, in production):**

- **Frontend:** React 19 + TypeScript + Vite, built to static files (`dist/`).
- **Hosting:** Azure Static Web Apps, **Free tier**, provisioned with Bicep + Azure
  Developer CLI (`azd up`). Cost today: **$0/month**.
- **Backend:** *There is none.* All state lives in the browser's `localStorage` under a
  single key. There is one storage module (`loadTripsFromStorage` /
  `saveTripsToStorage`) that is the only seam touching persistence.
- **Optional Google Drive sync** exists so a user can back their own trips up to their
  own Drive. It is not a shared backend and is not per-user server state.
- **All third-party data services are free and keyless:** OpenStreetMap tiles via
  MapLibre GL JS, OSRM demo servers (with a fallback OSRM instance and optional
  OpenRouteService key) for routing, Photon/Nominatim for geocoding, NOAA + Open-Meteo
  for weather. Responses are cached in localStorage with TTLs. **None of this changes
  in this project** — it stays client-side and keyless.
- Repo already contains `infra/main.bicep` (subscription-scoped, creates a resource
  group + the Static Web App) and `azure.yaml` for `azd`.

### What we want to build

Convert this into a **multi-user app**: users register with email + password, log in, and
their trips are stored server-side keyed to their account instead of in localStorage.

**Expected scale — this is important for costing.** This is a personal/small-audience
app, not a startup:

- Order of **1–50 registered users** total, realistically closer to 10.
- A few hundred HTTP requests per day at most, bursty (someone plans a trip in one
  sitting, then nothing for a week). Long idle periods are the norm.
- Data volume is trivial: a trip is a small JSON document (a list of stops with
  addresses, coordinates, and dates). Total data would be measured in **megabytes**,
  possibly kilobytes. Well under 1 GiB for the foreseeable future.
- No compliance requirements, no SLA requirements. Downtime is annoying, not costly.
- Single region is fine. No HA, no geo-redundancy, no read replicas needed.

**Hard constraint: minimize monthly Azure cost.** The stated target is **around
$15/month or less, all-in**, and lower is strictly better. The subscription is a
personal one. There is a strong preference for keeping everything inside Azure (see
"Prior decisions" below), but we want that preference *priced*, not assumed.

### Prior decisions already written down in our plan (treat as our current bias, NOT as
### ground truth — we explicitly want these challenged where the economics say otherwise)

Our existing internal plan document locked these in before this research request:

1. **Everything stays in Azure** — no Cosmos DB, no external providers such as Supabase
   or Neon.
2. **Database: Azure Database for PostgreSQL Flexible Server**, Burstable **B1ms**, 32
   GiB storage, PgBouncer enabled, pay-as-you-go (no reservation), "Allow Azure
   services" firewall rule rather than VNet/private endpoint (private networking would
   force the Static Web Apps **Standard** tier, which costs money).
3. **Auth: classic database-backed username/password** with hashed passwords
   (argon2id), server-side revocable sessions in an HttpOnly/Secure/SameSite=Lax cookie.
   Deliberately *not* using Static Web Apps built-in auth and *not* using an external
   OAuth identity provider.
4. **Password reset is in scope for v1**, which means transactional email — planned via
   **Azure Communication Services Email** with an Azure-managed sender domain.
5. **Compute: the Static Web Apps Free tier's bundled managed Azure Functions** to host
   the API (`/api/register`, `/api/login`, `/api/logout`, `/api/me`,
   `/api/forgot-password`, `/api/reset-password`, `GET/PUT /api/trips`), so the API is
   same-origin with the SPA and costs $0.

Our plan's cost estimate was roughly: **$0 hosting + ~$12–13/mo B1ms compute + ~$3.68/mo
storage + pennies of email ≈ $15–17/month.**

### The new question that triggered this research

The project owner now wants to consider **Azure Container Registry (ACR) + Azure
Container Apps (ACA)** to host the application instead of the Static Web Apps Free tier
+ managed Functions.

**This directly conflicts with locked decision #5 above, and we do not currently believe
it saves money** — our unverified assumption is that ACA + ACR would *add* cost (an ACR
tier plus any ACA usage above the monthly free grant) relative to a $0 Static Web Apps
Free tier, in exchange for a nicer container-based deployment story. **Verifying or
refuting that assumption is the single most valuable thing this research can do.**

The owner also asked for help **selecting the backend stack** (language/framework/runtime
for the API), which our plan had implicitly assumed would be TypeScript/Node on Azure
Functions but never actually justified against alternatives.

---

## Questions to Answer

Answer each with current, cited pricing and documented platform behavior. Where pricing
is region-dependent, **use `Central US` and `East US 2` as the reference regions** and
state the currency and the date the price was checked. Where a free tier or monthly free
grant exists, state its exact quota, whether it is per-subscription or per-resource, and
whether it is permanent or expires after 12 months.

### A. Hosting: does ACR + ACA actually make sense here?

1. **What does Azure Container Apps actually cost for this workload?** Give the current
   ACA Consumption-plan pricing model (vCPU-seconds, GiB-seconds, requests) and the
   monthly **free grant**. For a workload of a few hundred requests/day with **minimum
   replicas set to 0** (scale to zero), does the free grant cover it entirely? What is
   the realistic monthly bill? Explicitly address:
   - Whether scale-to-zero is available on the Consumption plan and what the cold-start
     penalty looks like in practice for a small Node container.
   - Whether an ACA **Environment** itself carries any fixed monthly charge independent
     of usage (and whether that differs between the workload-profiles environment and
     the Consumption-only environment).
   - Any charge for the ACA-provided HTTPS ingress / default domain.
2. **What does Azure Container Registry cost, and can it be avoided?** Give current
   pricing for Basic/Standard/Premium ACR tiers. Then answer: **can Azure Container Apps
   pull images from a non-ACR registry** — specifically GitHub Container Registry
   (ghcr.io) or Docker Hub — including **private** repositories with credentials, and is
   that a documented, supported configuration? If yes, what is lost by skipping ACR
   (e.g. managed-identity pull, private networking, geo-replication, retention
   policies)? Is there any free or zero-cost ACR option?
3. **Head-to-head hosting comparison.** Build a table comparing, for *this* workload and
   scale, the realistic all-in monthly cost and the practical tradeoffs of:
   - (a) Azure Static Web Apps **Free** + its bundled managed Azure Functions
   - (b) Azure Static Web Apps **Free** for the SPA + a separate Azure Functions app on
     the **Consumption (Y1)** plan for the API
   - (c) Azure Container Apps (single container serving both the built SPA and the API)
     + ACR Basic
   - (d) Azure Container Apps + a free external registry (ghcr.io), if (2) says that
     works
   - (e) Azure App Service **Free (F1)** or **Basic (B1)**, if either is genuinely
     viable for a container or Node app at this scale
   For each: fixed monthly floor, expected variable cost at our volume, cold-start
   behavior, custom-domain + free TLS support, and how hard it is to deploy from GitHub
   Actions / `azd`.
4. **What are the real, documented limits of the Static Web Apps Free tier** that might
   bite a multi-user app? Specifically: bandwidth quota, app size limit, managed
   Functions execution limits (timeout, memory, cold start, whether long-running or
   durable functions are supported), number of custom domains, whether **Bring Your Own
   Functions** is allowed on Free, and whether managed Functions can hold outbound
   database connections. **Is there any documented signal that Static Web Apps managed
   Functions are deprecated, in maintenance mode, or discouraged for new work?**
5. **Cold starts and database connections.** For each hosting option, describe the
   documented connection-pooling story against PostgreSQL. Serverless/scale-to-zero
   compute is known to interact badly with connection-limited databases — quantify how
   bad this is for a Burstable B1ms PostgreSQL server and what the recommended mitigation
   is (PgBouncer built into Flexible Server, an in-process pool, `pg` client settings,
   something else).

### B. Database: is B1ms PostgreSQL really the cheapest workable option?

6. **Current price of Azure Database for PostgreSQL Flexible Server, Burstable B1ms**,
   pay-as-you-go, in the reference regions. Break out compute vs. storage vs. backup.
   **What is the minimum provisionable storage** and its monthly cost? Confirm whether
   7-day backup retention is genuinely included at no charge.
7. **Does the Azure free account 12-month offer still include a free PostgreSQL Flexible
   Server B1ms?** If so: exact terms, hours/month, storage included, what happens at the
   12-month mark, and whether it applies to an existing pay-as-you-go subscription or
   only to newly created free accounts.
8. **Is there a cheaper Azure-native persistence option for this data shape?** The data
   is a handful of small JSON documents per user plus a users/sessions table. Evaluate
   honestly, with current pricing:
   - **Azure Cosmos DB serverless** and the **Cosmos DB free tier** (1000 RU/s + 25 GB
     free per account) — what would this actually cost at our volume, and is the free
     tier still offered?
   - **Azure Table Storage / Azure Storage Account** (cost is essentially cents at this
     volume) — what would we give up (no relational queries, no transactions across
     partitions, no SQL)?
   - **Azure SQL Database serverless (General Purpose, auto-pause)** and the **Azure SQL
     free offer** (if a perpetual free vCore/storage grant still exists) — state its
     exact terms and limits.
   - **Azure Database for PostgreSQL Flexible Server** — is there any cheaper SKU than
     B1ms, or any auto-pause/stop capability that reduces the bill during idle periods?
     Can a Flexible Server be **stopped** to avoid compute charges, what is the maximum
     stop duration, and does it auto-restart?
   Rank these by total monthly cost for our workload and say which you would actually
   pick, with reasoning about the migration/complexity cost, not just the sticker price.
9. **Cheapest realistic all-in architecture.** Given everything above, what is the
   **lowest-total-cost Azure architecture** that still delivers email/password
   registration, login, per-user trip storage, and password reset? State the monthly
   figure and what is being traded away to get there. Separately state the **lowest-cost
   architecture that a reasonable engineer would still call production-sane** if that
   differs.

### C. Backend stack selection

10. **Which API stack should we choose**, given the team already writes React 19 +
    TypeScript and nothing else? Compare **TypeScript/Node** (Azure Functions v4 Node
    programming model, Express/Fastify in a container, and Hono) against **.NET 8/9
    minimal API** and **Python/FastAPI**, specifically on: cold-start time in the
    hosting options from question 3, container image size, PostgreSQL driver maturity,
    argon2id availability, and operational simplicity for a solo maintainer. Give a
    recommendation, not just a matrix.
11. **Password hashing in the chosen runtime.** Is **argon2id** practical on Azure
    Functions Consumption / Static Web Apps managed Functions given that the common Node
    implementation (`argon2`) is a **native module** requiring compilation? Does it
    deploy cleanly to Linux Consumption, or is a pure-JS alternative (e.g. `bcryptjs`,
    `@node-rs/argon2`, or Node's built-in `crypto.scrypt`) the safer choice? What is the
    current OWASP-recommended parameter set for whichever algorithm you recommend, and
    is it CPU-affordable on a Burstable/Consumption tier?
12. **Session management.** We plan server-side sessions in a `sessions` table with an
    HttpOnly/Secure/SameSite=Lax cookie. For a scale-to-zero backend, compare that
    against **stateless signed JWTs with a short TTL plus a refresh token**, on
    revocability, database round-trips per request, and cookie handling across the
    hosting options in question 3. Note any Azure-specific gotcha (e.g. does Static Web
    Apps or Container Apps ingress interfere with `Set-Cookie` on `/api/*` routes?).
13. **Transactional email for password reset.** Confirm current **Azure Communication
    Services Email** pricing (per-email and per-MB) and whether the **Azure-managed
    sender domain** is still available with no DNS setup, plus its documented limits
    (rate limits, whether it is intended for production, deliverability caveats). Then
    compare against the cheapest realistic alternatives at our volume (a handful of
    emails per month): **Azure Communication Services**, **SendGrid/Twilio free tier via
    the Azure Marketplace**, **Resend**, and **Brevo**. Is there an option that is
    genuinely $0 at our volume?

### D. Migration and deployment mechanics

14. **How do we run the SQL schema migration** against a PostgreSQL Flexible Server as a
    one-time step from GitHub Actions or `azd`, given the "Allow Azure services"
    firewall configuration (GitHub-hosted runners are *not* Azure services from the
    firewall's perspective)? What is the documented approach — a temporary firewall rule
    added and removed in the workflow, an Azure-hosted runner, `az postgres` commands,
    or a migration job run as an ACA job? Recommend one.
15. **If ACA is chosen, what does the `azd` + Bicep + GitHub Actions story look like** for
    a single container that serves both the static SPA and the API? Is there a
    documented `azd` template for `host: containerapp` that handles building the image
    and pushing it to a registry? Does `azd` support a non-ACR registry?
16. **Custom domain and TLS.** For the hosting options in question 3, confirm which
    support a custom domain with a **free managed certificate**, and whether any of them
    require a paid tier to do so.

## Constraints on Answers

- **Cite sources for every pricing claim**, preferring official Microsoft Azure pricing
  pages and Microsoft Learn documentation. Pricing pages change — **state the date you
  checked and the region and currency**.
- Clearly distinguish **documented behavior** (with a Learn/docs link) from
  **inferred or community knowledge** (blog posts, Stack Overflow, personal experience).
- Where a service has a free tier or free grant, state explicitly whether it is
  **permanent** or **expires after 12 months**, and whether it is limited to one
  instance per subscription.
- If a question cannot be answered definitively from public documentation, **say so
  explicitly** rather than guessing. A clearly-labeled "I could not confirm this" is far
  more useful to us than a confident wrong number.
- **Do not assume our prior decisions are correct.** If the cheapest sane answer is
  "don't use PostgreSQL", or "ACA + ghcr.io beats Static Web Apps", or "your $15 target
  is achievable at $4", say that plainly and show the arithmetic.
- Show your cost math. A line-item table beats a single total.
- Keep recommendations proportionate to a **solo maintainer running a hobby app for
  ~10 users**. Do not recommend enterprise patterns (VNet integration, Key Vault-backed
  private endpoints, multi-region, APIM) unless they are free and add no operational
  burden.

## Required Report Structure

Return a markdown report with these sections:

1. **Summary of Findings** — the bottom line in under 300 words: recommended
   architecture, recommended backend stack, and the expected all-in monthly cost.
2. **Recommended Architecture** — a line-item monthly cost table (resource, SKU/tier,
   fixed cost, variable cost at our volume, total), plus a short justification.
3. **Per-Question Answers** — numbered 1–16 matching the questions above, each with
   citations and a checked-on date.
4. **Cost Comparison Tables** — the hosting head-to-head (question 3) and the database
   ranking (question 8) as standalone tables.
5. **Contradictions & Caveats** — explicitly list every place where your findings
   **contradict our prior decisions** (the five locked decisions listed above),
   and every place where pricing was ambiguous, region-dependent, or likely to change.
6. **Open Questions** — anything that requires access to our Azure subscription to
   answer (e.g. whether our specific subscription still qualifies for a free-account
   offer), or that we must decide ourselves.
