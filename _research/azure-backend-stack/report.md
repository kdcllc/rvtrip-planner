# Research Report: Azure backend stack — Section A (hosting) only

**Date**: 2026-09-06 · **Source prompt**: `_research/prompts/azure-backend-stack.md`

**Run:** deep-research `wf_0d8d3d8b-21e` · 107 agents, 25 sources fetched, 125 claims
extracted, 25 verified (19 confirmed / 6 refuted), 11 findings after dedup.
**Prices:** USD, Central US and East US 2, checked 2026-09-06.

> ## ⚠️ This report answers questions 1–3 and part of 5. It does not answer 4, 6–16.
>
> All 19 surviving claims are about ACA, ACR, and `azd`. Nothing survived verification on
> the database (Q6–9), the backend stack / auth / email (Q10–13), or migration and
> deployment mechanics (Q14–16), and the SWA Free tier limits (Q4) and the non-ACA rows of
> the Q3 head-to-head are also missing. Sources for those angles *were* fetched — the
> verification stage was budget-capped at 25 of 125 extracted claims and those 25 landed
> almost entirely on hosting. Those questions are **open, not answered in the negative.**

---

## 1. Summary of findings

**The triggering assumption is substantially refuted for the ACA half, and left unproven
for the ACR half.**

Azure Container Apps on the Consumption plan carries a documented, recurring free grant of
**180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million HTTP requests per subscription
per calendar month**, with no expiry language anywhere. At ~300 requests/day the request
grant is consumed at **0.45%**. Microsoft documents that a revision scaled to zero
replicas incurs *no* resource-consumption charge at all. A Consumption-only (or default v2
workload-profiles) environment carries **no fixed management fee** unless you add a
Dedicated workload profile, a private endpoint, or planned maintenance — none of which
this design needs.

And ACR is **not a technical requirement**. Microsoft Learn explicitly documents pulling
public *and private* images from GitHub Container Registry and Docker Hub via a registry
credential secret, and `azd` documents third-party registries for `host: containerapp`
services.

**So ACA + ghcr.io is plausibly a $0/month hosting floor, competitive with SWA Free.** Two
things break that: keeping a warm replica (~$10–12/month after the grant), and adding ACR
Basic (a fixed floor whose exact dollar figure did not survive verification).

**But this is arguing over pennies.** Postgres is ~$15 of the ~$16/month estimate. The
hosting question — the one this pass answered — was never where the money was. See
§6 for what to research next.

---

## 2. What was confirmed (high confidence, 3-0 votes)

### ACA Consumption free grant is real, recurring, and per-subscription

> "The following resources are free during each calendar month, per subscription: the first
> 180,000 vCPU-seconds, the first 360,000 GiB-seconds, the first 2 million HTTP requests.
> Free usage doesn't appear on your bill."
> — [Learn: ACA billing](https://learn.microsoft.com/en-us/azure/container-apps/billing) (ms.date 2025-12-09, page updated 2026-03-25)

Corroborated verbatim on the official pricing page. Scope is **per subscription**, pooled
across every app and job in it — not per app, not per environment. If the personal
subscription runs other container workloads, the grant is shared.

"Permanent" is an **inference**: no expiry language appears anywhere, and this is standard
Consumption pricing rather than an Azure free-account 12-month promo. Not a quoted
guarantee.

Also documented on the same page: only requests originating *outside* the environment are
billable, and health-probe requests are not billable.

### Scale-to-zero genuinely costs $0 in compute

> "When a revision is scaled to zero replicas, no resource consumption charges are incurred."
> — Learn: ACA billing

`minReplicas` defaults to 0. Two scoping notes:

- KEDA CPU/memory scalers **cannot** scale to zero — the app must use the default HTTP
  scale rule (it does).
- "$0 compute" excludes **Log Analytics ingestion** (enabled by default on a new
  environment, billed per GB by Azure Monitor), egress bandwidth, and any Dedicated Plan
  Management charge. A truly $0 setup needs logging deliberately minimized.

An adversarial search for "billed while scaled to zero" surfaced only the inverse complaint
— idle billing when `minReplicas > 0`.

### No fixed environment management fee on Consumption

> "You aren't billed any plan management charges unless you use a Dedicated workload
> profile in your environment." … "features such as private endpoints and planned
> maintenance are subject to a Dedicated Plan Management charge regardless of whether you
> use the Consumption or Dedicated plans."
> — Learn: ACA billing

The Microsoft Q&A case often cited as counter-evidence (~EUR 2.07/day idle) turned out to
be billing `privateendpoint` + load balancer meters — exactly the documented carve-out.

The Microsoft-recommended v2 workload-profiles environment is now the **default** and does
not force fixed-cost compute: "you aren't charged for the consumption profile if you don't
use the profile."

### Per-unit rates, region parity, and the arithmetic

Azure Retail Prices API, re-queried 2026-09-06, USD — byte-identical between `centralus`
and `eastus2` for these three meters:

| Meter | Rate | effectiveStartDate |
|---|---|---|
| Standard vCPU Active Usage | $0.000024 / vCPU-second | 2022-06-01 |
| Standard Memory Active Usage | $0.000003 / GiB-second | 2022-06-01 |
| Standard Requests | $0.40 / 1M | 2022-06-01 |

At this workload: 10,000 requests = $0.004 · 0.5 vCPU × 7,200s = $0.0864 · 1 GiB × 7,200s
= $0.0216. **A few cents/month before the grant even applies.**

Region parity holds for these three meters but **not** for all Standard-SKU meters (GPU
meters differ). The public pricing page renders rates client-side and returns `$-`
placeholders to fetchers, so the retail API is the only machine-verifiable source here.

### The warm-replica trap

`minReplicas > 0` bills continuously at idle rates — and note memory idle equals memory
active:

| Config | Gross/mo | After free grant |
|---|---|---|
| 0.5 vCPU / 1 GiB always-on | $11.83 | **~$10.21** |
| 0.25 vCPU / 0.5 GiB always-on | — | ~$4.29 |
| 0.5 vCPU / 1 GiB **failing** the idle test | — | **~$31.54** |

The free grant offsets only ~$1.62 of the warm-replica bill (~14%).

Learn's idle criteria are strict: containers running, no HTTP requests, **<0.01 vCPU**, and
**<1,000 bytes/sec** network. Fail any one and vCPU moves to the *active* meter at 8× the
rate. A chatty background timer or a keepalive ping is enough to triple the bill.

**This is the decision point.** If you mitigate cold start by pinning a warm replica, ACA
stops being free and becomes comparable to the Postgres compute line.

### Cold start is documented but unquantified

> "When your container app scales to zero during periods of inactivity, the next incoming
> request triggers a *cold start*… the time-consuming process of pulling your container
> image, provisioning resources, and starting your application code."
> — [Learn: cold start](https://learn.microsoft.com/en-us/azure/container-apps/cold-start)

The doc discusses mitigation, not duration. **The "5–10 seconds" figure that appears in
search summarizations is not in that page** and must not be attributed to it.

Community-grade only ([GitHub discussion #1087](https://github.com/microsoft/azure-container-apps/discussions/1087)):
`node:18` at ~480 MB pulled in **~20 s**; `node:18-alpine` at ~140 MB in **~7 s**, from a
same-region registry. Image size is the dominant controllable term — which makes base-image
size a first-order input to the (unanswered) stack-selection question.

### ACR is not required — ghcr.io is first-party documented

> "Azure Container Apps supports: … Containers from any public or private container
> registry" … "You can deploy images hosted on private registries by providing credentials
> in the Container Apps configuration."
> — [Learn: containers](https://learn.microsoft.com/en-us/azure/container-apps/containers) (ms.date 2025-05-15)

> "In addition to Azure Container Registry (ACR), Azure Container Apps supports container
> images hosted in other registries, such as GitHub Container Registry (GHCR). This section
> shows how to deploy container images from GHCR, including public and private images."
> — [Learn: GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions) (ms.date 2025-05-14, updated 2026-05-08)

**This directly refutes the premise that choosing ACA obliges you to buy an ACR tier.**

One documented gotcha: with a non-ACR registry you must configure authentication **even if
the image is public**.

**Mechanism:** a `registries` array entry with `server` / `username` / `passwordSecretRef`
backed by a Container Apps secret. For ghcr.io, a GitHub PAT with `read:packages` scope,
set via `az containerapp registry set --server ghcr.io` or the deploy action's
`registryUsername` / `registryPassword` inputs. Operational cost: a PAT secret on the
container app that must be **rotated manually**.

*Could not confirm:* whether fine-grained PATs (vs. classic) work for ghcr.io pulls.

**Prefer GHCR over Docker Hub.** Docker Hub carries a documented reliability warning —
"Docker Hub limits the number of Docker image downloads. When the limit is reached,
containers in your app fail to start." GHCR has no comparable documented cap.

### What skipping ACR actually costs you

Narrower than assumed. Private link, geo-replication, dedicated data endpoints, content
trust, CMK, IP access rules, and untagged-manifest retention policy are all **Premium-only**
— you don't get them from ACR Basic either. The concrete Basic-tier loss is
**managed-identity (keyless) image pull** and **same-region proximity**.

Correction worth noting: Basic *can* get automated cleanup via `acr purge` as a scheduled
ACR Task (auto-purge doc updated 2026-08-29, no documented SKU restriction). It's the
built-in *retention policy feature* that's Premium-only.

On proximity, the cold-start doc recommends a registry close to the environment "or a
premium registry that features global distribution" — a carve-out that arguably covers
CDN-fronted ghcr.io. Microsoft publishes no quantified ACR-vs-ghcr.io pull-latency delta,
so this cannot be used to argue ACR Basic is required.

### azd supports third-party registries

> "Azure Developer CLI (azd) supports external third-party container registries for
> deployment. To use this feature, you need to manually authenticate to the external
> container registry before calling azd deploy."
> — [Learn: use external registry](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/use-external-registry) (ms.date 2026-01-09, updated 2026-08-28)

Three worked `azure.yaml` examples, all `host: containerapp`: pull-only, pull/tag/push, and
build/tag/push (`docker: { registry: docker.io/<username>, image: todo-api }` — "azd deploy
builds the container, tags it and pushes it"). Also `docker.imagePassthrough: true` to
reference a remote image as-is.

The binding constraint, verbatim: **"Your containerapp infra configuration must configure
credentials when pulling containers from private container registries."** azd builds and
pushes; it does *not* manage the Container App's pull credentials — those go in your Bicep
`registries`/`secrets` block.

`Azure/azure-dev` issue #3435 ("Support using a private or existing container registry") is
**closed** — it describes the 2024 state this doc supersedes.

Two caveats: the azd doc names `docker.io` only, so **azd + ghcr.io is a mechanism
inference**, not a first-party worked example. And azd's stock ACA starter templates still
provision an ACR by default — "not required" means you can opt out, not that the default
omits it.

---

## 3. What was refuted (do not carry these forward)

| Refuted claim | Vote |
|---|---|
| A new **"Environment Management Hour" meter at $0.10/hr (~$73/mo)**, effectiveStartDate 2026-09-01, applies to ACA environments | 0-3 |
| Microsoft publishes *no* quantified cold-start duration | 0-3 |
| Managed-identity registry auth is documented **only** for ACR | 1-2 |
| ACR Basic is **$0.1666/day (~$5.07/mo)**, Standard $20.29/mo, Premium $50.72/mo | 1-2 |
| ACR Basic's included storage means ~$5.07/mo is the entire bill with zero variable component | 0-3 |
| ACR has exactly three plans and **no free tier** | 1-2 |

**The first one is not settled, and it matters most.** Two verifiers independently observed
three `Environment` SKU meters in the Azure Retail Prices API — Environment Management
Hour, Environment Planned Maintenance Hour, Environment Private Endpoint, all $0.10/hr,
`effectiveStartDate` 2026-09-01 — while noting they appear on **neither Learn nor the
pricing page**. The claim lost 0-3 because it asserts scope the API doesn't state. Do not
cost ACA as if a $73/month environment fee applies; equally, **do not assume it cannot**.
This is the single thing that could invalidate the "$0 ACA" conclusion, and it went live
five days before the check date.

The ACR pricing figures failed for a mundane reason: the pricing page renders rates
client-side and served `$-` placeholders to every fetcher. The commonly circulated ~$5/month
figure is probably right, but it is **unverified** — label it as such in any cost table, or
sidestep it by choosing ghcr.io.

---

## 4. Revised hosting picture

| Option | Fixed floor | Variable at our volume | Verified? |
|---|---|---|---|
| ACA Consumption + ghcr.io, min-replicas 0 | **$0** * | pennies, inside free grant | ✅ high |
| ACA Consumption + ACR Basic, min-replicas 0 | ~$5/mo **unverified** | pennies | ⚠️ price unconfirmed |
| ACA + warm replica 0.5 vCPU / 1 GiB | ~$10.21/mo after grant | — | ✅ high |
| ACA + warm replica failing idle test | ~$31.54/mo | — | ✅ high |
| SWA Free + bundled managed Functions | $0 | — | ❌ **not researched** |
| SWA Free + separate Functions (Y1) | — | — | ❌ **not researched** |
| App Service F1 / B1 | — | — | ❌ **not researched** |

\* excludes Log Analytics ingestion, egress, and the unresolved Environment-meter question.

**Bottom line on the triggering question:** your assumption that ACA + ACR adds cost was
half right. ACR would add cost (amount unconfirmed) — but ACR is optional, and without it
ACA's floor is the same $0 as SWA Free. The container-based deployment story is therefore
*not* something you'd be paying a premium for. What you'd be paying is a cold-start
latency penalty on the first request after idle, of an undocumented duration, on top of a
fresh Postgres connection.

---

## 5. Open questions

1. **The Environment meters.** Does "Environment Management Hour" ever apply to a plain
   Consumption-only environment with no private endpoint and no planned maintenance? Cannot
   be settled from public docs — deploy a throwaway ACA environment in the actual
   subscription and watch Cost Analysis for 48–72 hours.
2. **ACR Basic's actual rate** in Central US / East US 2 — re-check via the Pricing
   Calculator or the retail API (`serviceName 'Container Registry'`). Moot if you pick
   ghcr.io.
3. **The entire database question.** Postgres is the largest projected line item (~$15 of
   ~$16). This is where the remaining cost reduction actually lives.
4. **Cold start + cold Postgres connection combined.** Is the honest framing "$0 with a
   multi-second first-request latency" or "~$11/month for a warm replica"? And in the
   latter case, does ACA still beat SWA Free + managed Functions, whose own cold-start
   behavior this pass also didn't quantify?

---

## 6. Recommended next step

**Run a second, narrower pass on section B alone** (questions 6–9). The relevant sources
were already fetched but never verified: Postgres Flexible Server pricing, the
[stop-server doc](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-stop-server),
the [Cosmos DB free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier), and
the [Azure SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql).
That last one is worth particular attention — a perpetual free vCore grant, if it still
exists on the terms Microsoft has previously published, would zero out the single biggest
line in the budget and make the entire hosting debate moot.

A third pass can then cover C and D together.

---

## 7. Sources

**Primary — Microsoft Learn / Azure:**
[ACA billing](https://learn.microsoft.com/en-us/azure/container-apps/billing) ·
[ACA structure](https://learn.microsoft.com/en-us/azure/container-apps/structure) ·
[ACA cold start](https://learn.microsoft.com/en-us/azure/container-apps/cold-start) ·
[ACA containers](https://learn.microsoft.com/en-us/azure/container-apps/containers) ·
[ACA GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions) ·
[ACA managed-identity image pull](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull) ·
[ACA scale-app](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) ·
[ACA environment](https://learn.microsoft.com/en-us/azure/container-apps/environment) ·
[workload profiles](https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview) ·
[ACR SKUs](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus) ·
[ACR auto-purge](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-auto-purge) ·
[ACR pricing](https://azure.microsoft.com/en-us/pricing/details/container-registry/) (renders `$-` to fetchers) ·
[ACA pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/) ·
[azd external registry](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/use-external-registry) ·
[azd publishing workflows](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/publishing-workflows) ·
[az containerapp registry](https://learn.microsoft.com/en-us/cli/azure/containerapp/registry) ·
[Azure Retail Prices API](https://prices.azure.com/api/retail/prices)

**Fetched for angles that were never verified — starting points for the follow-up passes:**
[SWA plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans) ·
[SWA quotas](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas) ·
[SWA APIs/Functions](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions) ·
[Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/) ·
[Functions manage connections](https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections) ·
[App Service domain + cert](https://learn.microsoft.com/en-us/azure/app-service/tutorial-secure-domain-certificate) ·
[Postgres Flexible Server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/) ·
[Postgres stop server](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-stop-server) ·
[Cosmos DB free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier) ·
[Azure SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql) ·
[ACS email pricing](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing) ·
[ACS service limits](https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits) ·
[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) ·
[@node-rs/argon2](https://www.npmjs.com/package/@node-rs/argon2)

**Community-grade (labeled as such above):**
[azure-container-apps #1087](https://github.com/microsoft/azure-container-apps/discussions/1087) (cold-start timings) ·
[azure-dev #3435](https://github.com/Azure/azure-dev/issues/3435) (closed) ·
[static-web-apps #760](https://github.com/Azure/static-web-apps/issues/760) ·
[Understanding idle usage in ACA](https://techcommunity.microsoft.com/blog/appsonazureblog/understanding-idle-usage-in-azure-container-apps/4419197)

---

## Promotion Checklist

- [x] Durable findings promoted into PLAN.md (2026-09-06) — see "Research findings" section
- [ ] README.md unchanged — nothing here affects current shipped behavior
