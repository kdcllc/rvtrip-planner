// Resource-group-scoped module: Static Web App application settings.
// Declares no outputs: nested-deployment outputs are stored in ARM deployment history.

@description('Name of the existing Static Web App')
param staticSiteName string

@description('Name of the existing Communication Services resource')
param communicationServiceName string

param sqlServerFqdn string
param sqlDatabaseName string
param sqlAdminLogin string
param appBaseUrl string
param acsSenderAddress string

@secure()
param sqlAdminPassword string
@secure()
param sessionSecret string
@secure()
param inviteCode string

resource site 'Microsoft.Web/staticSites@2023-01-01' existing = {
  name: staticSiteName
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' existing = {
  name: communicationServiceName
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    // Short timeout so a failed connect surfaces inside the 45 s request ceiling.
    SQL_CONNECTION_STRING: 'Server=tcp:${sqlServerFqdn},1433;Database=${sqlDatabaseName};User ID=${sqlAdminLogin};Password=${sqlAdminPassword};Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;'
    SESSION_SECRET: sessionSecret
    ACS_CONNECTION_STRING: acs.listKeys().primaryConnectionString
    APP_BASE_URL: appBaseUrl
    INVITE_CODE: inviteCode
    ACS_SENDER_ADDRESS: acsSenderAddress
  }
}
