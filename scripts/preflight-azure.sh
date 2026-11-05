#!/usr/bin/env bash
#
# preflight-azure.sh — verify the three unproven assumptions the azure-multi-user
# architecture is built on, before the downstream tasks are implemented.
#
# See docs/AZURE-PREFLIGHT.md for the full explanation, PASS/FAIL criteria, and
# fallbacks for each check. This header is a summary only.
#
#   Check A — does this subscription get the Azure SQL free offer in the chosen region?
#   Check B — can Static Web Apps managed Functions reach Azure SQL through the
#             "Allow Azure services" firewall rule?
#   Check C — does mail from an azurecomm.net domain reach a real Gmail/Outlook inbox?
#
# This script is READ-ONLY BY DEFAULT. Every command that creates or modifies an
# Azure resource is gated behind --apply; without it, the command is printed, not run.
# This script NEVER runs `az login` or `azd auth login` — if you are not authenticated,
# it exits non-zero and tells you what to run yourself.
#
# Usage:
#   scripts/preflight-azure.sh [--region <name>] [--resource-group <name>]
#                               [--sql-server-name <name>]
#                               [--test-email-gmail <addr>] [--test-email-outlook <addr>]
#                               [--apply] [--skip-check-c] [-h|--help]
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults (no subscription id, tenant id, or secret is ever hardcoded here)
# ---------------------------------------------------------------------------
REGION="eastus2"
RESOURCE_GROUP="rv-trip-planner-rg"
SQL_SERVER_NAME=""
TEST_EMAIL_GMAIL=""
TEST_EMAIL_OUTLOOK=""
APPLY=0
SKIP_CHECK_C=0

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
${SCRIPT_NAME} — Azure preflight for the azure-multi-user architecture.

Verifies three load-bearing, previously-unverified assumptions before any
implementation task depends on them:

  Check A  Azure SQL free-offer eligibility for this subscription/region.
  Check B  "Allow Azure services" firewall rule creation (SWA managed Functions
           -> Azure SQL reachability; the connectivity test itself needs a
           deployed Function and is documented, not automated, by this script).
  Check C  azurecomm.net email deliverability to a real Gmail and Outlook inbox
           (throwaway Communication Services resources, --apply only).

USAGE:
  ${SCRIPT_NAME} [OPTIONS]

OPTIONS:
  --region <name>              Azure region to check (default: ${REGION}).
                                NOTE: the free database's region locks permanently
                                per subscription on first creation. Choose deliberately.
  --resource-group <name>      Resource group to inspect/use for Checks A and B
                                (default: ${RESOURCE_GROUP}). Not created by this
                                script; Check A/B mutations only run if it already
                                exists and --apply is given.
  --sql-server-name <name>     Existing Azure SQL logical server to test the
                                firewall rule against (Check B). If omitted, Check B
                                only prints the command it would run.
  --test-email-gmail <addr>    Gmail address to send the Check C test message to.
                                Required only when running Check C with --apply.
  --test-email-outlook <addr>  Outlook/Microsoft address to send the Check C test
                                message to. Required only when running Check C
                                with --apply.
  --apply                      Actually run mutating commands. Without this flag,
                                every mutating command is printed instead of executed.
                                Check C's scratch resources are the only resource
                                creation in this script, and only ever happen
                                behind --apply.
  --skip-check-c               Skip Check C entirely (e.g. to preview Checks A/B
                                only, or because ACS quota/rate limits are a concern
                                right now).
  -h, --help                   Print this help and exit 0.

EXIT CODES:
  0  All requested checks ran (a check reporting FAIL is still exit 0 — read the
     printed PASS/FAIL lines; this script surfaces facts, it does not gate CI).
  1  Preconditions not met (az missing, not logged in, bad arguments), Check C's
     send call failed (an API/authorization failure — NOT a deliverability result;
     the principal likely lacks a data-plane role that can send email), or Check C's
     cleanup could not confirm the scratch resource group was removed.

PREREQUISITE: Check C with --apply needs the Azure CLI 'communication' extension
(az extension add --name communication); az may otherwise auto-install it on first use.

This script never runs 'az login' or 'azd auth login'. See docs/AZURE-PREFLIGHT.md
for the full runbook, citations, and the results table to fill in after running.
EOF
}

log()  { printf '%s\n' "$*" ; }
warn() { printf 'WARN: %s\n' "$*" >&2 ; }
err()  { printf 'ERROR: %s\n' "$*" >&2 ; }

# Print a command. Run it only if --apply was given; otherwise show what *would* run.
run_or_print() {
  if [[ "${APPLY}" -eq 1 ]]; then
    log "+ $*"
    "$@"
  else
    log "[dry-run, no --apply] would run: $*"
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)
      REGION="${2:?--region requires a value}"; shift 2 ;;
    --resource-group)
      RESOURCE_GROUP="${2:?--resource-group requires a value}"; shift 2 ;;
    --sql-server-name)
      SQL_SERVER_NAME="${2:?--sql-server-name requires a value}"; shift 2 ;;
    --test-email-gmail)
      TEST_EMAIL_GMAIL="${2:?--test-email-gmail requires a value}"; shift 2 ;;
    --test-email-outlook)
      TEST_EMAIL_OUTLOOK="${2:?--test-email-outlook requires a value}"; shift 2 ;;
    --apply)
      APPLY=1; shift ;;
    --skip-check-c)
      SKIP_CHECK_C=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      err "Unknown argument: $1"
      usage
      exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Preconditions: az installed, logged in. NEVER run az login ourselves.
# ---------------------------------------------------------------------------
require_az() {
  if ! command -v az >/dev/null 2>&1; then
    err "Azure CLI ('az') is not installed. Install it, then re-run this script."
    err "See: https://learn.microsoft.com/cli/azure/install-azure-cli"
    exit 1
  fi

  if ! az account show >/dev/null 2>&1; then
    err "Not logged in to Azure CLI."
    err "Run 'az login' yourself (this script will never do it for you), then re-run:"
    err "  az login"
    err "  ${SCRIPT_NAME} $*"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Check A — Azure SQL free-offer eligibility
#
# Cited: PLAN.md "The free offer, confirmed" and "Budget notes"; and
# _memory/work/research/azure-backend-stack-db/report.md §"Q3. The Azure SQL Database free
# offer — ANSWERED" and §6 "Region lock".
#
# Free-offer eligibility per subscription/region is NOT fully machine-queryable
# as of this writing (no public API/CLI flag returns "will this be free"). This
# check therefore does two things:
#   1. Confirms the subscription is active and that the GeneralPurpose serverless
#      edition/tier exists in the target region (a necessary, not sufficient,
#      condition for the free offer).
#   2. Prints the manual portal confirmation step, because that is the only
#      authoritative signal Microsoft currently exposes.
# ---------------------------------------------------------------------------
check_a() {
  log ""
  log "=== Check A: Azure SQL free-offer eligibility (region: ${REGION}) ==="

  log "-- Subscription state (no identifiers printed):"
  az account show --query "{name:name, state:state}" -o table || {
    err "Could not query subscription state."
    return 1
  }

  log ""
  log "-- GeneralPurpose serverless edition availability in ${REGION}:"
  if az sql db list-editions \
        --location "${REGION}" \
        --edition "GeneralPurpose" \
        --query "[].{edition:editionName, serviceObjectives:serviceObjectiveOptions[].name}" \
        -o table 2>/dev/null; then
    :
  else
    warn "Could not list SQL editions for ${REGION} (API/CLI shape may have changed, or"
    warn "region name is invalid). This does not by itself mean the free offer is unavailable."
  fi

  log ""
  log "!! MANUAL STEP REQUIRED — this script cannot certify free-offer eligibility."
  log "   In the Azure portal: Create a resource -> Azure SQL -> SQL databases -> Create."
  log "   Choose 'General Purpose - Serverless' compute tier in region '${REGION}'."
  log "   Eligibility is confirmed ONLY if the portal shows the 'Free offer applied!' banner"
  log "   before you create anything. If it does not appear, this subscription/region"
  log "   combination does not get the free offer."
  log ""
  log "   PASS: banner appears."
  log "   FAIL: banner does not appear -> re-open _memory/work/research/azure-backend-stack-db/report.md"
  log "         §6 item 3 (Cosmos DB free tier / Table Storage fallback research)."
  log ""
  log "   REMINDER: the region for the free database locks PERMANENTLY per subscription"
  log "   on first creation (source: _memory/work/research/azure-backend-stack-db/report.md §6"
  log "   'Region lock'). Choose ${REGION} deliberately, not experimentally."
}

# ---------------------------------------------------------------------------
# Check B — "Allow Azure services" firewall rule / SWA managed Functions reachability
#
# Cited: PLAN.md "Firewall rule 'Allow Azure services'..."; and
# _memory/work/research/azure-backend-stack-hosting-close/report.md §2 (the blocking spike)
# and §6 item 1.
#
# The real connectivity test needs a deployed managed Function, which does not
# exist at preflight time (task 02+ build it). This script's job is narrower:
# confirm the firewall rule itself can be created against an existing SQL
# logical server, and hand back the exact follow-up test to run once the
# Function is deployed.
# ---------------------------------------------------------------------------
check_b() {
  log ""
  log "=== Check B: 'Allow Azure services' firewall rule / SWA -> Azure SQL reachability ==="

  if [[ -z "${SQL_SERVER_NAME}" ]]; then
    log "No --sql-server-name given; nothing to test yet. Once the SQL logical server"
    log "exists, re-run with --sql-server-name <name> [--apply]. The command that will run:"
    log "  az sql server firewall-rule create \\"
    log "    --resource-group ${RESOURCE_GROUP} \\"
    log "    --server <sql-server-name> \\"
    log "    --name AllowAllAzureServices \\"
    log "    --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0"
  else
    run_or_print az sql server firewall-rule create \
      --resource-group "${RESOURCE_GROUP}" \
      --server "${SQL_SERVER_NAME}" \
      --name "AllowAllAzureServices" \
      --start-ip-address "0.0.0.0" --end-ip-address "0.0.0.0"
  fi

  log ""
  log "NOTE (source: _memory/work/research/azure-backend-stack-hosting-close/report.md §"'"Allow Azure services" is a broad allowlist'"):"
  log "  this rule allowlists ANY Azure tenant's outbound traffic, not just this project's."
  log "  Acceptable behind password-authenticated endpoints at this scale, but worth knowing."
  log ""
  log "!! FOLLOW-UP TEST REQUIRED (cannot be automated pre-deployment):"
  log "   1. Deploy a trivial managed Function under the Static Web App's /api route that"
  log "      opens a connection to the Azure SQL database and returns success/failure."
  log "   2. Call it once through the SWA-fronted URL (not the Function's own host, if any)."
  log "   3. Capture the outbound IP / error observed, if the connection fails."
  log ""
  log "   PASS: the Function connects successfully with only 'Allow Azure services' enabled."
  log "   FAIL: connection is refused/times out -> fall back to Shape A (one Azure Container"
  log "         Apps container serving both SPA and API, also \$0, regains managed identity)."
  log "         See _memory/work/research/azure-backend-stack-hosting-close/report.md §2."
}

# ---------------------------------------------------------------------------
# Check C — azurecomm.net email deliverability (Gmail + Outlook inbox placement)
#
# Cited: PLAN.md "Password-reset email" and hosting-close report.md §"Q5 —
# Transactional email for password reset" and §6 item 5.
#
# Sending from an azurecomm.net domain requires a provisioned Communication
# Services + Email Communication Service resource, which does not exist yet
# (task 02 authors it, task 16 provisions it for real). Check C therefore
# cannot be a read-only query: it stands up a throwaway ACS + Email resource
# in a scratch resource group, sends one test message to each of the two
# addresses supplied on the command line, and deletes the scratch resource
# group in the same run — on success AND on failure (see cleanup() / trap
# below). This entire check only ever runs behind --apply.
#
# Cost: ACS Email is billed per message with no fixed resource charge
# (~$0.00025/email per the research report) — this throwaway costs fractions
# of a cent, not a recurring bill.
# ---------------------------------------------------------------------------
SCRATCH_RG=""
CLEANUP_DONE=0

cleanup() {
  local exit_code=$?
  if [[ "${CLEANUP_DONE}" -eq 1 ]]; then
    return
  fi
  CLEANUP_DONE=1

  if [[ -n "${SCRATCH_RG}" ]]; then
    log ""
    log "=== Cleaning up Check C scratch resource group: ${SCRATCH_RG} ==="
    log "(runs on success AND on failure — this is a trap, not a happy-path-only delete)"
    if [[ "${APPLY}" -eq 1 ]] && az group show --name "${SCRATCH_RG}" >/dev/null 2>&1; then
      if az group delete --name "${SCRATCH_RG}" --yes; then
        log "Scratch resource group ${SCRATCH_RG} deleted."
      else
        err "FAILED to delete scratch resource group ${SCRATCH_RG}."
        err "Delete it manually: az group delete --name ${SCRATCH_RG} --yes"
        exit_code=1
      fi
    else
      log "Scratch resource group ${SCRATCH_RG} already gone (nothing to clean up)."
    fi
  fi

  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

check_c() {
  log ""
  log "=== Check C: azurecomm.net email deliverability (Gmail + Outlook) ==="

  if [[ "${APPLY}" -ne 1 ]]; then
    log "Read-only preview (pass --apply to actually run Check C). Commands that would run:"
    log "  az group create --name <scratch-rg> --location ${REGION}"
    log "  az communication create --name <scratch-acs> --resource-group <scratch-rg> \\"
    log "      --location global --data-location \"United States\""
    log "  az communication email create --name <scratch-email-svc> \\"
    log "      --resource-group <scratch-rg> --location global --data-location \"United States\""
    log "  az communication email domain create --resource-group <scratch-rg> \\"
    log "      --email-service-name <scratch-email-svc> --domain-name AzureManagedDomain \\"
    log "      --domain-management AzureManaged --location global"
    log "  <send one message each to the --test-email-gmail / --test-email-outlook"
    log "   addresses via the ACS Email 'send' REST API>"
    log "  az group delete --name <scratch-rg> --yes   # always, including on failure"
    log ""
    log "PASS/FAIL criteria and the Brevo fallback are documented in docs/AZURE-PREFLIGHT.md."
    return 0
  fi

  if [[ -z "${TEST_EMAIL_GMAIL}" || -z "${TEST_EMAIL_OUTLOOK}" ]]; then
    err "Check C with --apply requires --test-email-gmail and --test-email-outlook."
    err "These are never hardcoded in this script; supply real inbox addresses you control."
    return 1
  fi

  local suffix
  suffix="$(date +%Y%m%d%H%M%S)"
  SCRATCH_RG="rv-preflight-checkc-${suffix}"
  local acs_name="rvpreflightacs${suffix}"
  local email_svc_name="rvpreflightemail${suffix}"

  log "Creating scratch resource group ${SCRATCH_RG} in ${REGION}..."
  run_or_print az group create --name "${SCRATCH_RG}" --location "${REGION}" --output none

  log "Creating scratch Communication Services resource..."
  run_or_print az communication create \
    --name "${acs_name}" \
    --resource-group "${SCRATCH_RG}" \
    --location global \
    --data-location "United States" \
    --output none

  log "Creating scratch Email Communication Service resource..."
  run_or_print az communication email create \
    --name "${email_svc_name}" \
    --resource-group "${SCRATCH_RG}" \
    --location global \
    --data-location "United States" \
    --output none

  log "Provisioning an Azure-managed email domain (instant, no DNS)..."
  run_or_print az communication email domain create \
    --resource-group "${SCRATCH_RG}" \
    --email-service-name "${email_svc_name}" \
    --domain-name "AzureManagedDomain" \
    --domain-management "AzureManaged" \
    --location global \
    --output none

  # Subscription id is resolved into a variable FIRST, then interpolated below.
  # (A previous version escaped `$(...)` inside a double-quoted string, which is
  # not command substitution — it produced a literal, unusable resource id.)
  local sub_id
  sub_id="$(az account show --query id -o tsv)"

  log "Linking the managed domain to the Communication Services resource..."
  # `az communication update --help` confirms a dedicated `--linked-domains` property
  # argument (a plain list of resource-id strings) exists — use it instead of the
  # generic `--set linkedDomains=[...]` JSON-escaping workaround.
  run_or_print az communication update \
    --name "${acs_name}" \
    --resource-group "${SCRATCH_RG}" \
    --linked-domains "/subscriptions/${sub_id}/resourceGroups/${SCRATCH_RG}/providers/Microsoft.Communication/emailServices/${email_svc_name}/domains/AzureManagedDomain" \
    --output none

  if [[ "${APPLY}" -eq 1 ]]; then
    log ""
    log "Sending one test message each to the addresses supplied on the command line..."
    log "(sender address and endpoint are read back from the scratch resource just created;"
    log " neither is ever hardcoded in this script)"

    local endpoint sender
    endpoint="$(az communication list-key --name "${acs_name}" --resource-group "${SCRATCH_RG}" \
      --query "primaryConnectionString" -o tsv 2>/dev/null | sed -n 's#.*endpoint=\([^;]*\);.*#\1#p')"
    # Strip a trailing slash from the extracted endpoint so the URL built below never
    # doubles up ("...azure.com//emails:send"), which reads as a 404, not a deliverability
    # signal, to whoever is watching.
    endpoint="${endpoint%/}"
    # Sender domain field: `az communication email domain show --help` documents only the
    # input arguments, not the two output fields ACS exposes on this resource
    # (mailFromSenderDomain, fromSenderDomain) — --help cannot settle which one is right by
    # itself. Reading the extension's local schema (azext_communication .../domain/_show.py)
    # confirms both fields exist but carries no description distinguishing them; the choice
    # below follows RFC 5321 vs 5322 convention (fromSenderDomain backs the visible "From:"
    # header address a recipient sees; mailFromSenderDomain backs the SMTP envelope/bounce
    # address) rather than a fetched confirmation. Treat this as high-confidence, not verified.
    sender="donotreply@$(az communication email domain show \
      --resource-group "${SCRATCH_RG}" --email-service-name "${email_svc_name}" \
      --domain-name "AzureManagedDomain" --query "fromSenderDomain" -o tsv 2>/dev/null)"

    local send_failed=0
    for recipient in "${TEST_EMAIL_GMAIL}" "${TEST_EMAIL_OUTLOOK}"; do
      log "  -> sending to ${recipient}"
      # Uses Entra ID auth (az rest with the ACS data-plane resource) rather than the
      # connection string's HMAC signing, which bash cannot compute without extra
      # tooling. Requires the signed-in principal to hold a role that can send email
      # (e.g. "Contributor" on the scratch resource, or the built-in Communication/
      # Email data-plane roles) — grant it manually if this call is denied.
      if ! az rest --method post \
        --url "${endpoint}/emails:send?api-version=2023-03-31" \
        --resource "https://communication.azure.com" \
        --body "{\"senderAddress\":\"${sender}\",\"recipients\":{\"to\":[{\"address\":\"${recipient}\"}]},\"content\":{\"subject\":\"RV Trip Planner preflight test\",\"plainText\":\"This is a Check C deliverability test. Safe to ignore/delete.\"}}" \
        --output none; then
        err "Send to ${recipient} failed (az rest returned a non-zero/non-2xx result)."
        send_failed=1
      fi
    done

    if [[ "${send_failed}" -eq 1 ]]; then
      log ""
      log "!! SEND CALL FAILED — this is an API/authorization failure, NOT a Check C"
      log "   deliverability result. Do NOT record Check C as FAIL from this run."
      log "   Most likely cause: the signed-in principal lacks a data-plane role that can"
      log "   send email on the scratch Communication Services resource. Grant yourself"
      log "   'Contributor' (or the built-in email-send data-plane role) on the scratch"
      log "   resource group, then re-run with --apply before recording any outcome."
      log "   Outcome to record for this run: 'send call failed' -> fix auth and re-run."
      return 1
    fi
  fi

  log ""
  log "!! MANUAL STEP REQUIRED: check BOTH the inbox AND the spam folder at:"
  log "     ${TEST_EMAIL_GMAIL}"
  log "     ${TEST_EMAIL_OUTLOOK}"
  log "   Microsoft does not document inbox placement for azurecomm.net managed domains."
  log "   Record the outcome in docs/AZURE-PREFLIGHT.md's results table."
  log ""
  log "   PASS: message lands in the inbox (not spam) at both providers."
  log "   FAIL: message is spam-foldered or never arrives at either provider ->"
  log "         switch to Brevo's perpetual 300/day free plan, or register a custom"
  log "         domain (fixes deliverability and the unraisable 5/min·10/hour ACS rate"
  log "         cap together). See _memory/work/research/azure-backend-stack-hosting-close/report.md"
  log "         'Q5 — Transactional email for password reset'."
  log ""
  log "The scratch resource group will be deleted now (or on any failure above/below —"
  log "this is guaranteed by the EXIT/INT/TERM trap, not by reaching this line)."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  require_az "$@"

  check_a
  check_b

  if [[ "${SKIP_CHECK_C}" -eq 1 ]]; then
    log ""
    log "=== Check C skipped (--skip-check-c) ==="
  else
    check_c
  fi

  log ""
  log "=== Preflight complete ==="
  log "Fill in the results table in docs/AZURE-PREFLIGHT.md with today's date, the"
  log "PASS/FAIL outcome, and notes for Checks A and C (Check B is recorded by task 04c). Task 02"
  log "waits for rows A and C."
}

main "$@"
