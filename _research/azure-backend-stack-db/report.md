# Research Report: Cheapest Azure persistence for RV Trip Planner (~10 users)

**Date**: 2026-09-06 · **Source prompt**: `_research/prompts/azure-backend-stack-db.md`
**Pass 2 — database-focused.** All prices checked 2026-09-06, USD, Central US and East US 2.

> ## ⚠️ COVERAGE NOTICE — READ FIRST
>
> Fully verified **Section B questions 1, 2, 3**, and **question 5 partially**.
>
> **Q4 (Cosmos DB free tier, Cosmos serverless, Table Storage, Blob Storage — including the
> concrete "is email-uniqueness enforceable on Table Storage" question) produced NO confirmed
> claims and is UNANSWERED.**
>
> **All of Section C (Q6, 7, 8) is UNANSWERED.**
>
> Reported as labeled gaps rather than filled with plausible figures. The primary
> recommendation does not depend on them: the Azure SQL free offer already reaches $0/month
> with full relational semantics, which is the floor the Table/Blob alternatives would have
> been competing to beat.
>
> Stats: 5 search angles, 21 sources fetched, 104 claims extracted, 25 verified (3-vote
> adversarial), 21 confirmed, 4 refuted, 6 dropped on budget.

---

## 1. Summary of Findings

**Drop the PostgreSQL Flexible Server B1ms decision. Adopt the Azure SQL Database free offer
(General Purpose serverless with auto-pause). Expected steady-state post-credit cost for the
persistence layer: $0/month.**

The PostgreSQL baseline is confirmed and worse than the plan assumed. B1ms is genuinely the
floor SKU — no B1s, no sub-B1ms option — at **$0.01921/hr Central US (~$14.02/mo)** and
**$0.01700/hr East US 2 (~$12.41/mo)**. The two reference regions differ by ~13%. Storage is a
hard 32 GiB floor on Premium SSD that can only scale **up**, never down. Microsoft labels
Burstable "not recommended for production workloads," with no 24/7 support and no RCA.

Stop/start does suspend compute billing (storage keeps billing), but it is a trap: Azure
**auto-restarts a stopped server after 7 days**, there is no auto-pause-on-idle, and the scheme
demands a recurring re-stop job forever.

The decisive finding is the **Azure SQL Database free offer**: 100,000 vCore-seconds + 32 GB
data + 32 GB backup **per database per month**, up to **10 databases per subscription**,
documented as "free forever… no time limit" and explicitly **"available regardless of your Azure
subscription type."** **PERPETUAL** and usable on the existing pay-as-you-go subscription.
Serverless auto-pauses to zero compute (minimum delay 15 min, default 60), resumes in
**generally under one minute**, and the **default when the grant is exhausted is to auto-pause
until next month** — a hard $0 ceiling unless you irreversibly opt into billing.

Two conditions hold the $0: set auto-pause delay to **15 minutes** (not the 60-minute default),
and hold **no idle connection pool**.

---

## 2. Recommended Architecture

| Resource | SKU / tier | Fixed | Variable at our volume | **Total** |
|---|---|---|---|---|
| Database | Azure SQL Database, GP **serverless**, free offer, auto-pause 15 min, max 4 vCores | $0 | ~40,000 of 100,000 vCore-s/mo | **$0** |
| DB storage | 32 GB data included (we use <1 GiB) | $0 | $0 | **$0** |
| DB backup | 32 GB backup, PITR 7 days, LRS — free under the offer | $0 | $0 | **$0** |
| API compute | ACA Consumption, scale-to-zero *(given from pass 1)* | $0 | Inside the monthly grant | **$0** |
| Container image | GitHub Container Registry *(pass 1 — ACR not required)* | $0 | $0 | **$0** |
| Static SPA | Azure Static Web Apps Free *(limits NOT verified)* | $0 | — | **$0** |
| | | | **Steady-state post-credit** | **$0/mo** |

**Justification.** The grant is consumed by **wall-clock online time**, dominated by the
auto-pause delay window — not by request count. The workload's long idle periods *save* the
money rather than waste it. Full relational semantics, unique constraints, and transactions
survive intact, so no application correctness is traded away.

**The pairing with ACA scale-to-zero is load-bearing, not incidental.** Microsoft documents that
"the presence of open sessions… is the most common reason for a serverless database to not
auto-pause as expected." ACA at zero replicas holds no connections. A warm App Service plan with
a connection pool would defeat auto-pause and collapse the entire cost model.

---

## 3. Per-Question Answers

### Q1. PostgreSQL baseline — ANSWERED

**Method:** `azure.microsoft.com` pricing pages serve client-rendered `$-` placeholders to
fetchers, as anticipated. **All prices from the Azure Retail Prices API**
(`https://prices.azure.com/api/retail/prices`), `priceType eq 'Consumption'`, 2026-09-06, USD.

**Compute — full Burstable ladder ($/hr):**

| SKU | Central US | East US 2 |
|---|---|---|
| **B1MS** | **$0.01921** | **$0.01700** |
| B2S | $0.07684 | $0.068 |
| B2ms | $0.15368 | $0.136 |
| B4ms | $0.30736 | $0.272 |
| B8ms | $0.61472 | $0.544 |
| B12ms | $0.92208 | $0.816 |
| B16ms | $1.22944 | $1.088 |
| B20ms | $1.5368 | $1.36 |

At 730 h/mo: **Central US ~$14.02**, **East US 2 ~$12.41**. **~13% region spread** — the plan's
~$12–13/mo is right for East US 2 and ~$1–1.60/mo low for Central US.

B1MS verified field-by-field: `retailPrice` 0.01921, `unitOfMeasure` "1 Hour", `meterId`
b383f128-f841-5b48-8fba-a99736f080f4, `effectiveStartDate` 2021-12-01.

**No SKU cheaper than B1ms.** Learn `concepts-compute` (ms.date 2026-07-08) lists Burstable as
exactly B1ms, B2s, B2ms, B4ms, B8ms, B12ms, B16ms, B20ms. Two meter artifacts dismissed: a legacy
`Basic` meter at the **identical** price to B1MS, and a `Compute - Free` meter at $0.00/hr that is
the **12-month new-account free-tier grant applied to B1ms**, not a distinct SKU — unavailable to
an existing pay-as-you-go subscription.

> **Hallucination flagged:** a search summary asserting `Standard_B1s` is a valid PostgreSQL
> Burstable SKU traced to Pulumi/Terraform docs and is **false**. No B1s billing meter exists in
> either region. (B1s exists for Azure VMs and MySQL Flexible Server — different services.)

**Minimum storage: 32 GiB (Premium SSD), scales UP only, never down.** `how-to-scale-storage-size`
prints the control plane's own rejection: `Allowed values(in GiB) : [32, 64, 128, 256, ...]`.

> **⚠️ Storage price NOT verified.** The $/GiB-month rate was not retrieved. **The plan's
> ~$3.68/mo for 32 GiB (≈$0.115/GiB) is UNCONFIRMED — do not report it as sourced.**

> **⚠️ Unresolved Microsoft doc contradiction on Premium SSD v2.** `concepts-storage` says v2
> "capacities range from 1 GiB to 64 TiBs"; `how-to-scale-storage-size` says v2's smallest is also
> 32 GiB. **Four claims built on either reading were refuted 0-3.** Only "Premium SSD classic
> starts at 32 GiB" is safe.

**Backup: genuinely $0 at this scale — the plan's separate backup line item is unnecessary.**
`concepts-backup-restore` (ms.date 2026-07-05): "up to 100 percent of your provisioned server
storage as backup storage at no extra cost." **Nuance: the free allowance is framed by VOLUME,
not retention days.** Microsoft's worked example is a volume budget that retention days consume
against ("If the daily backup usage is 25 GiB, you can have up to 10 days of free backup
storage"). Risk vector is WAL churn, not data size — irrelevant here.

**Documented production caveat.** `concepts-compute` IMPORTANT callout: Burstable "is primarily
designed for nonproduction scenarios… **does not qualify for 24/7 support, and root cause
analysis (RCA) may not be provided**" and "Not recommended for production workloads." **Honest
framing:** the same table also calls Burstable "best suited for web servers, proof-of-concept
environments, small databases" — which describes this app. Treat the wording as documented fact
and "therefore not production-sane" as inference.

### Q2. Postgres stop/start — ANSWERED

**Yes, billing genuinely stops — and it is still a trap.**

**Billing.** "While your server is stopped, you will only be billed for the storage you have
provisioned… you will not be billed for compute." **Storage continues to bill.**

**Maximum stop duration: 7 days**, on two independent Learn pages — `how-to-stop-server`
(ms.date 2026-07-08): "Server will be automatically started after 7 days if you do not perform a
manual start operation"; PostgreSQL `overview` (updated 2026-09-05): "The server remains stopped
for seven days unless you restart it sooner." `concepts-limits` concurs. **Unavoidable** — no
toggle, opt-out, or extension documented.

**Auto-pause on idle: none.** Only the portal Stop button and `az postgres flexible-server stop`.
No serverless/auto-pause feature in the June/July 2026 Azure PostgreSQL recaps. Qualification:
Microsoft ships a schedule-based automation task (Logic Apps-backed), so "strictly manual" is
slightly strong — but it is **time-triggered, not idle-triggered**, separately billable, and
still requires configuration. Also: "While the server is in stopped state, it could be briefly
restarted for scheduled monthly maintenance."

> **⚠️ Could not confirm a documented figure for start latency from a stopped state.** The
> multi-minute premise is plausible but **no documented number was found — do not report as
> sourced.**

The case against stop/start doesn't need the latency number: the **7-day auto-restart** means a
recurring re-stop job *forever*, and the absence of idle-triggered pausing means the job is
time-based and will either stop a server someone is using or leave one running that nobody is.
**Verdict: don't.**

### Q3. The Azure SQL Database free offer — ANSWERED (highest-value finding)

**It exists, it is PERPETUAL, and it works on a pay-as-you-go subscription.**

**Exact terms.** `free-offer` (ms.date 2026-03-10, updated **2026-09-01** — five days before
check): "For each database, you get **100,000 vCore seconds, 32 GB of data, and 32 GB of backup
storage free per month for the lifetime of your subscription. Each Azure subscription allows you
to create up to 10 General Purpose databases.**"

**Perpetual, not a 12-month promotion — stated explicitly.** Prerequisites: **"While the
[previous offer] required an Azure Free subscription, this new offer is available regardless of
your Azure subscription type."** FAQ (updated 2026-05-15): **"The database is free forever, with
monthly limits. There's no time limit."** and "There's a limit of 10 free databases per
subscription." The old 12-month version is a **separate, separately-documented offer**
(`free-sql-db-free-account-how-to-deploy`) — don't confuse them. The only documented exclusion is
**Microsoft Azure for Students Starter**. Verifiers searched for reports of the offer being
blocked on pay-as-you-go / CSP / sponsored subscriptions and **found none**.

**When the grant is exhausted: auto-pause is the default; billing is opt-in and IRREVERSIBLE.**
Two options under "Behavior when free limit reached": **"Auto-pause the database until next
month"** and "Continue using database for additional charges" (billed at standard GP serverless
rates). The portal "Start free" flow creates "with defaults, including the option to pause the
database when the free limits are reached." Reinforced twice: "You won't be charged… unless you
exceed the free database amount **and have selected to continue using for additional charges**."
FAQ: under auto-pause, "once the free limits are met, the database [is] inaccessible until the
start of the next calendar month." **Hard $0 ceiling.**

> **⚠️ BLOCKING DEPLOYMENT CAVEAT.** The auto-pause default is documented **for the portal flow
> only**. The default of `freeLimitExhaustionBehavior` for **CLI / PowerShell / Bicep** is **NOT
> documented** — and this project deploys via **Bicep + azd**. Set it explicitly. **Switching to
> `BillOverUsage` cannot be reverted.**

**Auto-pause semantics** (`serverless-tier-overview` ms.date 2026-07-28,
`serverless-tier-auto-pause-resume`):

- "When the database is paused, the compute cost is zero and only storage costs are incurred."
- Auto-pause delay: **minimum 15 minutes**, maximum 10,080 min (7 days), 1-min increments, `-1`
  disables. **Default 60 minutes.** (15-min floor is a genuine reduction from the original 1-hour
  minimum — Microsoft AzureSQL blog, Oct 2024.)
- Billing granularity: **per second**.
- Pause triggers only when **sessions = 0 AND user-pool CPU = 0** for the whole delay window.
- Supported **only** in General Purpose, vCore, Standard-series (Gen5). Not DTU, not Business
  Critical. **Hyperscale serverless never reaches zero compute.**

**Resume latency — seconds to one minute, but the first connection FAILS.**
"The latency is generally on the order of **one minute to auto-resume** and 1–10 minutes to
auto-pause. The latency for either operation can be as low as the order of one second." And:
**"If a serverless database is paused, the first connection attempt resumes the database and
returns an error stating that the database is unavailable with error code 40613. Once the
database resumes, retry the connection."** **Retry logic is mandatory, not optional.**

> **COMMUNITY-TIER (not doc-grade):** dotnet/SqlClient #1957 reports resume taking ~45 s — long
> enough that SqlClient's *default* configurable-retry provider times out before resume
> completes, so **a custom extended retry window may be needed**. Microsoft Q&A (2025–2026)
> reports rare cases stuck Pausing/Resuming for hours requiring Support. No SLA on the free offer.

**Does the workload fit? Yes — comfortably, but not unlimited:**

| Step | Figure |
|---|---|
| Naive: 100,000 vCore-s ÷ 0.5 min vCores | 200,000 s = **55.6 h/mo** |
| **Correction:** `serverless-tier-billing`'s worked example shows a 4-max/0.5-min vCore DB has 2.1 GB min memory → minimum compute bill of **0.7 vCores** (billing takes max of min-vCores and min-memory-GB × ⅓) | |
| **Corrected planning figure:** 100,000 ÷ 0.7 | 142,857 s = **~39.7 h/mo online time** |

| Pattern | Online time | vCore-s | Verdict |
|---|---|---|---|
| Heavy: 4 sessions/wk × (2 h active + **60 min** default delay) | ~48 h/mo | ~121,000 | ❌ **EXCEEDS grant** |
| Heavy, delay lowered to **15 min**: 4 sessions/wk × 2.25 h | ~39 h/mo | ~98,000 | ⚠️ Right at the line |
| **Realistic hobby: 3 sessions/wk × (1 h active + 15 min delay)** | ~16 h/mo | ~40,000 | ✅ **~40% of grant** |

**SET THE AUTO-PAUSE DELAY TO 15 MINUTES rather than leaving the 60-minute default.** At a few
hundred requests/day, **the delay window, not the request count, is the dominant consumer.** Data
volume (<1 GiB vs 32 GB) is a non-issue. Microsoft warns: "Leaving connections open can continue
to consume credits by preventing auto-pause."

**Catches and foot-guns:**

- **Region lock.** "Once a region is selected for a free database under a subscription, the same
  region applies to all free databases in that subscription, and **cannot be changed**."
- **No SLA.** FAQ: the free amount "doesn't come with a service level agreement (SLA) and is
  recommended primarily for development and proof-of-concept scenarios." **Note the symmetry:**
  Burstable PostgreSQL carries the same class of caveat, so this does **not** differentiate them.
- **Operations that silently auto-resume a paused database** (documented trigger table): viewing
  auditing records or updating/viewing auditing policy; vulnerability-assessment manual and
  **periodic** scans; modifying or viewing **Query Store** settings; viewing or applying
  **performance recommendations**; application/verification of **auto-tuning** recommendations
  such as autoindexing; and **adding or modifying Azure tags on the database**. Severity: at a
  60-min delay and 0.5 min vCores, one spurious resume ≈ 1,800 vCore-s ≈ **1.8% of the monthly
  grant** — hygiene, not crisis. Don't enable VA periodic scans, auto-tuning, or SQL Data Sync.
- **Features that block auto-pause ENTIRELY:** geo-replication / failover groups, **long-term
  backup retention (LTR)**, a **DNS alias** on the logical server, SQL Data Sync sync databases,
  elastic-jobs job databases. **LTR and DNS alias are easy accidental foot-guns.**
- **COMMUNITY-TIER** (Microsoft Q&A 5861463, moderator answer): internal platform operations may
  resume a paused DB at ~5-minute intervals and that time is billable — idle burn may be slightly
  above exactly zero.
- **Time sensitivity.** "**Currently**, auto-pause and auto-resume are only supported in the
  General Purpose service tier" signals a stated-temporary limitation. Terms already changed once
  (12-month free-account → perpetual any-subscription, GA ~May 2025). Re-check before committing.

### Q4. Non-relational and storage-based alternatives — ❌ NOT ANSWERED

**No claims addressing Cosmos DB free-tier perpetuity or per-subscription limits, Cosmos
serverless costing, Table Storage semantics, Blob ETag concurrency, or the concrete
"is email-uniqueness enforceable on Table Storage" correctness question survived verification.**

Sources *were* fetched (`cosmos-db/free-tier`, `storage/tables/table-storage-design-patterns`,
`rest/api/storageservices/table-service-error-codes`, `storage/blobs/concurrency-manage`) but
dropped on budget before reaching a vote.

**One fragment**, incidental to the Retail Prices API check (2026-09-06, Central US, USD): Cosmos
DB serverless at **$0.282 per 1M RUs**; Table Storage Batch Write at **$0.00036 per 10K**. At our
volume those imply cents-to-single-dollars/month — but **no RU-consumption model, no free-tier
eligibility determination, and no correctness analysis was verified. Do not plan against these.**

**Why this gap does not block the decision:** the Azure SQL free offer already reaches **$0/month
with full relational semantics**. That is the floor these alternatives would have had to beat, and
none can go below $0 while *also* giving back the correctness guarantees. This matters only as
**fallback research if the free offer proves unavailable on this subscription.**

### Q5. Rank and recommend — PARTIALLY ANSWERED

Full ranked table **cannot be completed as specified** because Q4's options were never priced.

**(a) Absolute cheapest** — Azure SQL DB free offer, GP serverless, auto-pause 15 min,
`freeLimitExhaustionBehavior = AutoPause`, paired with ACA scale-to-zero. **$0/month.**

Traded away: no SLA; a **hard stop** — grant exhaustion makes the DB inaccessible until next
calendar month rather than degrading gracefully; mandatory retry for error 40613; a permanent
design constraint that the backend must not hold an idle connection pool; region locked at first
free-database creation.

**(b) Cheapest that a reasonable engineer would still call production-sane** — **the same
architecture.** No extra dollars warranted.

Worth stating plainly because it is the unusual outcome: normally (a) and (b) diverge. Here they
don't, because the cheap option is not a degraded option — it is **full Azure SQL with real
relational semantics**. The cheapness comes from the workload's idleness fitting a serverless
billing model, not from giving up correctness. The honest asterisk is the SLA, and **PostgreSQL
B1ms carries the same class of caveat** while costing $12–14/month more. Paying for Burstable
PostgreSQL does not buy production-grade support; it just costs more.

### **Verdict on the locked decision: DROP PostgreSQL B1ms.**

It costs $12.41–14.02/mo compute alone, forces a 32 GiB storage floor that can never shrink,
carries Microsoft's own "not recommended for production" label, has no idle-pause mechanism, and
its only cost-avoidance strategy is defeated by a 7-day auto-restart demanding a perpetual
re-stop job.

> **Loose end that becomes moot on dropping PostgreSQL:** a verifier flagged that **built-in
> PgBouncer may not be available on Burstable instances**, contradicting the plan's "B1ms with
> PgBouncer enabled." **Search-summary evidence only, NOT verified** against the Learn PgBouncer
> concepts page.

### Section C — closing the hosting comparison — ❌ NOT ANSWERED

**Q6, 7, 8 entirely unanswered.** Section B consumed the full verification budget — the outcome
the brief designated as success. Sources fetched (`static-web-apps/quotas`, `/plans`,
`/apis-container-apps`, `/apis-functions`) but no claims survived to verification.

**Do not assume** that `apis-container-apps` implies linked backends work on the Free tier — that
is precisely the open question. This should be the next pass's primary scope.

---

## 4. Ranked Database Comparison

**Incomplete — Q4's options are absent because they were never verified.**

| # | Option | Monthly cost | Implementation complexity | Operational toil | Notes |
|---|---|---|---|---|---|
| **1** | **Azure SQL DB free offer, GP serverless, auto-pause 15 min** | **$0** (hard ceiling; ~40% of grant) | Low-moderate — full SQL; **must add retry for 40613**; must not pool idle connections | **Very low** — no recurring job | Perpetual, any subscription type, 10 DBs/sub. No SLA. Region locked at creation. |
| **2** | PostgreSQL Flexible Server B1ms, always on | **$12.41/mo** (East US 2) / **$14.02/mo** (Central US) + 32 GiB storage *(rate unconfirmed)* + $0 backup | Low — plain Postgres, `jsonb` | Low | The plan of record. "Not recommended for production," no 24/7 support, no RCA. |
| **3** | PostgreSQL B1ms with scripted stop/start | Compute prorated; storage always bills | Low for DB; **moderate** automation | **High** — perpetual re-stop job vs the 7-day auto-restart; time- not idle-triggered | **Not recommended.** Start latency from stopped state **unconfirmed**. |
| — | Cosmos free tier / Cosmos serverless / Table / Blob | **NOT VERIFIED** | NOT VERIFIED | NOT VERIFIED | See Q4 gap. |

---

## 5. Contradictions & Caveats

**Where findings contradict the stated plan:**

1. **"PostgreSQL B1ms" — contradicted outright.** A perpetual $0 option with full relational
   semantics exists and is documented as available on this subscription type. Drop it.
2. **"~$12–13/mo compute" — region-dependent and low for one reference region.** $12.41 East US 2
   but **$14.02 Central US**, a ~13% spread on identical hardware.
3. **"~$3.68/mo storage" — UNCONFIRMED.** The rate was never retrieved. The 32 GiB *minimum* is
   confirmed; the *price* is not.
4. **Separate backup line item — unnecessary.** Backup is $0 up to 100% of provisioned storage.
   But the free allowance is framed by **volume, not retention days**.
5. **"PgBouncer enabled" — possibly self-contradictory** with Burstable. Unverified; moot.
6. **"Everything in Azure" — unchallenged and now vindicated.**

**Ambiguous / likely to change:**

- **Unresolved Microsoft doc contradiction** on Premium SSD v2 minimum (1 GiB vs 32 GiB). Four
  claims on either reading refuted 0-3.
- **Region lock on the free offer** is permanent per subscription.
- **`freeLimitExhaustionBehavior` default for Bicep/azd is undocumented**; the switch to
  `BillOverUsage` is irreversible. Set explicitly.
- **"Currently"** in the GP-only auto-pause limitation signals a stated-temporary constraint.
- Free-offer terms **changed once already** (GA ~May 2025). Re-check before committing, and again
  before the credit runs out.

**Where the primary recommendation could break:**

- **(a)** The $0 depends on compute holding **no idle connections**. ACA at zero replicas is
  compatible; a warm App Service plan with a pool is not — the cost model collapses entirely.
- **(b)** If the Bicep default is `BillOverUsage`, the $0 ceiling is gone and irreversibly so.
- **(c)** Grant math is comfortable but **not unlimited at the 60-minute default delay.**
- **(d)** No SLA; "primarily for development and proof-of-concept." Same class of caveat as
  Burstable PostgreSQL, so it doesn't differentiate the two.

**Source-quality grading.** Everything load-bearing is Microsoft Learn primary documentation, most
pages dated 2026-07 or later, `free-offer` updated **2026-09-01**. **All prices from the Azure
Retail Prices API** because azure.microsoft.com serves `$-` placeholders to fetchers. Explicitly
**community-tier and labeled**: dotnet/SqlClient #1957, Microsoft Q&A on stuck Pausing/Resuming,
Microsoft Q&A 5861463.

**API ergonomics note.** Retail Prices API filter **values are case-sensitive** from api-version
2023-01-01-preview — `B1MS` works, `B1ms` does not. A control filter on a bogus field returned
HTTP 400, proving field validation. **Hard limit:** returns retail *list* prices only — it cannot
answer free-offer eligibility questions.

---

## 6. Open Questions

**Requiring access to the actual Azure subscription:**

1. **Does this pay-as-you-go subscription actually surface the Azure SQL "Start free" / "Free
   offer applied!" banner?** Docs say "regardless of your Azure subscription type" (excluding only
   Azure for Students Starter), but do not state whether the portal applies any account-level
   check beyond subscription type, or how existing credit / offer codes interact.
   **Verify by attempting to create the free database before writing any Bicep. This is the
   single highest-value five-minute check available.**
2. **What is the default `freeLimitExhaustionBehavior` (`AutoPause` vs `BillOverUsage`) when
   created via Bicep/azd/CLI rather than the portal?** Documented for the portal flow only. Since
   this deploys via Bicep + azd and the switch is **irreversible**, set it explicitly — but the
   safe default for template-based creation is genuinely undocumented.

**Unanswered by this pass:**

3. **All of Q4** — Cosmos free tier existence/perpetuity/PAYG eligibility; Cosmos serverless
   costing; and **can "email must be unique" be enforced safely on Table Storage** via an
   entity-per-email row with Insert-only semantics and ETag/If-None-Match, given no
   cross-partition transactions? These matter far less now — but they are the **stated fallback
   if open question 1 comes back negative.**
4. **All of Section C** — SWA Free bandwidth/size/custom-domain limits; SWA managed Functions
   deprecation signal; whether BYO Functions is Standard-only; and critically **whether SWA linked
   backends / API proxying to an external Container App works on the FREE tier.** Not cosmetic:
   **if Free cannot proxy, the SPA must call the ACA origin cross-site, which likely forces
   `SameSite=None` on the session cookie and changes the auth design.**

**To decide ourselves:**

5. **Which region to lock the free database into** — permanent per subscription. (East US 2 is
   ~13% cheaper than Central US for PostgreSQL compute, but that is irrelevant if PostgreSQL is
   dropped; choose on latency/colocation with the ACA app instead.)

---

## Promotion Checklist

- [x] Durable findings promoted into PLAN.md (2026-09-06) — DB decision changed to Azure SQL
- [ ] README.md unchanged — nothing here affects current shipped behavior
