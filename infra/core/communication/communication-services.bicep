@description('Name of the Communication Services resource')
param name string

@description('Name of the Email Communication Service')
param emailServiceName string

@description('Tags to apply to resources')
param tags object = {}

@description('Customer-managed email domain (e.g. moedim.dev). Empty = no custom-domain resources.')
param customEmailDomain string = ''

@description('Sender username on the custom domain')
param customSenderUsername string = 'rvtrip'

@description('Sender display name on the custom domain')
param customSenderDisplayName string = 'RV Trip Planner'

@description('"true" (case-insensitive) and a non-empty customEmailDomain link the custom domain and use it as sender')
param useCustomEmailDomain string = 'false'

// Azure Communication Services is a global-only resource: location is always 'global'
// (never the region parameter) and dataLocation selects the data residency.
var dataLocation = 'United States'
var hasCustomDomain = !empty(customEmailDomain)
var useCustom = hasCustomDomain && toLower(useCustomEmailDomain) == 'true'

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

// Customer-managed domain: needs DNS verification records (see DNS module) before it can send.
resource customDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = if (hasCustomDomain) {
  parent: emailService
  name: hasCustomDomain ? customEmailDomain : 'none'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'CustomerManaged'
  }
}

resource senderUsername 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-04-01' = if (hasCustomDomain) {
  parent: customDomain
  name: customSenderUsername
  properties: {
    username: customSenderUsername
    displayName: customSenderDisplayName
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: name
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: useCustom ? [
      customDomain.id
    ] : [
      emailDomain.id
    ]
  }
}

// Non-secret outputs only. The connection string is read with listKeys() where it is consumed.
output name string = communicationService.name
output senderAddress string = useCustom ? '${customSenderUsername}@${customEmailDomain}' : 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
output emailServiceName string = emailService.name
output customEmailDomainName string = hasCustomDomain ? customEmailDomain : ''
output domainVerificationTxt string = hasCustomDomain ? customDomain!.properties.verificationRecords.Domain.value : ''
output dkimRecordName string = hasCustomDomain ? customDomain!.properties.verificationRecords.DKIM.name : ''
output dkimRecordValue string = hasCustomDomain ? customDomain!.properties.verificationRecords.DKIM.value : ''
output dkim2RecordName string = hasCustomDomain ? customDomain!.properties.verificationRecords.DKIM2.name : ''
output dkim2RecordValue string = hasCustomDomain ? customDomain!.properties.verificationRecords.DKIM2.value : ''
