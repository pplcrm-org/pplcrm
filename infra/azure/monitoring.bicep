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
// External synthetic probes hit the public surfaces; alerts fan out through one action group
// (Azure mobile-app push + email). /healthz returns 503 when Postgres is unreachable, so the api
// test failing means "backend or DB down" — that's the point.
//
// COST: standard web tests bill PER EXECUTION (~CAD 0.0008 each; the whole "Management and
// Governance" line on the invoice). Cost = tests × locations × executions/day, so every location
// and every frequency step is a real dollar amount: 4 tests × 5 locations × 5-min was ~CAD 141/mo.
// Current shape (~CAD 28/mo): api /healthz every 5 min (the security page promises "every few
// minutes", so this one stays fast), worker heartbeat every 15 min (its stale threshold is 20 min
// — probing faster than the signal changes buys nothing), 3 locations everywhere, and the static
// Cloudflare-hosted surfaces (app/go) off until launch via enableEdgeProbes.

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

@description('One real tenant public-forms URL to probe, e.g. https://acme.pplforms.com/. Empty = skip the forms availability test.')
param formsProbeUrl string = ''

@description('Probe https://api.pplcrm.com/healthz/worker (dead-man heartbeat for the job worker). Enable only once the backend exposes that endpoint.')
param enableWorkerProbe bool = false

@description('Probe the static Cloudflare-hosted surfaces (app.pplcrm.com, go.pplcrm.com). Off pre-launch: they only fail if Cloudflare itself is down or a Pages/Worker deploy breaks, and each test costs real money per execution. Flip to true at launch (GO-LIVE-CHECKLIST).')
param enableEdgeProbes bool = false

@description('Alert when active Postgres connections exceed this. B1ms max_connections is ~50.')
param pgConnectionAlertThreshold int = 40

// The Postgres server lives in main.bicep; monitoring only needs its resource id for alert scopes.
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: pgServerName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'pplcrm-logs-${regionCode}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'pplcrm-appinsights-${regionCode}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// The public surfaces to probe. app/go/forms/worker entries are optional (see their params).
// frequencySeconds must be 300, 600 or 900 (the only values standard web tests accept).
// alertWindow must be long enough for 2+ locations to report within it: PT5M works for a 300s
// test, but a 900s test needs PT30M or the "2 locations failing" alert can never see 2 results.
var availabilityTargets = concat(
  [
    // The one probe the security page's "every few minutes" claim rides on — keep at 300s.
    { key: 'api', url: 'https://api.pplcrm.com/healthz', frequencySeconds: 300, alertWindow: 'PT5M' }
  ],
  enableEdgeProbes
    ? [
        { key: 'app', url: 'https://app.pplcrm.com/', frequencySeconds: 900, alertWindow: 'PT30M' }
        { key: 'go', url: 'https://go.pplcrm.com/', frequencySeconds: 900, alertWindow: 'PT30M' }
      ]
    : [],
  empty(formsProbeUrl) ? [] : [{ key: 'forms', url: formsProbeUrl, frequencySeconds: 900, alertWindow: 'PT30M' }],
  // Heartbeat staleness threshold is 20 min (WORKER_HEARTBEAT_STALE_MS) — a 300s probe of a
  // 20-minute signal is pure cost. Worst-case detection: ~20 min stale + PT30M window ≈ 50 min.
  enableWorkerProbe
    ? [{ key: 'worker', url: 'https://api.pplcrm.com/healthz/worker', frequencySeconds: 900, alertWindow: 'PT30M' }]
    : []
)

// Probe agents (no Canada agent exists; nearest US + one EU for path diversity). Three, not five:
// the alerts fire on 2 simultaneous location failures, which 3 locations satisfies with the same
// noise immunity, and each extra location bills every test execution it adds.
var probeLocations = [
  { Id: 'us-va-ash-azr' } // East US
  { Id: 'us-tx-sn1-azr' } // South Central US
  { Id: 'emea-nl-ams-azr' } // West Europe
]

resource availabilityTests 'Microsoft.Insights/webtests@2022-06-15' = [
  for target in availabilityTargets: {
    name: 'pplcrm-avail-${target.key}-${regionCode}'
    location: location
    tags: {
      'hidden-link:${appInsights.id}': 'Resource' // required marker tying the test to the App Insights resource
    }
    properties: {
      SyntheticMonitorId: 'pplcrm-avail-${target.key}-${regionCode}'
      Name: 'pplcrm ${target.key} availability'
      Kind: 'standard'
      Enabled: true
      Frequency: target.frequencySeconds
      Timeout: 30
      RetryEnabled: true
      Locations: probeLocations
      Request: {
        RequestUrl: target.url
        HttpVerb: 'GET'
        ParseDependentRequests: false
      }
      ValidationRules: {
        ExpectedHttpStatusCode: 200
        SSLCheck: true
        SSLCertRemainingLifetimeCheck: 7
      }
    }
  }
]

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

resource availabilityAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for (target, i) in availabilityTargets: {
    name: 'pplcrm-alert-avail-${target.key}-${regionCode}'
    location: 'global'
    properties: {
      description: '${target.url} failed from 2+ probe locations within the alert window.'
      severity: 1
      enabled: true
      scopes: [
        availabilityTests[i].id
        appInsights.id
      ]
      evaluationFrequency: 'PT1M'
      windowSize: target.alertWindow
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
        webTestId: availabilityTests[i].id
        componentId: appInsights.id
        failedLocationCount: 2
      }
      actions: [
        {
          actionGroupId: opsActionGroup.id
        }
      ]
    }
  }
]

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

output appInsightsNameOut string = appInsights.name
output logAnalyticsNameOut string = logAnalytics.name

// false means the action group has email + Azure-app push but NO SMS receiver. Push is unreliable
// for this subscription's guest (#EXT#) identity, so false effectively means "nothing will wake
// anyone up at 3am". Surfaced as an output so a deploy that silently drops SMS is still visible in
// the deployment result; the CI workflow additionally refuses to deploy without the number.
output smsAlertReceiverConfiguredOut bool = !empty(opsAlertSmsNumber)
