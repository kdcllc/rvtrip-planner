#!/bin/bash
set -e

echo "Deploying to Azure Blob Storage Static Website..."

# Check required environment variables
if [ -z "$STORAGE_ACCOUNT_NAME" ]; then
    echo "ERROR: STORAGE_ACCOUNT_NAME environment variable is not set"
    exit 1
fi

if [ -z "$AZURE_RESOURCE_GROUP" ]; then
    echo "ERROR: AZURE_RESOURCE_GROUP environment variable is not set"
    exit 1
fi

# Get storage account key
echo "Retrieving storage account key..."
STORAGE_KEY=$(az storage account keys list \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --query "[0].value" \
    --output tsv)

if [ -z "$STORAGE_KEY" ]; then
    echo "ERROR: Failed to retrieve storage account key"
    exit 1
fi

# Clear existing content in $web container (optional - comment out if you want to keep old files)
echo "Clearing existing content..."
az storage blob delete-batch \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_KEY" \
    --source '$web' \
    --output none 2>/dev/null || true

# Upload all dist folder contents to $web container
echo "Uploading files to \$web container..."
az storage blob upload-batch \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_KEY" \
    --destination '$web' \
    --source ./dist \
    --overwrite \
    --output table

# Set cache control for HTML files (no-cache for SPA routing)
echo "Setting cache policies..."
for file in $(az storage blob list \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_KEY" \
    --container-name '$web' \
    --query "[?ends_with(name, '.html')].name" \
    --output tsv); do
    az storage blob update \
        --account-name "$STORAGE_ACCOUNT_NAME" \
        --account-key "$STORAGE_KEY" \
        --container-name '$web' \
        --name "$file" \
        --content-cache-control "no-cache" \
        --output none
done

# Set cache control for static assets (long cache)
for ext in js css woff woff2 ttf eot; do
    for file in $(az storage blob list \
        --account-name "$STORAGE_ACCOUNT_NAME" \
        --account-key "$STORAGE_KEY" \
        --container-name '$web' \
        --query "[?ends_with(name, '.$ext')].name" \
        --output tsv); do
        az storage blob update \
            --account-name "$STORAGE_ACCOUNT_NAME" \
            --account-key "$STORAGE_KEY" \
            --container-name '$web' \
            --name "$file" \
            --content-cache-control "public, max-age=31536000, immutable" \
            --output none
    done
done

# Get the static website URL
WEBSITE_URL=$(az storage account show \
    --name "$STORAGE_ACCOUNT_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "primaryEndpoints.web" \
    --output tsv)

echo ""
echo "✅ Deployment complete!"
echo "🌐 Static Website URL: $WEBSITE_URL"
echo ""
echo "Visit your application at: $WEBSITE_URL"
echo ""
