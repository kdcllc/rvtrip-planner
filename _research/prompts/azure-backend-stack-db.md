# Research Request (pass 2): Cheapest Azure persistence for a ~10-user hobby app + closing the hosting comparison

## Read this first — scope control

This is a **second, deliberately narrow pass**. A previous pass answered the hosting
questions (Azure Container Apps / Azure Container Registry) thoroughly and those are
**done — do not re-research them.** That pass ran out of verification budget before
reaching the database, and the database is where essentially all of the projected cost
lives.

**Spend the entire verification budget on Section B (questions 1–5 below). Section C
(questions 6–8) is a smaller, secondary block — only proceed to it if Section B is fully
verified first.** A complete, well-cited answer to Section B alone is a success. A thin
answer spread across both is a failure.

## Context (self-contained — assume no access to our codebase)

**RV Trip Planner** is a small hobby web app: plan an RV road trip as a list of stops with
arrival/departure dates, see the route on a map, per-stop weather, and estimated fuel cost.

- **Today:** React 19 + TypeScript + Vite SPA on **Azure Static Web Apps Free tier**,
  deployed with Bicep + `azd`. **$0/month.** There is no backend — all state is in the
  browser's `localStorage` behind a single storage module. Maps/routing/weather/geocoding
  all use free keyless public APIs and are **out of scope for this research** — they stay
  client-side and unchanged.
- **Goal:** add email/password registration, login, password reset, and **per-user
  server-side trip storage**.

### Scale — this drives everything, please do not lose it

- **1–50 registered users total, realistically ~10.** A personal app, not a startup.
- **A few hundred HTTP requests per day at most**, extremely bursty: someone plans a trip
  in one sitting, then nothing for days or weeks. **Long idle periods are the norm** —
  this is the single most important characteristic for costing.
- **Data volume is trivial.** A trip is a small JSON document (a list of stops with
  address, lat/lon, and dates). Total data is **kilobytes to a few megabytes**. Under
  1 GiB essentially forever.
- No compliance requirements, no SLA, no HA, no geo-redundancy, no read replicas, single
  region. Downtime is annoying, not costly.
- **Cold start is explicitly acceptable — this is a confirmed decision, not a preference.**
  A few seconds of latency on the first request after an idle period is fine. Assume
  **scale-to-zero / auto-pause everywhere it saves money**, and do **not** hedge your
  recommendations toward always-warm compute or provisioned capacity on latency grounds.
  The one thing we do care about is the *magnitude*: quantify resume/cold-start latency
  where documented, and flag clearly if any option's first-request penalty is measured in
  **minutes** rather than seconds (see question 2).
- Solo maintainer. **Operational simplicity is worth real money here** — a design that
  saves $10/month but demands monthly manual intervention is a bad trade.

### Subscription type — this constrains which free tiers are usable

The target is an existing **pay-as-you-go subscription carrying roughly $700 of Azure
credit**. Two consequences you must respect:

1. **This is not a new Azure free account.** Offers scoped to the free account's first
   12 months are therefore **almost certainly unavailable to us**. When you evaluate any
   free tier or grant, state explicitly whether it is a **perpetual** benefit available to
   a standard pay-as-you-go subscription, or a **12-month new-account promotion**. Only
   the former is useful here. If an offer's eligibility rules are ambiguous on this point,
   say so rather than assuming.
2. Because credit is available, this is **not a question of affordability** — it is about
   burn rate, how long the credit lasts, and what the bill looks like after it is gone.
   So please report the **steady-state post-credit monthly cost** as the headline number.

### Reference regions and currency

Use **Central US** and **East US 2**, **USD**. State the date you checked every price and
whether the two regions differ.

### What our current plan assumes (challenge this — it is a bias, not ground truth)

Our internal plan currently specifies **Azure Database for PostgreSQL Flexible Server,
Burstable B1ms, 32 GiB storage, PgBouncer enabled, pay-as-you-go**, with a schema of four
small tables (`users`, `sessions`, `password_reset_tokens`, and `trips` storing the trip
as a `jsonb` column). Estimated at **~$12–13/mo compute + ~$3.68/mo storage ≈ $15–17/mo**,
which is **~94% of our entire projected bill.** We also assumed a "*Allow Azure services*"
firewall rule rather than VNet/private endpoint, to avoid being forced onto a paid
Static Web Apps tier.

**If a materially cheaper option exists that still supports this workload, we want to hear
it plainly, including "stop using a relational database for this."**

### Established from pass 1 — treat as given, do not re-verify

- Azure Container Apps Consumption has a recurring per-subscription monthly free grant
  (180,000 vCPU-s / 360,000 GiB-s / 2M requests) and **costs $0 in compute at zero
  replicas**. ACA + GitHub Container Registry is a plausible **$0/month** hosting floor;
  **ACR is not required**.
- Therefore hosting is plausibly $0 either way, and **the database is the whole bill.**

---

## Section B — the database (PRIMARY; spend the budget here)

### 1. Confirm the PostgreSQL baseline we are trying to beat

Current pay-as-you-go price of **Azure Database for PostgreSQL Flexible Server, Burstable
B1ms**, in the reference regions. Break out **compute vs. storage vs. backup** as separate
line items. State the **minimum provisionable storage** and its cost. Confirm whether
7-day backup retention is genuinely included at no extra charge. Is there **any SKU
cheaper than B1ms** on Flexible Server?

### 2. Can a Postgres Flexible Server be stopped to kill the compute bill?

Our workload idles for days at a time, so this could be decisive.

- Confirm the **stop/start** capability: is compute billing genuinely suspended while
  stopped, and does **storage continue to bill**?
- What is the **maximum stop duration** before Azure auto-restarts the server, and is that
  auto-restart documented and unavoidable?
- Is there **any auto-pause / auto-stop on idle**, or is stopping strictly a manual or
  scripted action?
- If it must be scripted, what would drive it — and be realistic about the fact that an
  app whose first request must *start a database* is facing a multi-minute cold start, not
  a multi-second one. **Is this actually viable for a user-facing login, or is it a trap?**
  Say so plainly.

### 3. The Azure SQL Database free offer — highest-value question in this pass

Microsoft has published a **free tier / free offer for Azure SQL Database serverless**
(a monthly vCore-seconds + storage grant on a General Purpose serverless database).

- Does this offer **still exist** as of the check date? Give exact current terms: vCore
  seconds/month, GB of storage, how many free databases per subscription.
- Is it **perpetual**, or a 12-month Azure-free-account promotion? This distinction is the
  whole ballgame — be explicit and cite it. **Specifically: can an existing pay-as-you-go
  subscription create a free-offer database, or is the offer restricted to new free
  accounts?** If Microsoft's documentation does not state this clearly, say so.
- What happens when the monthly grant is exhausted: does it **bill normally**, or can the
  database be configured to **auto-pause / stop serving** until the next month? Which is
  the default?
- What are the **auto-pause** semantics on serverless (minimum auto-pause delay, resume
  latency on the first connection after pause)? Quantify the resume delay if documented.
- Would our workload (~10 users, a few hundred requests/day, <1 GiB) fit **inside** the
  free grant? Show the arithmetic.
- Any catches: region availability, subscription-type restrictions, whether it requires a
  specific deployment method, what happens at subscription upgrade.

### 4. Non-relational and storage-based alternatives

Our data shape is: a few small JSON documents per user, plus a users table, a sessions
table, and a reset-tokens table. Evaluate each with current pricing **and** an honest
assessment of what we would have to give up:

- **Azure Cosmos DB free tier** (historically 1,000 RU/s + 25 GB free per account) — does
  it still exist, is it one account per subscription, is it perpetual, and is it available
  on a standard **pay-as-you-go** subscription? And **Cosmos DB
  serverless** — what would our volume actually cost?
- **Azure Table Storage** (or Storage Account tables) — at our volume this is presumably
  cents per month. What do we give up: no SQL, no joins, no cross-partition transactions,
  limited querying, no unique-constraint enforcement. **Is enforcing "email must be
  unique" for registration actually workable on Table Storage?** This is a concrete
  correctness question, not a preference — answer it specifically.
- **Azure Blob Storage** holding one JSON blob per user — even cheaper, but describe the
  concurrency/consistency story (ETags, optimistic concurrency) and whether it can safely
  back a sessions table.
- Any other Azure-native option with a **perpetual** free tier that fits this shape.

### 5. Rank and recommend

Produce a **ranked table** of every option in questions 1–4: monthly cost at our volume,
what it costs us in implementation complexity, and what it costs us in operational toil.

Then give **two explicit recommendations**:

- **(a) Absolute cheapest** architecture that still delivers registration, login, per-user
  trip storage, and password reset — with the monthly figure and what is being traded away.
- **(b) Cheapest that a reasonable engineer would still call production-sane** — if it
  differs from (a), explain exactly what the extra dollars buy.

State plainly whether our locked "PostgreSQL B1ms" decision should be **kept or dropped**.

---

## Section C — closing the hosting comparison (SECONDARY; only if B is complete)

Pass 1 verified the ACA side but never researched the Static Web Apps side, so we still
cannot compare them. These are the missing pieces.

### 6. Azure Static Web Apps Free tier — documented limits

Bandwidth quota, app size limit, number of custom domains, and whether a **custom domain
with a free managed TLS certificate** is supported on Free. Are there documented limits
that would bite a multi-user app with server-side sessions?

### 7. Static Web Apps managed Functions — capability and health

- Documented execution limits: **timeout, memory, cold-start behavior**, whether durable
  or long-running functions are supported.
- Can managed Functions hold **outbound connections to a database**, and what is the
  documented connection-management guidance (given a connection-limited Burstable DB)?
- Is **Bring Your Own Functions** allowed on the **Free** tier, or Standard only?
- **Is there any documented signal that Static Web Apps managed Functions are deprecated,
  in maintenance mode, or discouraged for new work?** Answer this explicitly — a "no
  signal found" is a useful answer.

### 8. The hybrid option pass 1 never costed

Pass 1 compared "ACA serving both the SPA and the API" against "SWA Free + managed
Functions". It missed an obvious third shape: **Static Web Apps Free serving the static
SPA (always-warm CDN) + Azure Container Apps serving only the API (scale-to-zero)**.

- Is this a supported, documented configuration?
- What does it cost — is it still $0 + $0?
- How is the API reached: does SWA support **linked backends** / API proxying to an
  external Container App, and **is that available on the Free tier or Standard only?**
  If Free cannot proxy, the SPA must call the ACA URL cross-origin — describe the **CORS
  and cookie consequences** for an HttpOnly `SameSite=Lax` session cookie on a different
  domain. Would we be forced to `SameSite=None`, and what does that cost us in security?

This matters because a single ACA container serving both static and API puts **the first
page load** behind a cold start, not just the first API call.

## Constraints on Answers

- **Cite a source for every price**, preferring official Azure pricing pages and Microsoft
  Learn. **State the date checked, the region, and the currency.** Note that some Azure
  pricing pages render rates client-side and serve `$-` placeholders to automated
  fetchers — if that happens, use the **Azure Retail Prices API**
  (`https://prices.azure.com/api/retail/prices`) and say that you did.
- For every free tier or grant, state explicitly whether it is **perpetual** or
  **expires after 12 months**, and whether it is **one per subscription**.
- Distinguish **documented behavior** (Learn/docs link) from **inferred or community
  knowledge** (blogs, GitHub issues, Stack Overflow). Label the latter clearly.
- If something cannot be confirmed from public documentation, **say "I could not confirm
  this"**. A labeled gap is far more useful than a confident wrong number. Do not fill
  gaps with plausible-sounding figures.
- **Do not assume our prior decisions are correct.** "Drop PostgreSQL, use Azure SQL free /
  Table Storage, your real cost is under $2" is a welcome answer if the evidence supports it.
- **Show your arithmetic.** Line-item tables beat single totals.
- Keep recommendations proportionate to a solo maintainer running a hobby app for ~10
  users. Do not recommend VNet integration, Key Vault private endpoints, multi-region, or
  APIM unless free and zero-toil.

## Required Report Structure

1. **Summary of Findings** — under 300 words: recommended persistence choice, whether to
   keep or drop PostgreSQL B1ms, and the expected all-in monthly cost.
2. **Recommended Architecture** — line-item monthly cost table (resource, SKU/tier, fixed,
   variable at our volume, total) plus a short justification.
3. **Per-Question Answers** — numbered 1–8 matching above, each with citations and a
   checked-on date. **If you only completed Section B, say so at the top and answer 1–5.**
4. **Ranked Database Comparison** — question 5's table as a standalone section.
5. **Contradictions & Caveats** — every place your findings contradict our stated plan
   (PostgreSQL B1ms, everything-in-Azure, pay-as-you-go), and every price that was
   ambiguous, region-dependent, or likely to change.
6. **Open Questions** — anything needing access to our actual Azure subscription (e.g.
   whether this specific subscription qualifies for a given free offer), or that we must
   decide ourselves.
