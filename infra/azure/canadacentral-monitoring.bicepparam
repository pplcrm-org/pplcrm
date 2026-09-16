using './monitoring.bicep'

// Region 1 monitoring. Deployed by CI (.github/workflows/deploy-infra.yml) on changes under
// infra/azure/. containerAppResourceId is looked up by the workflow; opsAlertSmsNumber comes from
// the OPS_ALERT_SMS_NUMBER GitHub Actions secret. Both are passed on the command line, so neither
// appears below.
param location = 'canadacentral'
param regionCode = 'cad'
// The region-1 server was hand-built as `pplcrm-pg` (see canadacentral.bicepparam).
param pgServerName = 'pplcrm-pg'

// Ops alerting (email + Azure mobile-app push both go here; push requires this Azure account to
// be signed into the Azure mobile app).
param opsAlertEmail = 'hello@pplcrm.com'

// SMS is the primary wake-you-up channel — app push is unreliable for this subscription's
// guest (#EXT#) identity. The number is a personal mobile, so it is deliberately NOT set here:
// the workflow passes `-p opsAlertSmsNumber=` from the OPS_ALERT_SMS_NUMBER repository secret and
// refuses to deploy if that secret is missing. Do not add a `param opsAlertSmsNumber = ...` line
// back to this file — a value here would also conflict with the command-line override.
