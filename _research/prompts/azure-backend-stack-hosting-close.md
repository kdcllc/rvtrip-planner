# Research Request (pass 3): Close the hosting decision — SWA Free limits, linked backends, and the session-cookie consequence

## Read this first — scope control

This is the **third and final narrow pass**. Two previous passes are **done — do not
re-research them**:

- **Pass 1 (hosting/containers):** Azure Container Apps Consumption has a recurring
  per-subscription monthly free grant (180,000 vCPU-s / 360,000 GiB-s / 2M requests) and
  costs **$0 in compute at zero replicas**. **ACR is not required** — ACA can pull private
  images from GitHub Container Registry via a registry credential secret, and `azd`
  supports third-party registries. Cold start is accepted by the project.
- **Pass 2 (database):** the **Azure SQL Database free offer** (100,000 vCore-seconds +
  32 GB data + 32 GB backup per database per month, perpetual, available regardless of
  subscription type) reaches **$0/month** with General Purpose serverless and auto-pause.
  PostgreSQL has been dropped.

**Everything in the projected architecture is now $0/month except one unresearched line
(transactional email) and one unresolved question (this one).** This pass has a small,
sharply bounded job. **Spend the whole verification budget on Section A (questions 1–4).
Section B (question 5, email) is secondary — only proceed if Section A is fully verified.**

A complete answer to question 3 alone would be a success. It is the one that changes code.

## Context (self-contained — assume no access to our codebase)

**RV Trip Planner** is a small hobby web app: plan an RV road trip as a list of stops with
dates, see the route on a map, per-stop weather, estimated fuel cost.

- **Today:** React 19 + TypeScript + Vite SPA on **Azure Static Web Apps Free tier**,
  deployed with Bicep + `azd`, **$0/month**. No backend — all state in browser
  `localStorage`. Maps/routing/weather/geocoding use free keyless public APIs and are
  **out of scope**.
- **Being built:** email/password registration, login, password reset, and per-user
  server-side trip storage, on **Azure SQL serverless (free offer)** with an API on
  **Azure Container Apps, scale-to-zero**.
- **Auth design:** classic database-backed email/password with hashed passwords, and
  **server-side revocable sessions carried in an HttpOnly, Secure, SameSite=Lax cookie**.
  There is a `sessions` table; the cookie holds an opaque token.

### Scale and constraints

- **~10 registered users**, a few hundred requests/day, extremely bursty, long idle periods.
- Data is kilobytes. No compliance, no SLA, no HA, single region.
- **Cold start is explicitly acceptable** — seconds of latency on the first request after
  idle is fine. Do not hedge toward always-warm compute on latency grounds.
- **Pay-as-you-go subscription with ~$700 credit.** Not a new free account, so
  **12-month new-account offers do not apply** — only perpetual free tiers are usable.
  State perpetual-vs-promotional explicitly for anything free you find.
- Solo maintainer; operational simplicity has real value.

### The architectural question this pass must settle

Two shapes are on the table, and we cannot choose between them without these answers:

- **Shape A — everything on ACA.** One container serves both the built static SPA and the
  API. Same-origin, so the session cookie is straightforward. **But the container
  scales to zero, so the first *page load* after idle pays the cold start, not just the
  first API call.**
- **Shape B — hybrid.** Static Web Apps Free serves the SPA from its always-warm CDN;
  Azure Container Apps serves only the API at `/api/*`, scaling to zero. The static page
  is always fast. **But this only preserves the same-origin cookie if SWA can proxy to
  the Container App — and whether that works on the Free tier is exactly what's unknown.**

---

## Section A — closing the hosting decision (PRIMARY)

### 1. Azure Static Web Apps Free tier — documented limits

Confirm from official documentation, with the checked-on date:

- **Bandwidth quota** per month, and what happens when it is exceeded (throttle, block, or
  overage billing).
- **App size limit** for the deployed static content.
- **Number of custom domains** allowed on Free.
- Whether a **custom domain with a free managed TLS certificate** is supported on the
  **Free** tier specifically, or requires Standard.
- Any **other documented Free-tier limit** that would bite a multi-user app with
  server-side sessions (request limits, concurrent connections, geographic restrictions).

### 2. Static Web Apps managed Functions — capability and health

- Documented **execution limits**: timeout, memory, and any documented cold-start behavior.
- Whether **durable or long-running functions** are supported on managed Functions.
- Can managed Functions hold **outbound connections to a database**? What is the documented
  connection-management guidance?
- Is **Bring Your Own Functions** allowed on the **Free** tier, or Standard only?
- **Is there any documented signal that Static Web Apps managed Functions are deprecated,
  in maintenance mode, or discouraged for new work?** Answer explicitly — "no signal found"
  is a useful, reportable answer. Do not manufacture a concern.

### 3. Linked backends / API proxying to an external Container App — THE KEY QUESTION

This is the highest-value question in the pass because it determines the **auth design**,
not just the hosting bill.

- Does Azure Static Web Apps support **linking an external backend** (specifically an Azure
  Container App) so that requests to `/api/*` on the SWA domain are proxied to it?
- **Is that feature available on the FREE tier, or does it require Standard?** Cite the
  documentation that states the tier requirement. This is the crux — please be unambiguous,
  and if the docs are ambiguous, say so rather than guessing.
- If linked backends require Standard: what does the **Standard** tier cost per month? Is
  there any other documented way to get same-origin `/api/*` routing on Free (e.g. route
  rules, rewrites, or a proxy configuration in `staticwebapp.config.json` pointing at an
  external origin)?
- Are there documented **constraints** on linked backends — supported backend types,
  regions, one-backend-per-app limits, whether the backend must be in the same
  subscription/region, and how authentication between SWA and the backend works?

### 4. If SWA Free cannot proxy: the cross-origin cookie consequence

Answer this **regardless of question 3's outcome**, because it is the fallback design.

If the SPA is served from `https://<app>.azurestaticapps.net` and the API is at
`https://<api>.<region>.azurecontainerapps.io`, these are **different registrable domains** —
so the session cookie becomes a **third-party cookie**.

- Confirm the browser behavior: does an `HttpOnly; Secure; SameSite=Lax` cookie get sent on
  cross-site XHR/`fetch` requests? (Expected answer: no.) Would we be **forced to
  `SameSite=None; Secure`**?
- What is the **current state of third-party cookie blocking** in major browsers as of the
  check date — Safari (ITP), Firefox (Total Cookie Protection), and Chrome (state of
  third-party cookie deprecation, which has changed direction more than once)? Would a
  `SameSite=None` session cookie on a different registrable domain **actually work reliably
  for real users today**, or is it a design that breaks in Safari by default?
- What **CORS configuration** would the Container App need (`Access-Control-Allow-Origin`
  with an explicit origin, `Access-Control-Allow-Credentials: true`, preflight handling)?
- **What are the realistic alternatives if `SameSite=None` is not viable?** Evaluate at
  least: (a) a **custom domain** with the SPA on `app.example.com` and the API on
  `api.example.com`, making them same-site (confirm this makes `SameSite=Lax` work, and
  note it requires owning a domain and free managed certs on both services); (b) moving to
  Shape A (one ACA container serving both, same-origin); (c) token-in-header auth
  (Authorization bearer token) instead of cookies, and what that costs in XSS exposure
  versus HttpOnly cookies.
- Give a **recommendation** on which auth transport to build, given this project already
  decided on server-side revocable sessions.

---

## Section B — the last unpriced line (SECONDARY; only if Section A is complete)

### 5. Transactional email for password reset

Volume is **a handful of emails per month** — realistically under 20.

- Current **Azure Communication Services Email** pricing (per-email and per-MB), and
  whether the **Azure-managed sender domain** (e.g. `donotreply@<guid>.azurecomm.net`) is
  still available with **no DNS setup**. Document its limits: send-rate limits, whether
  Microsoft positions it for production, and any deliverability caveats (does mail from a
  managed domain land in spam?).
- Is there a **fixed monthly charge** for an ACS resource, or is it purely per-message?
- Compare against the cheapest realistic alternatives at this volume: **SendGrid/Twilio via
  Azure Marketplace**, **Resend**, **Brevo**. For each, state the current free-tier
  allowance and whether it is perpetual.
- **Is there an option that is genuinely $0/month at under 20 emails/month?** If yes, name
  it and state the catch.

## Constraints on Answers

- **Cite a source for every claim**, preferring Microsoft Learn and official Azure pricing.
  **State the date checked, region, and currency.**
- Azure pricing pages render rates client-side and serve `$-` placeholders to automated
  fetchers. If that happens, use the **Azure Retail Prices API**
  (`https://prices.azure.com/api/retail/prices`) and say so. Note filter **values are
  case-sensitive** from api-version 2023-01-01-preview.
- For any free tier: state whether it is **perpetual** or a **12-month new-account
  promotion**, and whether it is **one per subscription**.
- Distinguish **documented behavior** from **inferred/community knowledge**; label the latter.
- If something cannot be confirmed from public docs, **say "I could not confirm this."** A
  labeled gap beats a confident wrong answer. Do not fill gaps with plausible figures.
- Browser third-party-cookie policy (question 4) has changed direction repeatedly — be
  careful to report the **current** state as of the check date, not a remembered roadmap.
- Keep recommendations proportionate to a solo maintainer with ~10 users.

## Required Report Structure

1. **Summary of Findings** — under 250 words: Shape A or Shape B, which auth cookie
   transport to build, and any cost this adds above $0.
2. **The Hosting Decision** — a direct recommendation between Shape A and Shape B with the
   reasoning, and the cost of each.
3. **Per-Question Answers** — numbered 1–5, each with citations and a checked-on date.
   **If you only completed Section A, say so at the top and answer 1–4.**
4. **Contradictions & Caveats** — anything contradicting the two prior passes' conclusions,
   and every ambiguous or time-sensitive finding.
5. **Open Questions** — anything needing access to our Azure subscription, or that we must
   decide ourselves.
