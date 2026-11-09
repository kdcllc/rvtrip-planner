#!/usr/bin/env sh
# azd postprovision: start ACS email domain verification (Domain, SPF, DKIM, DKIM2).
# Never fails the deploy: always exits 0.

DOMAIN="${AZURE_CUSTOM_EMAIL_DOMAIN:-}"
SVC="${AZURE_EMAIL_SERVICE_NAME:-}"
RG="${AZURE_RESOURCE_GROUP:-}"

if [ -z "$DOMAIN" ]; then
  echo "acs-verify-domain: skipped: no custom email domain configured - set 'azd env set CUSTOM_EMAIL_DOMAIN <domain>' and run 'azd provision' to enable"
  exit 0
fi
if ! command -v az >/dev/null 2>&1; then
  echo "acs-verify-domain: skipped: az CLI not found on PATH - install Azure CLI, run 'az login', then 'azd provision' locally to start domain verification"
  exit 0
fi
if ! az account show >/dev/null 2>&1; then
  echo "acs-verify-domain: skipped: az not logged in - run 'az login' then 'azd provision' locally to start domain verification"
  exit 0
fi
if [ -z "$SVC" ] || [ -z "$RG" ]; then
  echo "acs-verify-domain: skipped: AZURE_EMAIL_SERVICE_NAME or AZURE_RESOURCE_GROUP not set - run via 'azd provision' so outputs are exported"
  exit 0
fi
if ! az extension add --name communication --upgrade --yes >/dev/null 2>&1; then
  echo "acs-verify-domain: skipped: could not install az 'communication' extension - run 'az extension add --name communication' then 'azd provision'"
  exit 0
fi

TYPES="Domain SPF DKIM DKIM2"

status_of() {
  az communication email domain show --domain-name "$DOMAIN" --email-service-name "$SVC" \
    --resource-group "$RG" --query "verificationStates.$1.status" -o tsv 2>/dev/null
}

for t in $TYPES; do
  s=$(status_of "$t")
  if [ "$s" != "Verified" ]; then
    if ! az communication email domain initiate-verification --domain-name "$DOMAIN" \
      --email-service-name "$SVC" --resource-group "$RG" --verification-type "$t" >/dev/null 2>&1; then
      echo "acs-verify-domain: warning: could not initiate $t verification (continuing)"
    fi
  fi
done

all_ok=1
for t in $TYPES; do
  s=$(status_of "$t")
  [ -z "$s" ] && s="Unknown"
  echo "acs-verify-domain: $DOMAIN $t: $s"
  [ "$s" = "Verified" ] || all_ok=0
done

if [ "$all_ok" = "1" ]; then
  echo "acs-verify-domain: all verified. Next: azd env set USE_CUSTOM_EMAIL_DOMAIN true && azd provision"
else
  echo "acs-verify-domain: not all verified yet - add the DNS records, wait for propagation, then re-run 'azd provision'; once all are Verified: azd env set USE_CUSTOM_EMAIL_DOMAIN true && azd provision"
fi
exit 0
