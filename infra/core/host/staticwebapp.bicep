@description('The name of the Static Web App')
param name string

@description('The location of the Static Web App')
param location string

@description('Tags to apply to the Static Web App')
param tags object = {}

@description('The SKU of the Static Web App')
@allowed([
  'Free'
  'Standard'
])
param sku string = 'Free'

@description('Service name for azd tagging')
param serviceName string = 'web'

// Static Web App
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: name
  location: location
  tags: union(tags, {
    'azd-service-name': serviceName
  })
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// Outputs
output id string = staticWebApp.id
output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
