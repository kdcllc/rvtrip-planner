@description('Name of the Communication Services resource')
param name string

@description('Name of the Email Communication Service')
param emailServiceName string

@description('Tags to apply to resources')
param tags object = {}

// Azure Communication Services is a global-only resource: location is always 'global'
// (never the region parameter) and dataLocation selects the data residency.
var dataLocation = 'United States'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

// Azure-managed domain: free instant sender, no custom DNS.
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: name
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      emailDomain.id
    ]
  }
}

// Non-secret outputs only. The connection string is read with listKeys() where it is consumed.
output name string = communicationService.name
output senderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
