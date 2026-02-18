@description('The name of the storage account')
param name string

@description('The location of the storage account')
param location string = resourceGroup().location

@description('Tags to apply to the storage account')
param tags object = {}

@description('The SKU of the storage account')
@allowed([
  'Standard_LRS'
  'Standard_GRS'
  'Standard_RAGRS'
  'Standard_ZRS'
  'Premium_LRS'
  'Premium_ZRS'
])
param sku string = 'Standard_LRS'

@description('The kind of storage account')
@allowed([
  'Storage'
  'StorageV2'
  'BlobStorage'
])
param kind string = 'StorageV2'

@description('Allow blob public access')
param allowBlobPublicAccess bool = true

@description('Public network access')
@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'

@description('Containers to create')
param containers array = []

@description('Enable static website hosting')
param enableStaticWebsite bool = false

@description('Static website index document')
param staticWebsiteIndexDocument string = 'index.html'

@description('Static website 404 error document path')
param staticWebsiteErrorDocument404Path string = 'index.html'

// Storage Account
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: kind
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: allowBlobPublicAccess
    publicNetworkAccess: publicNetworkAccess
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Blob Service
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: false
    }
  }
}

// Containers
resource storageContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = [for container in containers: {
  parent: blobService
  name: container.name
  properties: {
    publicAccess: container.?publicAccess ?? 'None'
  }
}]

// Static Website configuration (using deployment script)
// Note: Static website configuration is not directly supported in Bicep
// We need to use Azure CLI or REST API through a deployment script
resource staticWebsiteConfig 'Microsoft.Resources/deploymentScripts@2023-08-01' = if (enableStaticWebsite) {
  name: '${name}-static-website-config'
  location: location
  kind: 'AzureCLI'
  properties: {
    azCliVersion: '2.52.0'
    retentionInterval: 'P1D'
    timeout: 'PT5M'
    cleanupPreference: 'OnSuccess'
    environmentVariables: [
      {
        name: 'STORAGE_ACCOUNT_NAME'
        value: storage.name
      }
      {
        name: 'RESOURCE_GROUP_NAME'
        value: resourceGroup().name
      }
      {
        name: 'INDEX_DOCUMENT'
        value: staticWebsiteIndexDocument
      }
      {
        name: 'ERROR_DOCUMENT'
        value: staticWebsiteErrorDocument404Path
      }
    ]
    scriptContent: '''
      az storage blob service-properties update \
        --account-name $STORAGE_ACCOUNT_NAME \
        --static-website \
        --index-document $INDEX_DOCUMENT \
        --404-document $ERROR_DOCUMENT
      
      # Get the static website URL
      WEBSITE_URL=$(az storage account show \
        --name $STORAGE_ACCOUNT_NAME \
        --resource-group $RESOURCE_GROUP_NAME \
        --query "primaryEndpoints.web" -o tsv)
      
      echo "Static website enabled: $WEBSITE_URL"
      echo "{\"websiteUrl\": \"$WEBSITE_URL\"}" > $AZ_SCRIPTS_OUTPUT_PATH
    '''
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
}

// Managed Identity for deployment script
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (enableStaticWebsite) {
  name: '${name}-identity'
  location: location
}

// Role assignment to allow the managed identity to configure storage
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableStaticWebsite) {
  scope: storage
  name: guid(storage.id, managedIdentity.id, 'StorageBlobDataContributor')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe') // Storage Blob Data Contributor
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [
    managedIdentity
  ]
}

// Outputs
output id string = storage.id
output name string = storage.name
output primaryEndpoints object = storage.properties.primaryEndpoints
output primaryEndpointsWeb string = enableStaticWebsite ? storage.properties.primaryEndpoints.web : ''
