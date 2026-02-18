targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment which is used to generate a short unique hash used in all resources.')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

// Optional parameters
@description('Name of the Static Web App')
param staticWebAppName string = ''

@description('SKU for Static Web App')
@allowed([
  'Free'
  'Standard'
])
param staticWebAppSku string = 'Free'

// Tags that should be applied to all resources
var tags = {
  'azd-env-name': environmentName
}

// Organize resources in a resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// Azure Static Web App
module staticWebApp 'core/host/staticwebapp.bicep' = {
  name: 'staticwebapp'
  scope: rg
  params: {
    name: !empty(staticWebAppName) ? staticWebAppName : 'stapp-${uniqueString(rg.id)}'
    location: location
    tags: tags
    sku: staticWebAppSku
    serviceName: 'web'
  }
}

// Outputs
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name

output STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
output STATIC_WEB_APP_ID string = staticWebApp.outputs.id
output STATIC_WEB_APP_DEFAULT_HOSTNAME string = staticWebApp.outputs.defaultHostname
output STATIC_WEB_APP_URL string = 'https://${staticWebApp.outputs.defaultHostname}'
output STATIC_WEB_APP_API_KEY string = staticWebApp.outputs.apiKey
