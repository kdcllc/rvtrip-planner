@description('Name of the SQL logical server (globally unique)')
param name string

@description('Region. The free database offer locks its region permanently per subscription on first creation; choose deliberately.')
param location string

@description('Tags to apply to resources')
param tags object = {}

@description('Name of the database')
param databaseName string = 'tripplanner'

@description('SQL administrator login')
param administratorLogin string = 'tripadmin'

@secure()
@description('SQL administrator password (required, supplied by the caller)')
param administratorLoginPassword string

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// General Purpose serverless, Standard-series (Gen5), free offer.
// Auto-pause is supported only on GP + vCore + Gen5. Not DTU, Business Critical or Hyperscale.
resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 4 // max vCores
  }
  properties: {
    minCapacity: json('0.5')
    // The auto-pause delay is deliberately not set: the free offer with
    // freeLimitExhaustionBehavior 'AutoPause' accepts only the service-default delay
    // (ARM error ProvisioningDisabled: "Only default value for auto pause delay is
    // allowed for Free Limit database with auto pause exhaustion behavior").
    useFreeLimit: true
    // Set EXPLICITLY. The Bicep/CLI default for this property is undocumented (the
    // auto-pause default is documented for the portal flow only), and BillOverUsage is
    // irreversible once chosen.
    freeLimitExhaustionBehavior: 'AutoPause'
    requestedBackupStorageRedundancy: 'Local'
  }
}

// Allow Azure services (0.0.0.0 - 0.0.0.0). NOTE: this allowlists ANY Azure tenant,
// not just ours, so the SQL login and password remain the real protection.
// The 0.0.0.0 range, not the rule name, grants Azure-service access.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output serverName string = sqlServer.name
output fqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
output administratorLogin string = administratorLogin
