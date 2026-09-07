# Research Report: Close the hosting decision — SWA Free limits, linked backends, and the session-cookie consequence

**Date**: 2026-09-07 · **Source prompt**: `_research/prompts/azure-backend-stack-hosting-close.md`
**Pass 3 — hosting + auth transport + email.** All prices checked 2026-09-07, USD, US East 2
(see the region note in §5).

> ## ⚠️ COVERAGE NOTICE — READ FIRST
>
> This report merges **three research runs**:
>
> - **Pass 3a** (deep-research, 106 agents) — answered **Q1** and **Q3** from verified sources.
>   Q3 was the stated success condition for the pass, and it is settled unambiguously.
> - **Pass 3b** (deep-research, 113 agents) — answered **Q2** and found the result that
>   **changes the recommendation**. Q4 remains largely unverified, but Q2's outcome makes it
>   **moot** rather than open.
> - **Pass 3c** (targeted fetches, this session) — answered **Q5**, and resolved the
>   managed-Functions runtime question that pass 3b flagged as a stale-doc gap.
>
> **Fully answered: Q1, Q2, Q3, Q5.**
>
> **Q4 (cross-origin cookie behavior) is deliberately NOT fully answered.** Only the
> Chrome/Privacy-Sandbox half was verified. Nothing was verified about Safari/ITP, Firefox
> Total Cookie Protection, the spec-level `SameSite=Lax` cross-site rule, the Public Suffix
> List status of the two Azure domains, credentialed-CORS configuration, or ACA custom domains
> with managed TLS. **The recommendation below is safe precisely because it makes all of that
> moot** — every surviving option is same-origin. **If the recommended path is ever abandoned,
> Q4 must be researched in full before choosing a transport.**
>
> **One gating item remains, and it needs our subscription:** whether SWA managed Functions can
> reach Azure SQL through the server firewall (§6, item 1).
>
> Combined stats: 12 search angles, 53 sources fetched, 263 claims extracted, 50
> adversarially verified (3-vote), 46 confirmed, 4 refuted, 219 agent calls, plus 6 targeted
> document fetches.

---

## 1. Summary of Findings

**Build Shape C: Azure Static Web Apps Free + managed (built-in) Functions + Azure SQL
serverless free offer.** Same-origin, always-warm static page, no Container App, **$0/month**.
Keep the already-chosen `HttpOnly; Secure; SameSite=Lax` session cookie against `/api`, and add
an explicit CSRF defense. Transactional email adds **~$0.005/month** (ACS, pay-per-message).

This **displaces the Shape A / Shape B framing in the original prompt.** Both of those assumed
the API had to live on Container Apps. It doesn't:

- **Shape B as written is dead on Free.** Linking a Container App so `/api/*` is proxied is a
  *"bring your own API"* feature, and Microsoft documents it as requiring the **Standard** plan
  ($9.00/app/month). There is **no `staticwebapp.config.json` workaround** — `rewrite` values
  must be root-relative, and API route rules support only redirects and role-securing.
- **But managed Functions are available on every plan including Free**, and Microsoft documents
  the `/api` route as reaching the web app *"without requiring custom CORS rules"* — **same-origin
  by construction, with no Container App and no $9/month.**

| Shape | API host | Monthly cost | Same-origin? | Page load after idle |
| --- | --- | --- | --- | --- |
| **C — recommended** | SWA managed Functions | **$0** | ✅ by construction | **Warm** (CDN) |
| A | One ACA container serves SPA + API | $0 | ✅ by construction | Cold start |
| B | SWA **Standard** + linked ACA | $9.00/app | ✅ via server-side proxy | Warm (CDN) |

**What Shape C costs you** (all documented, all small at this scale): no managed identity and no
Key Vault references on managed Functions, so **the Azure SQL credential must be a stored secret
in SWA application settings** — explicitly Microsoft's own *"last resort"*; **HTTP triggers only**
(no timer/queue/Durable), so prune the `sessions` table lazily inside request handlers; 45 s per
request; 30 MB request ceiling.

**Product health: no deprecation signal found** for Static Web Apps or managed Functions. The two
real retirements are narrowly scoped and were **preview-only**: the Dedicated plan (2025-10-31)
and Database Connections / `/data-api/*` (2025-11-30).

---

## 2. The Hosting Decision

### Recommendation: Shape C, gated on one spike

**SWA Free + managed Functions + Azure SQL serverless free offer.** Confidence: the underlying
tier, capability and limit facts are **high** (3-0 unanimous, multiple primary sources); the
architecture call itself is **judgment**.

Why it wins over both original shapes:

1. **It is same-origin without paying.** `apis-functions` checkmarks *"Routing integration that
   makes the `/api` route available to the web app securely without requiring custom CORS rules"*
   for **managed** Functions, and `apis-overview` states managed Functions are *"available in all
   Azure Static Web Apps plans."* So the entire cross-origin cookie problem never arises.
2. **It keeps the always-warm static page** that Shape A gives up, at no cost.
3. **It removes moving parts, not just cost** — no container image, no GHCR credential secret, no
   second Azure resource. For a solo maintainer that is the real win.
4. **The runtime is current.** Pass 3b flagged the `apis-functions` runtime list as visibly stale
   (Node 12–20-preview); the authoritative `languages-runtimes` page (updated 2026-02-25) lists
   **Node.js 22** and **Node.js 20** with **no end-of-support date**, plus .NET 8/9 isolated and
   Python 3.11. A TypeScript API on `node:22` is fully supported.

### ⚠️ The one gating spike — do this before committing

**Can SWA managed Functions reach Azure SQL through the server firewall?** No Microsoft doc was
found stating the outbound IP behavior of managed Functions, or whether Azure SQL's *"Allow Azure
services and resources to access this server"* covers them. **This is the single unverified item
that could invalidate the design.**

Expected outcome: it works — managed Functions run on Azure infrastructure and that setting
allowlists Azure IPs. But that is **inference, not documentation**, and the consequence of being
wrong is the whole architecture. Resolve it empirically: deploy a trivial managed Function that
opens a SQL connection with "Allow Azure services" enabled, and capture the observed outbound IP.
Half an hour of work; do it first.

Note the security shape of that setting: *"Allow Azure services"* is a **broad allowlist covering
any Azure tenant**, not just ours. At ~10 users with kilobytes of trip data behind
password-authenticated endpoints that is an acceptable trade; it is worth knowing you are making it.

### If the spike fails, or the stored credential is unacceptable → Shape A

**One ACA container serving both the SPA and the API.** Still **$0** (pass 1's free grant), still
same-origin, and it **regains managed identity** — Microsoft's passwordless
managed-identity-to-Azure-SQL pattern is fully documented for first-class compute with its own
Identity blade. You pay cold start on first page load, which the brief explicitly accepts, plus a
container image pipeline.

**Third: SWA Standard + linked ACA, $9.00/month.** Only if always-warm *and* managed identity *and*
a linked container all become necessary. This is a **clean upgrade path from Shape A**, not from
Shape C: SWA proxies the entire path unchanged and requires the container's own endpoint to carry
the `/api` prefix, so **building an ACA API with `/api`-prefixed routes now satisfies the proxy's
requirement if you ever buy Standard.**

**Not recommended: token-in-header auth.** It trades away the `HttpOnly` XSS protection that
choosing server-side revocable sessions was meant to get, and every surviving shape is
same-origin, so it buys nothing.

### A latency caveat that applies to every shape

Shape C's always-warm CDN makes the *page* fast, but **Azure SQL serverless with auto-pause still
has to resume** — so the first *login* after a long idle waits on the database regardless of which
shape you pick. Shape C removes one cold start of two, not both. *(Reasoning from pass 2's
established facts, not a separately verified claim.)*

---

## 3. Auth Transport Decision

**Build the already-chosen design: a server-side revocable session, opaque token in an
`HttpOnly; Secure; SameSite=Lax` cookie, scoped to the same origin as the SPA, with the API under
`/api`.** No `SameSite=None`, no CORS credentials configuration, no third-party-cookie exposure,
no custom domain. *Confidence: medium — an architectural conclusion from the verified routing-
integration docs plus the project's own premises, not a directly cited statement.*

**Add an explicit CSRF defense.** `SameSite=Lax` alone is not sufficient for state-changing POSTs.
Implement an **Origin/Referer check plus a double-submit CSRF token** on all mutating endpoints.
That is standard OWASP guidance, but **it was not verified with a citation in either pass — cite
the OWASP CSRF Prevention Cheat Sheet before writing it into the design doc.**

**One browser fact that is worth recording even though it is now moot** (Chrome, checked
2026-09-07 against a status page updated 2026-08-14, verified 3-0): Chrome is **maintaining** the
current third-party-cookie experience — no deprecation, no new standalone prompt. But **Related
Website Sets**, the one mechanism that could have let `azurestaticapps.net` and
`azurecontainerapps.io` declare a relationship, is **being deprecated and removed** (deprecate
M144, removal deferred to M152), with Chromium's stated rationale being *"the current approach to
third-party cookies will be maintained, making RWS unnecessary."* **So RWS was never going to
rescue a cross-domain session cookie.** CHIPS, Storage Access API, and storage/network state
partitioning remain supported.

---

## 4. Per-Question Answers

### Q1 — Azure Static Web Apps Free tier documented limits

*Checked 2026-09-07. Confidence: high (3-0).*

| Limit | Free | Scope |
| --- | --- | --- |
| Included bandwidth | **100 GB/month** | per **subscription** |
| Overage bandwidth | **Unavailable** | (Standard: $0.20/GB) |
| Storage, single environment | **250 MB** | per environment |
| Storage, all environments | **500 MB** | per app |
| File count | **15,000** | per app |
| Custom domains | **2** | per app |
| Preview/staging environments | **3** | per app |
| Apps | **10** | per subscription |
| Request size limit | **30 MB** | per request |

Sources: `learn.microsoft.com/azure/static-web-apps/quotas` (ms.date 2024-05-30, updated
2026-01-23); `.../plans`; the pricing page's static cells. **A Vite React build and ~10 users sit
orders of magnitude inside all of these.**

**Bandwidth overage behavior — it blocks, it does not bill.** Pricing-page FAQ, verbatim:
*"in the free plan if your site exceeds the 100 GB quota, we will not be able to serve your site.
Standard apps that exceed the 100 GB standard quota will be billed at overage rates."* Corroborated
by the quotas table's `Overage bandwidth | Unavailable` on Free — the doc-level statement that **no
overage billing path exists**.

Three scope corrections: the block consequence is documented against the **bandwidth** quota
specifically (exceeding storage/file-count/domain limits fails a *deployment* instead);
"not throttled" is a fair plain reading, **not a documented negative**, and the widely repeated
"immediate 404" is **community inference**; and the 100 GB is pooled **per subscription**.

**Custom domains with free managed TLS: supported on FREE, not Standard-only.** *(3-0, four
claims merged.)* The `plans` table reads *"Free, automatically renewing SSL certificates | ✔ | ✔ |
✔"*, and the same table **does** mark genuinely Standard-only rows with ✗ (`Private endpoints`,
`Assign custom roles with a function`, `SLA`), so the checkmark is meaningful. `custom-domain`
states with **no tier qualifier**: *"Free SSL/TLS certificates are automatically created for the
autogenerated domain name and any custom domains you may add."* Pricing page: *"SSL Certificates |
Free | Free"*.

Caveats: Azure-managed certificates only (BYO certs unconfirmed on any tier); custom domains
cannot be added to preview environments; Unicode/Punycode unsupported. The likely origin of the
mistaken "Standard-only" belief is **Azure App Service's** Free/Shared-tier prohibition — a
different service that does not transfer.

**Other Free-tier limits that would bite a multi-user app: none found.** No documented
request-count, concurrent-connection, or geographic restriction.

### Q2 — Static Web Apps managed Functions: capability and health

*Checked 2026-09-07.*

**Q2a — Execution limits.** *(3-0.)* **45 seconds maximum duration per API request** (from
`apis-overview` "API constraints", applying to all API backends) and a **30 MB request size limit
on all plans** (from `quotas`). `apis-overview` also states *"Network isolated backends are not
supported."*

**LABELED GAPS — the canonical quotas page documents none of these:** no function timeout, no
memory allocation, no cold-start behavior or warm-up guidance, and **no deployment-size limit.**
A full-page fetch confirms the words "timeout", "45", any memory figure and any 100 MB figure are
**all absent**. The reported **100 MB / 104,857,600-byte** ceiling traces only to a deployment
**error string** in `Azure/static-web-apps#1537` and Q&A 1631839 — **community-observed, refuted
as a documented limit.**

Two inference labels: that the 30 MB ceiling applies to `/api` requests is an **inference** (the
quotas page lists it as a generic app limit), corroborated only by community 413 reports which
also note that `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` in app settings is erased — i.e. SWA enforces
the ceiling upstream of the function app. No **response** size limit is documented anywhere found.

**Q2b — Runtimes and triggers.**

*Triggers (3-0):* **HTTP only.** `apis-functions` Constraints, managed column: *"Triggers and
bindings are limited to HTTP."* Its feature table: *"Access to Azure Functions triggers and
bindings | HTTP only | All"* and *"Durable Functions programming model | ✕ | ✔"*. `apis-overview`
adds *"Only HTTP requests are supported for APIs. WebSocket, for example, is not supported."*
**Note:** the docs do not enumerate timer/queue by name — their exclusion **follows from the
general HTTP-only rule**. `Azure/static-web-apps#1133` ("Support for CRON jobs") is still an open
feature request.

*Runtimes (pass 3c, targeted fetch of `languages-runtimes`, updated 2026-02-25):* pass 3b flagged
the `apis-functions` Constraints list (Node 12/14/16/18/20-preview, .NET Core 3.1, Python 3.8–3.10)
as **visibly stale**. The authoritative page is fresher and materially different — set via the
`apiRuntime` property in `staticwebapp.config.json`'s `platform` section:

| `apiRuntime` | Functions version | End of support |
| --- | --- | --- |
| `node:22` | 4.x | **—** |
| `node:20` | 4.x | **—** |
| `node:18` | 4.x | May 31, 2025 |
| `dotnet-isolated:9.0` | 4.x | — |
| `dotnet-isolated:8.0` / `dotnet:8.0` | 4.x | — |
| `python:3.11` | 4.x | — |

**Node.js 22 is supported with no end-of-support date** — so the runtime-staleness concern is
resolved, and a TypeScript API is on a current runtime. Deprecated: .NET Core 3.1, Node.js 12.

**Q2c — Database connections.** *(3-0.)* **Managed Functions do NOT support managed identity or
Key Vault references.** `apis-functions` table: *"Managed identity | ✕ | ✔"* and *"Key Vault
references | ✕ | ✔"*. SWA FAQ: *"Static Web Apps supports managed identity, but it's only used to
retrieve authentication secrets from Key Vault. If you need managed identity or Key Vault
references in your API, use the bring your own Functions app feature."* `key-vault-secrets`:
*"Key Vault integration is not available for: … Static web apps using managed functions"* and
*"Using managed identity is only available in the Azure Static Web Apps Standard plan."*
Corroborating detail: `apis-functions` reserves the `IDENTITY_` app-setting prefix for the
platform — the very prefix the MI token endpoint uses. `Azure/static-web-apps#88` ("Support
Managed Identity", opened 2020) remains open.

**So a stored credential in SWA application settings is the only option.** *Precision:* "connection
string with a password" is right in substance but loose in letter — the alternative is Entra
service-principal auth (client ID + secret/certificate), which is **still a stored credential, not
passwordless.**

**Do not read the Azure Functions MI docs as evidence this works from SWA managed Functions.**
*(3-0, five claims merged.)* `functions-identity-access-azure-sql-with-managed-identity`
(ms.date 2026-07-22) is a complete, supported tutorial — but every step presumes a **first-class
Function App resource with its own Identity blade** (*"go to your function app in the portal. Under
Settings, select Identity"*), and a **full-text fetch of that page contains zero occurrences of
"Static Web App" or "managed functions."**

`manage-connections` states the preference hierarchy verbatim: *"When possible, use managed
identities… When the target service doesn't support Microsoft Entra ID authentication, use Azure
Key Vault… **Only use shared secrets directly in app settings as a last resort.**"* **This project
lands on Microsoft's own "last resort"** — a documented deviation from best practice, acceptable at
this scale but worth recording as a knowing decision.

*Connection-management guidance (3-0):* **reuse a single shared client across invocations** — JS/TS:
create clients at **module scope outside the handler**. `manage-connections`: *"always reuse client
instances across invocations rather than creating new ones. This best practice on all hosting plans
reduces latency, avoids socket exhaustion, and improves resource efficiency."* On SqlClient
specifically: *"ADO.NET implements connection pooling by default. But because you can still run out
of connections, you should optimize connections to the database."* The hard **600 active / 1,200
total outbound connections per instance** limit applies **only to the legacy Consumption plan**
sandbox; Flex Consumption does not impose it.

**MOST IMPORTANT SCOPE GAP:** Microsoft Learn **does not document which hosting sandbox SWA managed
Functions run in**, so *neither* the 600-connection figure *nor* the Flex exemption can be
attributed to this surface. Also relevant: `functions-reference-node` warns you may cache in
globals but *"don't rely on this state to persist. The runtime can recycle your worker at any
time."*

**Firewall reachability: I could not confirm this.** No doc states the outbound IP behavior of
managed Functions or whether *"Allow Azure services and resources to access this server"* covers
them. **This is the gating spike (§2, §6).**

**Q2d — Bring your own Functions: Standard only, not Free.** *(3-0.)* `functions-bring-your-own`:
*"The integration with Azure Functions requires the Static Web Apps Standard plan."* `plans`:
*"APIs via Azure Functions | Managed | Managed or Bring your own Functions app | …"*
`apis-overview`: *"Bring your own APIs is only available in the Azure Static Web Apps Standard
plan."* **On SWA Free, managed Functions are the ONLY API integration available** — every
bring-your-own backend (Functions, App Service, API Management, Container Apps) needs Standard.
This is the identical gate pass 3a found for Container Apps, so Q2d and Q3 answer symmetrically.

*Scoping caveat:* the gate governs the SWA-side `/api` proxy **linkage** only. A separately
deployed Functions app stays reachable at its own `azurewebsites.net` origin from an SWA Free front
end — but that is cross-origin and lands back in Q4's third-party-cookie territory. Neither page
states what an attempted link from Free actually does (portal block vs runtime failure) —
**unverified**.

**Q2e — Product health: NO DEPRECATION SIGNAL FOUND.** *Confidence: medium (see the caveat).*

`plans` states verbatim *"Azure Static Web Apps is available through two different plans, Free and
Standard."* Free and Standard columns carry **no retirement annotation**. A full-page search found
**no** deprecation/maintenance/"use X instead" language for SWA overall, and **no** steering toward
App Service, Container Apps, or Front Door + Blob.

The two real retirements are **narrowly scoped and both preview-only**:

- **Dedicated plan** — the third column header reads exactly *"Dedicated plan (Retired effective
  October 31st, 2025)"*. Notably the migration instruction is *"follow the Deploy your web app to
  Azure Static Web Apps guide to redeploy to a new Static Web App"* — **consolidation ONTO SWA,
  not off it.**
- **Database Connections / `/data-api/*`** — *"Retirement notice: Database Connections for Static
  Web Apps ends November 30, 2025."* Also public preview only (*"During public preview, database
  connections scale from 0 to 1 database worker"*), and `database-overview` was **revised four
  months after the end date**, so it is not a stale banner. Its replacement guidance is
  self-hosted Data API builder or *"adding explicit endpoints to Azure Functions for CRUD
  operations"* — **exactly the architecture recommended here.**

Doc freshness supports active maintenance: `apis-functions` 2026-06-02, `apis-overview` 2026-03-25,
`languages-runtimes` 2026-02-25, `plans`/`quotas`/`faq`/`key-vault-secrets` 2026-01-23.

**Why medium and not high:** the two claims asserting that the `Azure/static-web-apps` GitHub repo
carries no deprecation notice and still presents managed Functions as first-class were **REFUTED
0-3** in verification. **The doc-level answer is solid; the repo/issue-responsiveness half of this
question is an unverified gap.**

Counter-signals weighed honestly: Microsoft *did* retire a SWA sub-feature, and the recommended
replacement was self-hosted DAB on Container Apps — a **feature-level** "use X instead", reason
given as *"changes in underlying infrastructure"*; the `apis-functions` Constraints block carries a
stale runtime list (superseded above); `quotas` still shows a *"Dedicated plan (Preview)"* column
despite the retirement, and `plans` still refers to choosing *"Standard or Dedicated"*; and an open
Q&A reports managed APIs lacking .NET 10 support. **None of this is a signal against managed
Functions itself.**

**Q2f — Verdict: yes, Shape C is viable.** *Confidence: medium (synthesis).* Documented and fine:
same-origin `/api` with no CORS; managed Functions on all plans including Free; HTTP triggers are
all a REST auth API needs; 45 s and 30 MB are far above requirement; 100 GB/subscription/month
bandwidth is far above a few hundred kilobyte requests/day.

**What will actually bite, ranked:**

1. **The Azure SQL credential must be a stored secret in SWA application settings** — no managed
   identity, no Key Vault references. Microsoft's documented *"last resort"*.
2. **No timer trigger → no scheduled `sessions` cleanup.** Prune expired sessions opportunistically
   inside request handlers, or accept unbounded growth of a kilobyte-scale table.
3. **The hosting sandbox is undocumented**, so outbound-connection limits, cold-start duration and
   instance-recycling behavior are unknown for this surface. Cold start is acceptable here, so this
   is a monitoring item, not a blocker.
4. **Deployment size for the managed Functions app is an undocumented risk** (the 100 MB figure
   exists only in error strings).
5. **Feature-retirement precedent exists within SWA** (Database Connections, Dedicated plan) —
   though both were preview-only, and there is no signal against managed Functions.
6. **Azure SQL firewall reachability is UNVERIFIED** — the one item that could actually block the
   design. **Settle it with a spike before committing.**

### Q3 — Linked backends / API proxying to an external Container App ⟵ THE KEY QUESTION

*Checked 2026-09-07. Confidence: high.*

**Does SWA support linking an external Azure Container App so `/api/*` is proxied to it? Yes.**
**Is it available on Free? No — it requires the Standard plan. Unambiguously.**
*Vote 3-0, merged from 6 unanimous claims across five independent sources.*

The authoritative citation is `learn.microsoft.com/azure/static-web-apps/apis-container-apps`
(updated 2026-02-26), verbatim:

> **"The integration with Azure Container Apps requires the Static Web Apps Standard plan."**

Corroborated four ways:

- `apis-overview` (updated 2026-03-25): *"Bring your own APIs is only available in the Azure Static
  Web Apps Standard plan. Built-in, managed Azure Functions APIs are available in all Azure Static
  Web Apps plans."* Its API-options table checks **Azure Container Apps ONLY in the "Bring your
  own" column, never "Managed"** — Functions is the only service checked under both.
- The `plans` feature matrix: *"APIs via Azure Functions | Managed | Managed or Bring your own
  Functions app"* — i.e. **Free = Managed only**.
- The pricing page's feature table: *"Azure Functions | Managed (Free) | Managed or Bring your own
  (Standard)"*.
- A **Microsoft moderator** in `learn.microsoft.com/answers/questions/2201483` repeats the Standard
  requirement.

Verifiers ran adversarial searches for Free-tier linked-backend **successes** and found none — only
failure reports.

> **Citation discipline:** the `plans` matrix names only *"Bring your own Functions app"* and has
> **no linked-backends / Container Apps row at all**. That page alone does not settle it.
> **Cite `apis-container-apps`, not the pricing/plans Functions row, for the Container Apps tier
> gate.**

**Is there any other documented way to get same-origin `/api/*` on Free? No — not via SWA config.**
*(3-0 on the rewrite and API-route-rule constraints; 2-1 on the broader "no proxy option anywhere"
framing, since the intro bullet list is not exhaustive — but a full-page fetch confirmed the
conclusion.)*

`configuration` (updated 2026-03-25), routes rule-property table, `rewrite`: *"Defines the file or
path returned from the request… Rewrite rules don't change the browser's location. **Values must be
relative to the root of the app.**"* `apis-overview` "API constraints": *"The API route prefix must
be `/api`"* and *"Route rules for APIs only support redirects and securing routes with roles."*

The only external-origin destination in a route rule is `redirect`, which **changes the browser
location and therefore defeats same-origin cookies.** No `proxy`, `backendUri`, or external-origin
property exists anywhere in the schema. The deprecated `routes.json` has no proxy feature either.

Two purported counter-sources were chased and dismissed: `Azure/static-web-apps#65` is an **open
feature request to add proxy support** (affirmative evidence the capability is absent), and `#803`
concerns internal wildcard rewrites only. A search summary claiming "external URL rewrite works"
had no locatable source text and was **judged confabulation**.

Two labeled residuals: this is **documented behavior, not an executed test** (the docs state the
constraint but not the runtime failure mode); and an **external reverse proxy** (Front Door /
Application Gateway) could still produce same-origin `/api` on a Free SWA, but it costs money and
SWA's own `forwardingGateway` block is **itself Standard-only** — not a $0 workaround.

> **Note:** managed Functions (Q2) are the answer to "same-origin `/api` on Free" — just not via
> *proxying to an external backend*, which is what this question asked.

**What Standard buys, and its constraints.** *(3-0.)* The linked-backend mechanism delivers **true
same-origin** `/api/*` — a **server-side proxy**, so the browser only ever sees the
`azurestaticapps.net` origin and the cookie is **first-party**. `apis-container-apps`:

> *"any requests to your static web app with a route that starts with `/api` are proxied to the
> same route on the container app… The endpoint on the container app **must have the `/api`
> prefix**, since Static Web Apps matches requests made to `/api` and proxies the entire path to
> the linked resource."*

Documented constraints: **one backend *type* per environment**; one container app links to one
static web app at a time; **`/api` prefix fixed**; **HTTP only** (no WebSocket); **45-second**
maximum request duration; **network-isolated backends unsupported**; **not supported on
pull-request/preview environments**; and linking **auto-installs an identity provider named "Azure
Static Web Apps (Linked)"** on the container app so it accepts only SWA-proxied traffic — that is
how SWA↔backend auth works.

**Community-grade and UNCONFIRMED for linked backends specifically** (Microsoft Q&A): the SWA proxy
has been reported to **drop `Set-Cookie` headers whose `Expires` is already past**, and to **drop
duplicate `Set-Cookie` headers**. Directly relevant to **session logout** — **test rather than
assume** if Standard is ever chosen.

**Standard tier cost: $9.00 per app per month, flat at this scale.** *(3-0, merged from 5 claims:
two independent Retail Prices API pulls, the quotas doc, and the pricing page's units.)*

The public pricing page **serves `$-` placeholders to automated fetchers** (reproduced on `en-us`
and `en-in`), so figures come from the **Azure Retail Prices API** —
`api-version=2023-01-01-preview`, `currencyCode=USD`,
`$filter=contains(productName,'Static Web App')`, re-run live 2026-09-07: `Count=72`,
`NextPageLink=null`, every row `skuName='Standard'`.

```
armRegionName=eastus2 · location=US East 2 · meterName='Standard App'
retailPrice=9.0 · unitOfMeasure=1/Month · effectiveStartDate=2021-05-01
```

`centralus` and `westus2` are also `9.0 / 1 Month`. Bandwidth is tiered under one meter:
**$0.00/GB at `tierMinimumUnits` 0**, **$0.20/GB at 100** — corroborated by quotas
(*"Overage bandwidth | Unavailable | $0.20 per GB"*).

Three qualifications on "flat": an **optional "Standard Azure Front Door Add-on"** meter exists at
**$0.024/hour (~$17.52/mo)** and must stay **off**; billing is metered hourly on 730 hours, so a
partial month **prorates**; and the meter counts **per app** (and per Standard environment).
Non-US regions differ: **$9.90** `israelcentral`/`qatarcentral`/`mexicocentral`, **$10.80**
`indonesiacentral`/`malaysiawest`, **$12.60** `chilecentral`.

**No Free-tier SWA meter exists in the catalog at all** (0 rows with `skuName 'Free'`), while 50
other services do publish Free SKUs for `eastus` — so the absence is **meaningful rather than an
API coverage gap**, consistent with Free carrying no metered charge and no overage meter.

### Q4 — The cross-origin cookie consequence

**MOOT, and only partially verified. Do not treat this section as an answer.**

Q2's outcome means every surviving shape is same-origin, so the third-party-cookie problem never
arises. Accordingly the verification budget went elsewhere. **What was verified** is the Chrome
half, reported in §3: Chrome is maintaining third-party cookies, and **Related Website Sets is
being removed**, so RWS was never a viable workaround for a cross-domain session.

**What was NOT verified, and must be researched in full if a cross-origin design is ever
revisited:** the spec-level `SameSite=Lax` cross-site rule; the eTLD+1 / schemeful same-site
definition and whether `azurestaticapps.net` and `azurecontainerapps.io` are separate Public Suffix
List entries; **Safari/ITP**; **Firefox Total Cookie Protection**; Edge and Brave defaults; the
reliability verdict on `SameSite=None`; credentialed-CORS configuration and ACA ingress CORS/cookie
behavior; the token-in-header trade-off; and the load-bearing sub-question **"does ACA Consumption
support custom domains with free managed TLS"**.

### Q5 — Transactional email for password reset

*Pass 3c, targeted fetches, checked 2026-09-07, USD.*

**Verdict: yes — two genuinely viable options, neither requiring domain ownership.**
**Recommended: Azure Communication Services Email with an Azure-managed domain, at ~$0.005/month.**
Not literally $0, but half a cent, and it stays inside Azure/Bicep/`azd` with no third-party
account and no DNS.

**ACS Email pricing** (`communication-services/concepts/email-pricing`, updated 2026-03-25):

| Email Send | Data Transferred |
| --- | --- |
| **$0.00025/email** | **$0.00012/MB** |

At 20 emails/month of a few KB each: **20 × $0.00025 = $0.005/month**, data transfer negligible.
**Purely per-message — no fixed monthly resource charge**, and `add-azure-managed-domains` states
*"There's no charge for provisioning email domains."* **No free allowance is documented**, so this
is pay-as-you-go from the first message, not a free tier — nothing to be perpetual or promotional.

**The Azure-managed domain is still available with no DNS setup.** One-click *"Add a free Azure
subdomain"*, or `az communication email domain create --domain-name AzureManagedDomain
--domain-management AzureManaged`. Pros per Microsoft's own table: *"Setup is quick & easy"*,
*"No domain verification required"*. **Sender authentication is handled for you** — *"Azure
Communication Services automatically configures the required email authentication protocols."*

**Its documented cons, verbatim** — read these before committing:

> *"Sender domain isn't personalized and can't be changed"* · *"Sender usernames can't be
> personalized"* · *"**Very limited sending volume**"* · *"User Engagement Tracking can't be
> enabled"*

**And the hard rate limits** (`service-limits`, updated 2026-03-05) — note these are **per
subscription**, and **higher limits are NOT available** for managed domains:

| Operation | Timeframe | Limit | Higher limits available |
| --- | --- | --- | --- |
| Send Email | 1 min | **5** | **No** |
| Send Email | 60 min | **10** | **No** |

Microsoft is explicit: *"Higher quotas are only available for verified custom domains, not
Azure-managed domains."* Also: 50 recipients per email, 10 MB total request size.

**Fit assessment:** 10 emails/hour against a budget of <20 emails/**month** is comfortable. The
failure mode is a **burst** — 6 password resets in one minute returns `429`, and the ceiling
**cannot be raised** without moving to a custom verified domain. At ~10 users that is acceptable;
handle `429` with a "try again shortly" message rather than a stack trace.

**Deliverability: the real caveat, and I could not confirm it from docs.** SPF/DKIM are
auto-configured, but the sender is an unchangeable `donotreply@<guid>.azurecomm.net`. **Whether
mail from a managed domain reliably reaches the Gmail/Outlook inbox rather than spam is not
addressed in Microsoft's documentation** — and Microsoft's own *"Very limited sending volume"*
framing positions managed domains as a quick-start convenience rather than a production sender.
Treat inbox placement as **unverified; test with real Gmail and Outlook accounts before relying on
it for password reset**, which is a flow where a spam-foldered message means a locked-out user.

**Alternatives at this volume:**

| Option | Free allowance | Perpetual? | Domain ownership needed? | Catch |
| --- | --- | --- | --- | --- |
| **ACS + managed domain** | none (≈$0.005/mo) | n/a — PAYG | **No** | 10/hr hard cap, unchangeable GUID sender, deliverability unverified |
| **Brevo** | **300/day** | Perpetual | **No** — verify a single sender address by 6-digit code | Deliverability suffers unauthenticated; Gmail/Yahoo/Microsoft sender rules push you toward domain auth anyway |
| Resend | 3,000/mo, 100/day | Perpetual | **Yes** — *"You must add and verify at least one domain to send emails with Resend"* | Disqualified without a domain |
| **SendGrid** | **Retired** | — | — | Free Email API **retired**; sending **paused** for free accounts after a 60-day transition from 2025-05-27 |

**Recommendation: ACS with an Azure-managed domain**, because it keeps the whole stack in one
Bicep/`azd` deployment with no third-party account, no DNS, and no new credential to rotate — for
half a cent a month. **Runner-up: Brevo's perpetual 300/day free plan**, which is the fallback if
`azurecomm.net` mail lands in spam. Note that Brevo's own docs point out Gmail/Yahoo/Microsoft
sender requirements make domain authentication effectively necessary for good deliverability, so
"no domain needed" is true for *sending* and weaker for *arriving*. **If you ever register a domain
for the app, revisit this** — a verified custom domain fixes both the ACS rate ceiling and the
deliverability question at once.

*Sources for Brevo's free-plan allowance and sender-verification mechanics are vendor docs and
secondary review sites rather than a single primary pricing fetch — **treat the 300/day figure as
vendor-grade, not verified**, and confirm on signup.*

---

## 5. Contradictions & Caveats

**NO CONTRADICTIONS with passes 1, 2 or 3a.** Passes 1 and 2 (ACA free grant, GHCR instead of ACR,
Azure SQL free offer) are **untouched and uncontradicted**. Pass 3b does not contradict pass 3a
either: the BYO-Functions Standard gate is the **same** gate pass 3a found for Container Apps, and
`apis-overview`'s *"Built-in, managed Azure Functions APIs are available in all Azure Static Web
Apps plans"* is what makes managed Functions **the way around** the $9/month finding rather than a
contradiction of it.

**WHAT DID CHANGE:** pass 3a recommended **Shape A** on the premise that same-origin required
either ACA-serves-everything or $9/month. Pass 3b found a third option that is same-origin, $0,
**and** always-warm. **Shape C supersedes that recommendation.** The original prompt's binary
framing was the thing that was wrong, not either pass.

**THREE REFUTED CLAIMS, worth understanding:**

1. *"SWA serves an integrated API same-origin under `/api` with no custom CORS rules required"* —
   voted **0-3**, not because the mechanism is false (confirmed 3-0 elsewhere) but because **that
   phrasing implied general availability, omitting the Standard-plan gate for *bring-your-own*
   backends.** Never cite same-origin `/api` as evidence that **linking a Container App** works on
   Free. It *is* correct for **managed** Functions.
2. Two claims that the **`Azure/static-web-apps` GitHub repo** carries no deprecation notice and
   still presents managed Functions as first-class — **0-3**. So repo-level product-health evidence
   is **not established**; Q2e's answer is doc-level only.
3. A claim bundling **CHIPS** availability with partitioning semantics — **1-2**. CHIPS *is* on
   Chrome's "continue to support" list, but treat it as **available-but-not-a-fix** and re-verify
   partitioning semantics against MDN before relying on any statement about it.

**A KNOWINGLY ACCEPTED DEVIATION FROM BEST PRACTICE:** storing the SQL credential as a shared
secret in app settings, which `manage-connections` ranks *"Low / Legacy default. Migrate to managed
identities or Key Vault as soon as possible."* This is the price of Shape C. **If that is
unacceptable, Shape A regains managed identity at the same $0.**

**MICROSOFT DOC INCONSISTENCIES AND STALENESS** (none affect Free-tier figures):

- `apis-functions`'s Constraints runtime list is **visibly stale** — superseded by
  `languages-runtimes` (see Q2b). **Where a doc's Constraints block is stale, assume it errs toward
  being MORE restrictive than reality, never less.**
- `plans`/pricing say Standard = **5** custom domains; `quotas` says **6**.
- `quotas` still shows a *"Dedicated plan (Preview)"* column despite the 2025-10-31 retirement, and
  `plans` still refers to choosing *"Standard or Dedicated"*.
- `plans` has **no linked-backend / Container Apps row at all** — a doc-completeness gap that makes
  `apis-container-apps` the **only** authoritative tier citation.
- Minor date discrepancy on the Database Connections retirement: a Learn Q&A thread says
  "1 November 2025"; **use the doc banner's 2025-11-30 as authoritative.**

**REGION MISMATCH.** The brief defaults to East US, but the Retail Prices API publishes **no Static
Web Apps meters for `eastus`** — SWA bills in only **18 regions**. Every $9.00 figure here is
**US East 2** (also `centralus`, `westus2`). **Do not quote it as an East US price.**

**METHOD ARTIFACT.** `azure.microsoft.com/pricing/details/app-service/static/` renders **every
monetary cell as `$-`** to automated fetchers (reproduced on `en-us` and `en-in`), so all SWA dollar
figures come from the Retail Prices API (`api-version=2023-01-01-preview`, `currencyCode=USD`,
**case-sensitive filter values**; `serviceName` is `'Azure App Service'` with `productName`
`'Static Web Apps'` — **`'Azure Static Web Apps'` returns zero rows**). Feature/quota cells on that
page are static text and render correctly. **ACS Email rates came from Microsoft Learn's
`email-pricing` doc, which renders normally** — no Retail Prices API fallback was needed there.

**MINOR DISCREPANCY IN OUR OWN EVIDENCE.** Two verifiers recorded **different `meterId`s** for the
`eastus2` "Standard App" row (`3503f67c-…` vs `03c39429-…`). Price, unit, region and effective date
agree across both pulls; **treat the `meterId` as unresolved.**

**UNCONFIRMED / COMMUNITY-GRADE, labeled:**
- SWA's proxy reportedly **dropping already-expired or duplicate `Set-Cookie` headers** (Q&A, not
  product docs — matters for logout **if Standard is ever chosen**).
- The **"immediate 404"** on bandwidth exhaustion — the *outcome* is documented, the *mechanism* is
  not.
- The **100 MB managed-Functions deployment ceiling** — error strings only.
- A Q&A report of Standard apps **mis-billing at ~$27/mo** for ~three months, silently fixed. A
  billing-bug anecdote, **not a dispute of list price**.
- **Brevo's 300/day free allowance and sender-verification flow** — vendor and secondary sources.
- **`azurecomm.net` inbox placement at Gmail/Outlook** — not addressed in Microsoft docs.

**TIME SENSITIVITY.** All reads are **2026-09-07, USD**. SWA docs were last refreshed 2026-01-23 to
2026-06-02; the $9.00 rate carries `effectiveStartDate 2021-05-01`. **Tier gating is a product
decision Microsoft can change — re-check `apis-container-apps` before any Standard purchase.**
Browser cookie policy is the most volatile item here: **Chrome's third-party-cookie position has
reversed twice and the RWS removal has already slipped from M150 to M152**, so every browser
statement is pinned to a status page updated 2026-08-14 and **must be re-checked if a cross-origin
design is ever revisited.**

---

## 6. Open Questions

1. **⚠️ BLOCKING SPIKE — can SWA managed Functions reach Azure SQL through the server firewall?**
   No Microsoft doc states the outbound IP behavior of managed Functions, or whether *"Allow Azure
   services and resources to access this server"* covers them. **This is the single unverified item
   that could invalidate the recommended architecture.** Resolve empirically in our subscription:
   deploy a trivial managed Function that opens a SQL connection with "Allow Azure services" on,
   and capture the observed outbound IP. **Requires subscription access. Do this first.**
2. **Which hosting sandbox do managed Functions run in, and what are the undocumented limits?**
   This determines whether the 600 active / 1,200 total per-instance outbound connection limit
   applies. Also undocumented: memory allocation per instance, cold-start duration, whether any
   warm-up guidance exists, and the real deployment-size ceiling. *(Runtime versions are now
   answered — see Q2b.)*
3. **Do we accept the plaintext SQL credential in SWA application settings** — Microsoft's own
   documented *"last resort"* — as the price of $0/month and same-origin simplicity? Or is that
   unacceptable enough to move to **Shape A** (also $0, regains managed identity) or pay $9/month
   for Standard + BYO Functions? **A judgment call for the maintainer, not a research question.**
4. **How do we prune the `sessions` table with no timer trigger?** Lazy pruning inside request
   handlers vs. accepting unbounded growth of a kilobyte-scale table. Related: **schema migrations
   need a plan**, since `db_datareader`/`db_datawriter` are DML-only.
5. **Does `azurecomm.net` mail actually reach the inbox?** Test password-reset delivery to real
   Gmail and Outlook accounts before shipping. If it spam-folders, switch to Brevo — or register a
   domain, which fixes the rate ceiling and deliverability together.
6. **Requires subscription access:** whether the **ACA Consumption free grant** is already partly
   consumed by other resources (only matters if we fall back to Shape A), and whether the
   **100 GB/month SWA bandwidth pool** (per subscription, not per app) is shared with any other
   Static Web App we run.
7. **Cite the OWASP CSRF guidance before writing it into the design doc** — the double-submit +
   Origin-check pattern is standard, but neither pass verified it against a primary source.

---

## 7. Sources

**Primary — Microsoft Learn, Static Web Apps**
- `https://learn.microsoft.com/en-us/azure/static-web-apps/apis-container-apps` — **the
  authoritative Container Apps tier-gate citation**
- `https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes` — **supersedes the
  stale `apis-functions` runtime list**
- `https://learn.microsoft.com/en-us/azure/static-web-apps/plans`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/quotas`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/configuration`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/key-vault-secrets`
- `https://learn.microsoft.com/en-us/azure/static-web-apps/database-overview` — the retired
  `/data-api/*` feature
- `https://learn.microsoft.com/en-us/azure/static-web-apps/faq`

**Primary — Microsoft Learn, Azure Functions & SQL**
- `https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections` — the credential
  hierarchy and client-reuse guidance
- `https://learn.microsoft.com/en-us/azure/azure-functions/functions-identity-access-azure-sql-with-managed-identity`
  — **does not cover SWA managed Functions**
- `https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale`
- `https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node`

**Primary — Microsoft Learn, Communication Services**
- `https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing`
- `https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits`
- `https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/add-azure-managed-domains`

**Primary — pricing**
- `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&currencyCode=USD&$filter=contains(productName,'Static Web App')`
- `https://azure.microsoft.com/en-us/pricing/details/app-service/static/` — monetary cells are `$-`
  placeholders to fetchers; feature/quota cells render

**Primary — browser policy**
- `https://privacysandbox.google.com/overview/status` — updated 2026-08-14
- `https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies`
- `https://groups.google.com/a/chromium.org/g/blink-dev/c/V-wPXyoruac` — Intent to Deprecate and
  Remove: Related Website Sets

**Primary — email vendors**
- `https://resend.com/pricing` · `https://resend.com/docs/dashboard/domains/introduction`
- `https://www.twilio.com/en-us/changelog/sendgrid-free-plan` — the free-plan retirement

**Forum / community-grade (labeled where used)**
- `https://learn.microsoft.com/en-us/answers/questions/2201483/` — Microsoft moderator confirms the
  Standard requirement
- `https://github.com/Azure/static-web-apps/issues/65` — **open** feature request for proxy support
- `https://github.com/Azure/static-web-apps/issues/1133` — **open** feature request for CRON jobs
- `https://github.com/Azure/static-web-apps/issues/88` — **open** feature request for managed
  identity
- `https://learn.microsoft.com/en-us/answers/questions/1631839/` — the 100 MB error-string figure
