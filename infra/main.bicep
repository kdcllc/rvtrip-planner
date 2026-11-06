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

@description('Region for the SQL server. The free database offer locks its region permanently per subscription on first creation.')
param sqlLocation string = location

@description('Public origin of the app (custom domain, e.g. https://trip.example.com). Empty = the Static Web App default hostname. The API accepts state-changing requests only from this origin and uses it for password-reset links.')
param appBaseUrl string = ''

// Required secrets, no defaults: azd turns an unset variable into an empty string, which the minimum-length rule rejects.
@secure()
@minLength(1)
param sqlAdminPassword string

@secure()
@minLength(1)
param sessionSecret string

@secure()
@minLength(1)
param inviteCode string

@description('Comma-separated admin email addresses (also the access-request notification recipients)')
param adminEmails string = 'travel@kingdavidconsulting.com'

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

// Azure SQL (serverless, free offer)
module sql 'core/database/sql-server.bicep' = {
  name: 'sql'
  scope: rg
  params: {
    name: 'sql-${uniqueString(rg.id, sqlLocation)}'
    location: sqlLocation
    tags: tags
    administratorLoginPassword: sqlAdminPassword
  }
}

// Azure Communication Services + Email (global resources)
module communication 'core/communication/communication-services.bicep' = {
  name: 'communication'
  scope: rg
  params: {
    name: 'acs-${uniqueString(rg.id)}'
    emailServiceName: 'email-${uniqueString(rg.id)}'
    tags: tags
  }
}

// Static Web App application settings (the app-settings module)
module appSettings 'core/host/staticwebapp-appsettings.bicep' = {
  name: 'staticwebapp-appsettings'
  scope: rg
  params: {
    staticSiteName: staticWebApp.outputs.name
    communicationServiceName: communication.outputs.name
    sqlServerFqdn: sql.outputs.fqdn
    sqlDatabaseName: sql.outputs.databaseName
    sqlAdminLogin: sql.outputs.administratorLogin
    appBaseUrl: empty(appBaseUrl) ? 'https://${staticWebApp.outputs.defaultHostname}' : appBaseUrl
    acsSenderAddress: communication.outputs.senderAddress
    sqlAdminPassword: sqlAdminPassword
    sessionSecret: sessionSecret
    inviteCode: inviteCode
    adminEmails: adminEmails
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
output AZURE_SQL_SERVER_FQDN string = sql.outputs.fqdn
output AZURE_SQL_DATABASE_NAME string = sql.outputs.databaseName
