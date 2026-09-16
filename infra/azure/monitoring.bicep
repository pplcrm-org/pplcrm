// pplCRM per-region monitoring & alerting (PROD-CHECKLIST §9).
//
// Deliberately split from main.bicep so CI can deploy it: main.bicep bundles the Postgres server
// and therefore demands pgAdminPassword on every run, but this template only *references* the
// existing server — no DB credentials needed beyond the service principal CI already logs in with.
// Deployed automatically by .github/workflows/deploy-infra.yml on changes under infra/azure/.
//
// Two values are passed on the command line rather than committed to the .bicepparam file:
// containerAppResourceId (looked up at deploy time) and opsAlertSmsNumber (a personal mobile
// number, held in the OPS_ALERT_SMS_NUMBER GitHub Actions secret). Manual escape hatch:
//
//   az deployment group create -g pplcrm-cad-prod \
//     -f infra/azure/monitoring.bicep -p infra/azure/canadacentral-monitoring.bicepparam \
//     -p containerAppResourceId="$(az containerapp show -n pplcrm-api -g pplcrm-cad-prod --query id -o tsv)" \
//     -p opsAlertSmsNumber='<10-digit mobile number>'
//
// Alerts fan out through one action group (Azure mobile-app push + email + SMS).
//
// NOT here any more: the external availability probes. Until 2026-09-16 this template also
// provisioned App Insights standard web tests for api.pplcrm.com/healthz and /healthz/worker; they
// bill PER EXECUTION (~CAD 27/mo at 2 tests × 3 locations, half the Azure invoice) and were replaced
// by infra/uptime-edge — a Cloudflare Worker cron trigger that probes the same endpoints every
// 2 minutes for free and pages through Twilio + Postmark. Do not re-add web tests here without
// re-reading the cost note in that Worker's README.

@description('Azure region, e.g. canadacentral, eastus, westeurope.')
param location string

@description('Short region code used in resource names, e.g. cad, use, euw.')
param regionCode string

@description('Name of the EXISTING Postgres Flexible Server (provisioned by main.bicep) to attach saturation alerts to.')
param pgServerName string = 'pplcrm-pg-${regionCode}'

@description('Email that receives ops alert emails via the action group.')
param opsAlertEmail string

@description('Azure ACCOUNT email for mobile-app push (must match the account signed into the Azure mobile app — push silently no-ops otherwise). Empty = use opsAlertEmail.')
param azurePushEmail string = ''

// Never hard-code a real number in a committed .bicepparam — CI passes it from the
// OPS_ALERT_SMS_NUMBER GitHub Actions secret (see .github/workflows/deploy-infra.yml).
@description('Mobile number for SMS alerts, national format without country code (10 digits in the NANP, e.g. 4165550123). Empty = NO SMS receiver is created, which removes the primary wake-up channel; see smsAlertReceiverConfiguredOut.')
param opsAlertSmsNumber string = ''

@description('Country code for the SMS number.')
param opsAlertSmsCountryCode string = '1'

@description('Resource id of the pplcrm-api Container App (hand-created, not in bicep). Empty = skip the Container App metric alerts.')
param containerAppResourceId string = ''

@description('Alert when active Postgres connections exceed this. B1ms max_connections is ~50.')
param pgConnectionAlertThreshold int = 40

// The Postgres server lives in main.bicep; monitoring only needs its resource id for alert scopes.
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: pgServerName
}

resource opsActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'pplcrm-ops-ag'
  location: 'global'
  properties: {
    groupShortName: 'pplcrmops' // shown in SMS/push; max 12 chars
    enabled: true
    azureAppPushReceivers: [
      {
        name: 'ops-push'
        emailAddress: empty(azurePushEmail) ? opsAlertEmail : azurePushEmail
      }
    ]
    emailReceivers: [
      {
        name: 'ops-email'
        emailAddress: opsAlertEmail
        useCommonAlertSchema: true
      }
    ]
    // SMS is the wake-you-up channel: the Azure-app push receiver is unreliable for this
    // subscription's #EXT# guest identity (matching silently fails), so don't rely on push alone.
    smsReceivers: empty(opsAlertSmsNumber)
      ? []
      : [
          {
            name: 'ops-sms'
            countryCode: opsAlertSmsCountryCode
            phoneNumber: opsAlertSmsNumber
          }
        ]
  }
}

// Container App restarts / replica health. The app itself is hand-created (PROD-CHECKLIST §3), so
// its resource id is passed in rather than referenced.
resource containerAppRestartAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(containerAppResourceId)) {
  name: 'pplcrm-alert-api-restarts-${regionCode}'
  location: 'global'
  properties: {
    description: 'pplcrm-api replicas restarted more than twice in 15 minutes (crash loop?).'
    severity: 2
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'RestartCount'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: 2
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: [
      {
        actionGroupId: opsActionGroup.id
      }
    ]
  }
}

resource containerAppReplicasAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(containerAppResourceId)) {
  name: 'pplcrm-alert-api-replicas-${regionCode}'
  location: 'global'
  properties: {
    description: 'pplcrm-api has no running replicas.'
    severity: 1
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'Replicas'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Replicas'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [
      {
        actionGroupId: opsActionGroup.id
      }
    ]
  }
}

// Postgres saturation — the DB-side half of the PROD-CHECKLIST §9 alerting TODO.
var pgAlerts = [
  {
    key: 'cpu'
    metricName: 'cpu_percent'
    operator: 'GreaterThan'
    threshold: 90
    timeAggregation: 'Average'
    description: 'Postgres CPU above 90% for 15 minutes.'
  }
  {
    key: 'storage'
    metricName: 'storage_percent'
    operator: 'GreaterThan'
    threshold: 80
    timeAggregation: 'Average'
    description: 'Postgres storage above 80% — plan a size bump before it fills.'
  }
  {
    key: 'connections'
    metricName: 'active_connections'
    operator: 'GreaterThan'
    threshold: pgConnectionAlertThreshold
    timeAggregation: 'Maximum'
    description: 'Postgres active connections near max_connections (~50 on B1ms).'
  }
]

resource pgMetricAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for alert in pgAlerts: {
    name: 'pplcrm-alert-pg-${alert.key}-${regionCode}'
    location: 'global'
    properties: {
      description: alert.description
      severity: 2
      enabled: true
      scopes: [pg.id]
      evaluationFrequency: 'PT5M'
      windowSize: 'PT15M'
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: alert.metricName
            metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
            metricName: alert.metricName
            operator: alert.operator
            threshold: alert.threshold
            timeAggregation: alert.timeAggregation
          }
        ]
      }
      actions: [
        {
          actionGroupId: opsActionGroup.id
        }
      ]
    }
  }
]

// false means the action group has email + Azure-app push but NO SMS receiver. Push is unreliable
// for this subscription's guest (#EXT#) identity, so false effectively means "nothing will wake
// anyone up at 3am". Surfaced as an output so a deploy that silently drops SMS is still visible in
// the deployment result; the CI workflow additionally refuses to deploy without the number.
output smsAlertReceiverConfiguredOut bool = !empty(opsAlertSmsNumber)
