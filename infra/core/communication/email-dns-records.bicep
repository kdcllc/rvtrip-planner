// Writes ACS custom-domain verification records into an EXISTING Azure DNS zone
// (resource-group scope; the zone is never created here).
//
// WARNING: the apex (@) TXT record set is fully owned by this deployment. Any
// value NOT listed in existingApexTxtValues is removed on every provision, so
// pass every TXT value that must survive (SPF, MS=, site verifications, ...).
// MX, SPF and all other record types are left untouched.
// The _dmarc TXT record set is owned by this module when dmarcPolicy is set.
//
// TXT length: values longer than 255 chars are split into 255-char chunks
// inside a single record's value array (DNS character-string limit).

param dnsZoneName string

@description('TXT values already on the apex (@) that must be preserved.')
param existingApexTxtValues array = []

param domainVerificationTxt string
param dkimRecordName string
param dkimRecordValue string
param dkim2RecordName string
param dkim2RecordValue string
param ttl int = 3600

@allowed(['', 'none', 'quarantine', 'reject'])
@description('DMARC policy for _dmarc. Empty = no _dmarc record is managed.')
param dmarcPolicy string = ''

@description('Mailbox for DMARC aggregate reports (rua). Empty = no rua tag.')
param dmarcReportAddress string = ''

// Relative names inside the zone (strip a trailing ".<zone>" if present).
var zoneSuffix = '.${dnsZoneName}'
var dkimName = endsWith(dkimRecordName, zoneSuffix) ? substring(dkimRecordName, 0, length(dkimRecordName) - length(zoneSuffix)) : dkimRecordName
var dkim2Name = endsWith(dkim2RecordName, zoneSuffix) ? substring(dkim2RecordName, 0, length(dkim2RecordName) - length(zoneSuffix)) : dkim2RecordName

resource zone 'Microsoft.Network/dnsZones@2018-05-01' existing = {
  name: dnsZoneName
}

resource apexTxt 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: zone
  name: '@'
  properties: {
    TTL: ttl
    // One record per value (union() de-duplicates); each value split into <=255-char chunks.
    TXTRecords: map(union(existingApexTxtValues, [domainVerificationTxt]), v => {
      value: map(range(0, (length(string(v)) + 254) / 255), i => substring(string(v), i * 255, min(255, length(string(v)) - i * 255)))
    })
  }
}

resource dkimCname 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: zone
  name: dkimName
  properties: {
    TTL: ttl
    CNAMERecord: {
      cname: dkimRecordValue
    }
  }
}

resource dkim2Cname 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: zone
  name: dkim2Name
  properties: {
    TTL: ttl
    CNAMERecord: {
      cname: dkim2RecordValue
    }
  }
}

resource dmarcTxt 'Microsoft.Network/dnsZones/TXT@2018-05-01' = if (!empty(dmarcPolicy)) {
  parent: zone
  name: '_dmarc'
  properties: {
    TTL: ttl
    TXTRecords: [
      {
        value: [
          empty(dmarcReportAddress) ? 'v=DMARC1; p=${dmarcPolicy}' : 'v=DMARC1; p=${dmarcPolicy}; rua=mailto:${dmarcReportAddress}'
        ]
      }
    ]
  }
}

output apexTxtValueCount int = length(union(existingApexTxtValues, [domainVerificationTxt]))
