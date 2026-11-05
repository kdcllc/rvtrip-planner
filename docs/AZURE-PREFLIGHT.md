# Azure Preflight — Runbook

This runbook accompanies `scripts/preflight-azure.sh`. It converts **three
load-bearing, currently-unverified assumptions** in the `azure-multi-user` architecture
into facts, before the downstream implementation tasks are built on top of them.

**Task 02 waits for rows A and C of the [Results](#results) table below. Row B is
produced later, by task 04c's walking-skeleton deploy** (see
[Check B relocation](#check-b-relocation)).

The script is **read-only by default**. It never runs `az login` or `azd auth login` —
if you are not authenticated, it exits non-zero and tells you what to run yourself. Every
command that creates or modifies an Azure resource is gated behind `--apply`; without
that flag the script prints the command it *would* run instead of running it.

## Prerequisites

- Azure CLI (`az`) installed and you are logged in (`az login`, run by you, not by this
  script).
- The Azure CLI `communication` extension: `az extension add --name communication`.
  Check C with `--apply` needs it; without it `az` may auto-install it on first use, which
  can surprise you (or fail if dynamic install is disabled).
- An Azure subscription you're willing to run Check C's throwaway resources against
  (fractions of a cent — see [Check C](#check-c--azurecommnet-email-deliverability)).
- Two real inboxes you control: one Gmail, one Outlook/Microsoft address, to receive the
  Check C test message. These are passed as `--test-email-gmail` / `--test-email-outlook`
  — never hardcode them anywhere, including in this file.

## Why these three checks, and why now

All three questions below came out of three passes of external research and none is
settled. Pulling them into a preflight step — rather than discovering a failure mid
build-out, or at deploy time in task 16 — is deliberate: each one, if it fails, changes
the architecture that every other task assumes.

| Check | Question | If it fails |
|---|---|---|
| A | Does this pay-as-you-go subscription actually get the Azure SQL **free offer**? | The entire $0/month persistence design collapses; re-open Cosmos DB free tier / Table Storage research. |
| B | Can Static Web Apps **managed** Functions reach Azure SQL through the `Allow Azure services` firewall rule? | Move to **Shape A** — one Azure Container Apps container serving both SPA and API, also $0, regains managed identity. |
| C | Does mail from an Azure-managed `azurecomm.net` domain reach a real Gmail/Outlook **inbox**, not spam? | Password reset is the one flow where a spam-foldered message means a locked-out user. Switch to Brevo or a custom domain. |

## Running it

```bash
# Preview everything, no mutation at all (safe to run any time):
scripts/preflight-azure.sh --region eastus2 --resource-group rv-trip-planner-rg

# See usage:
scripts/preflight-azure.sh --help

# Actually create the Check C throwaway resources and send test mail
# (only mutating path in this script; costs fractions of a cent, cleans up after itself):
scripts/preflight-azure.sh \
  --region eastus2 \
  --test-email-gmail "<your-real-gmail-address>" \
  --test-email-outlook "<your-real-outlook-address>" \
  --apply
```

---

## Check A — Azure SQL free-offer eligibility

**Why this check exists.** The whole persistence design costs $0/month *only if* this
subscription and chosen region actually qualify for the Azure SQL Database free offer
(100,000 vCore-seconds + 32 GB data + 32 GB backup, per database per month, perpetual).
Microsoft states the offer is "available regardless of your Azure subscription type," but
free-offer eligibility is **not fully machine-queryable** — there is no API/CLI flag that
returns "yes, this will be free." Source: `_memory/work/research/azure-backend-stack-db/report.md`
§"Q3. The Azure SQL Database free offer — ANSWERED" and PLAN.md "The free offer,
confirmed."

**What the script does.**
- Prints the subscription name/state (never the subscription id).
- Lists whether the `GeneralPurpose` serverless edition exists in the target region — a
  necessary, not sufficient, condition.
- Prints the **manual portal confirmation step**, because that is the only authoritative
  signal available: create an Azure SQL DB, choose *General Purpose - Serverless*, and
  look for the **"Free offer applied!"** banner *before* creating anything.

**Command:**
```bash
az account show --query "{name:name, state:state}" -o table
az sql db list-editions --location <region> --edition GeneralPurpose -o table
```

**PASS:** the portal shows the "Free offer applied!" banner for a General Purpose
serverless database in the chosen region.

**FAIL:** the banner does not appear. **Fallback:** re-open
`_memory/work/research/azure-backend-stack-db/report.md` §6 item 3 — research Cosmos DB free tier /
Table Storage as the replacement persistence layer.

**Region lock — read before running.** The free database's region **locks permanently
per subscription** on first creation ("Once a region is selected for a free database
under a subscription, the same region applies to all free databases in that
subscription, and cannot be changed" — `_memory/work/research/azure-backend-stack-db/report.md` §6
"Region lock"). Choose the region for colocation with the app, not experimentally — you
do not get a second first choice.

---

## Check B — SWA managed Functions → Azure SQL firewall reachability

**Why this check exists.** No Microsoft documentation states whether Static Web Apps'
**managed** Functions traffic is covered by the Azure SQL `Allow Azure services and
resources to access this server` firewall rule. This is the single blocking spike named
in `_memory/work/research/azure-backend-stack-hosting-close/report.md` §2 and §6 item 1, and in
PLAN.md's "Blocking pre-implementation checks."

**What the script does.** The real connectivity test requires a *deployed* managed
Function, which does not exist at preflight time — task 02+ builds it. This script's
scope is narrower and machine-checkable today: it verifies the firewall rule itself can
be created (`az sql server firewall-rule create` with start/end `0.0.0.0`, gated behind
`--apply` and requiring `--sql-server-name` once a logical server exists), and prints the
exact follow-up test to run once the Function is live.

**Command:**
```bash
az sql server firewall-rule create \
  --resource-group <resource-group> \
  --server <sql-server-name> \
  --name AllowAllAzureServices \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

**Follow-up test (manual, post-deployment):**
1. Deploy a trivial managed Function under the Static Web App's `/api` route that opens
   a connection to the Azure SQL database and returns success/failure.
2. Call it through the SWA-fronted URL.
3. Record the outcome (and the observed outbound IP / error, if it fails).

**PASS:** the Function connects successfully with only "Allow Azure services" enabled.

**FAIL:** connection is refused or times out. **Fallback: Shape A** — one Azure
Container Apps container serving both SPA and API, also $0, which regains managed
identity. See `_memory/work/research/azure-backend-stack-hosting-close/report.md` §2 ("If the spike
fails, or the stored credential is unacceptable → Shape A").

**Security note.** "Allow Azure services" is a **broad allowlist covering any Azure
tenant**, not just this project's resources — acceptable behind password-authenticated
endpoints at this scale, but worth knowing (`_memory/work/research/azure-backend-stack-hosting-close/report.md`, same section).

---

## Check C — azurecomm.net email deliverability

**Why this check exists.** Sending from an `azurecomm.net` domain requires a provisioned
Communication Services + Email Communication Service resource, which does not exist yet
(task 02 authors it, task 16 provisions it for real) — so this check cannot be a
read-only query. Microsoft does **not document inbox placement** for Azure-managed email
domains, and password reset is the one flow where a spam-foldered message means a
locked-out user. An external research pass named this the single likeliest way this
architecture fails in production. Source:
`_memory/work/research/azure-backend-stack-hosting-close/report.md` §"Q5 — Transactional email for
password reset" and §6 item 5.

**Pulling this into preflight, not discovering it at deploy time (task 16), is
deliberate** — for the same reason.

**What the script does, entirely behind `--apply`:**
1. Creates a scratch resource group.
2. Creates a throwaway Communication Services resource and an Email Communication
   Service with an **Azure-managed domain** (instant `donotreply@<id>.azurecomm.net`
   sender, no DNS setup).
3. Sends one test message each to the Gmail and Outlook addresses you supply via
   `--test-email-gmail` / `--test-email-outlook` (never hardcoded — the script refuses
   to run this check under `--apply` without both).
4. **Deletes the scratch resource group in the same run — on success and on failure.**
   This is implemented as a `trap` on `EXIT INT TERM` in `scripts/preflight-azure.sh`
   (see `cleanup()`), not a happy-path-only delete: if any step above errors out under
   `set -euo pipefail`, the trap still fires and removes the scratch resource group
   before the script's exit code is returned. Leaving the scratch resource group behind
   is treated as an explicit script failure.

**Command:**

```bash
az group create --name <scratch-rg> --location <region>
az communication create --name <scratch-acs> --resource-group <scratch-rg> \
    --location global --data-location "United States"
az communication email create --name <scratch-email-svc> \
    --resource-group <scratch-rg> --location global --data-location "United States"
az communication email domain create --resource-group <scratch-rg> \
    --email-service-name <scratch-email-svc> --domain-name AzureManagedDomain \
    --domain-management AzureManaged --location global
az communication update --name <scratch-acs> --resource-group <scratch-rg> \
    --linked-domains "/subscriptions/<sub-id>/resourceGroups/<scratch-rg>/providers/Microsoft.Communication/emailServices/<scratch-email-svc>/domains/AzureManagedDomain"

# Send: Entra ID auth (az rest), not the connection-string HMAC scheme — bash has no
# built-in HMAC-SHA256 tooling, so the script authenticates as the signed-in az principal
# instead. The signed-in principal must hold a role that can send email on the scratch
# resource (e.g. "Contributor", or the built-in email-send data-plane role) — if the send
# call below is denied, grant that role and re-run; it is not a deliverability signal.
az rest --method post \
    --url "<endpoint-from-list-key>/emails:send?api-version=2023-03-31" \
    --resource "https://communication.azure.com" \
    --body '{"senderAddress":"donotreply@<fromSenderDomain>","recipients":{"to":[{"address":"<test-address>"}]},"content":{"subject":"...","plainText":"..."}}'

az group delete --name <scratch-rg> --yes   # always, including on failure
```

**Cost.** ACS Email is billed **per message with no fixed resource charge** — two test
messages cost a small fraction of a cent (~$0.00025/message per
`_memory/work/research/azure-backend-stack-hosting-close/report.md`). Do not let cost concerns deter
you from actually running this check.

**Manual step — check BOTH the inbox and the spam folder, at both providers:**
- Gmail: check inbox, then Spam.
- Outlook/Microsoft: check inbox, then Junk Email.

Record what you saw in the [Results](#results) table below.

**PASS:** the message lands in the inbox (not spam) at both providers.

**FAIL:** the message is spam-foldered, or never arrives, at either provider.
**Fallback:** switch to **Brevo's perpetual 300/day free plan** (a vendor-stated figure —
confirm on signup) or **register a custom domain**. Either fix resolves deliverability
*and* the unraisable **5/min · 10/hour** ACS rate cap together, since a custom domain and
Brevo both sidestep the shared managed-domain limits. See
`_memory/work/research/azure-backend-stack-hosting-close/report.md` §"Q5" and the comparison table
there.

**SEND CALL FAILED (a fourth outcome — not PASS, not FAIL):** the script prints this
distinct outcome when the `az rest ... emails:send` call itself returns non-2xx (most
likely: the signed-in principal lacks a data-plane role that can send email on the
scratch resource). **This is an API/authorization failure, not a deliverability result —
do not record it as a Check C FAIL.** Grant yourself the missing role and re-run before
recording anything in the results table below.

---

## Results

Fill in one row per check after running the script. **Task 02 waits for rows A and C;
row B is produced by task 04c.**

| Check | Date run | Outcome (PASS/FAIL) | Notes |
|---|---|---|---|
| A — Azure SQL free-offer eligibility | 2026-11-03 | PASS (operator assertion — paid subscription; not portal-verified) | Hard verification happens in task 04c: `useFreeLimit` provisioning on KDCLLC-MPN / eastus2 fails loudly if the subscription is ineligible. |
| B — SWA managed Functions → Azure SQL firewall reachability | | DEFERRED → task 04c walking-skeleton deploy | The reachability test needs a deployed managed Function, which the script itself states cannot be automated pre-deployment. |
| C — azurecomm.net email deliverability (Gmail + Outlook, inbox vs. spam) | 2026-11-04 | PASS (operator decision — delivered; Outlook to Junk) | Sends succeeded. Gmail landed in the main inbox; Outlook landed in the Junk folder. The runbook criterion (inbox at both providers) was not met at Outlook; the operator accepted delivery as success on 2026-11-04 and kept the `azurecomm.net` sender. One test message per provider; task 16 re-checks placement. History: attempt 1 (2026-11-03) aborted before sending (`LocationNotAvailableForResourceType`, ACS is global-only, no `--location` passed); fixed by passing `--location global`. |

### Check B relocation

Check B cannot be tested before a managed Function is deployed, so its gate moved. Tasks
before 04c need rows A and C only. Tasks 05 onward need row B, which task 04c (the
walking-skeleton deploy) produces — they do not start until task 04c PASSes.

### Known-unverified items

In the 2026-11-04 Check C run, the send calls succeeded using the `fromSenderDomain`-derived
sender, `api-version=2023-03-31` and the `--resource` audience, so both items below are
observed working in that run:

- **`fromSenderDomain` semantics.** The script builds the sender as
  `donotreply@<fromSenderDomain>`. That the field exists and the query path resolves is
  confirmed from the extension's local schema, but that this field (rather than
  `mailFromSenderDomain`) is the usable sender domain is an inference from RFC 5321/5322
  convention. If wrong, the send fails and is reported as a send-call failure, not a
  deliverability result.
- **`api-version=2023-03-31` and `--resource https://communication.azure.com`.** The
  data-plane API version and Entra audience used by `az rest ... emails:send` are not
  checkable offline. A mismatch surfaces as a send-call failure, not a deliverability
  result.
