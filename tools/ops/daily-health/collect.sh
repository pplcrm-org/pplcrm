#!/bin/bash
# Gathers production facts for the daily pplCRM health report and prints them as markdown.
# It deliberately never aborts because one source failed: every section records its own
# failure text so the report can say "unavailable" instead of guessing. Runs under the
# macOS system bash (3.2): no associative arrays, no mapfile.
set -u

RG="${PPLCRM_AZ_RG:-pplcrm-cad-prod}"
PG_SERVER="${PPLCRM_PG_SERVER:-pplcrm-pg}"
GH_REPO="${PPLCRM_GH_REPO:-pplcrm-org/pplcrm}"
API="${PPLCRM_API_URL:-https://api.pplcrm.com}"
APP_URL="${PPLCRM_APP_URL:-https://app.pplcrm.com/}"
GO_URL="${PPLCRM_GO_URL:-https://go.pplcrm.com/}"
HISTORY="${PPLCRM_OPS_HISTORY:-$HOME/pplcrm-ops/history.tsv}"

# with_timeout SECONDS command args...  — perl's alarm survives exec, so the command is
# killed by SIGALRM when the time runs out. macOS ships no `timeout` binary.
with_timeout() { perl -e 'alarm shift @ARGV; exec @ARGV' "$@"; }

section() { printf '\n## %s\n' "$1"; }
oneline() { tr '\n' ' ' | head -c 300; }

printf '# pplCRM production facts — %s\n' "$(date '+%Y-%m-%d %H:%M %Z')"

# ------------------------------------------------------------------ HTTP endpoints
section "HTTP endpoints (expect 200; the /healthz body carries the deployed build SHA)"
probe() {
  local url=$1 body meta code secs snippet
  body=$(mktemp)
  meta=$(curl -sS -m 20 -o "$body" -w '%{http_code} %{time_total}' "$url" 2>&1)
  code=${meta%% *}
  secs=${meta##* }
  if [[ "$code" =~ ^[0-9]{3}$ && "$code" != 000 ]]; then
    if head -c 1 "$body" | grep -q '<'; then snippet="(html page)"; else snippet=$(head -c 200 "$body" | tr '\n' ' '); fi
    printf -- '- %s → HTTP %s in %ss :: %s\n' "$url" "$code" "$secs" "$snippet"
  else
    printf -- '- %s → REQUEST FAILED :: %s\n' "$url" "$(printf '%s' "$meta" | oneline)"
  fi
  rm -f "$body"
}
probe "$API/healthz"
probe "$API/healthz/worker"
probe "$APP_URL"
probe "$GO_URL"
if [ -n "${FORMS_PROBE_URL:-}" ]; then probe "$FORMS_PROBE_URL"; fi

# ------------------------------------------------------------------ GitHub Actions
section "GitHub Actions — $GH_REPO"
SINCE=$(date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ')
if deploy=$(with_timeout 45 gh run list -R "$GH_REPO" --workflow deploy.yml --limit 1 \
      --json status,conclusion,createdAt,headSha,displayTitle 2>&1); then
  printf '%s' "$deploy" | jq -r '.[] | "- latest deploy: \(.status)/\(.conclusion // "-") at \(.createdAt), commit \(.headSha[0:8]) — \(.displayTitle[0:70])"' 2>/dev/null \
    || printf -- '- latest deploy: could not parse: %s\n' "$(printf '%s' "$deploy" | oneline)"
else
  printf -- '- GITHUB UNAVAILABLE (deploy lookup): %s\n' "$(printf '%s' "$deploy" | oneline)"
fi
if runs=$(with_timeout 45 gh run list -R "$GH_REPO" --limit 40 --json name,status,conclusion,createdAt,headSha 2>&1); then
  printf '%s' "$runs" | jq -r --arg since "$SINCE" '
      [.[] | select(.createdAt >= $since)] as $r
      | "- workflow runs in the last 24h: \($r | length); failed: \([$r[] | select(.conclusion == "failure")] | length); still running: \([$r[] | select(.status != "completed")] | length)",
        ($r[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .status != "completed")
          | "  - \(.name): \(.status)/\(.conclusion // "-") at \(.createdAt), commit \(.headSha[0:8])")' 2>/dev/null \
    || printf -- '- run list: could not parse: %s\n' "$(printf '%s' "$runs" | oneline)"
else
  printf -- '- GITHUB UNAVAILABLE (run list): %s\n' "$(printf '%s' "$runs" | oneline)"
fi

# ------------------------------------------------------------------ Azure
section "Azure — resource group $RG"
if ! with_timeout 40 az account get-access-token --query expiresOn -o tsv >/dev/null 2>&1; then
  echo "- AZURE UNAVAILABLE: the az CLI on this Mac is not signed in (its session has expired). Fix: run \`az login\` once in a terminal; the next report will include this section."
else
  SUB=$(az account show --query id -o tsv 2>/dev/null)
  printf -- '- subscription: %s\n' "$SUB"

  printf '\n### Alerts fired in the last 24h (rule | severity | condition | state | started)\n'
  alerts=$(with_timeout 90 az rest --method get \
    --url "https://management.azure.com/subscriptions/$SUB/providers/Microsoft.AlertsManagement/alerts?api-version=2019-05-05-preview&timeRange=1d" \
    --query "value[].join(' | ', [properties.essentials.alertRule, properties.essentials.severity, properties.essentials.monitorCondition, properties.essentials.alertState, properties.essentials.startDateTime])" \
    -o tsv 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then printf -- '- ALERT QUERY FAILED: %s\n' "$(printf '%s' "$alerts" | oneline)"
  elif [ -z "$alerts" ]; then echo "- none"
  else printf '%s\n' "$alerts" | head -30 | sed 's/^/- /'; fi

  printf '\n### Container Apps (name | running status | latest ready revision | replicas min | max)\n'
  apps=$(with_timeout 90 az containerapp list -g "$RG" \
    --query "[].join(' | ', [name, to_string(properties.runningStatus), to_string(properties.latestReadyRevisionName), to_string(properties.template.scale.minReplicas), to_string(properties.template.scale.maxReplicas)])" \
    -o tsv 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then printf -- '- CONTAINER APP QUERY FAILED: %s\n' "$(printf '%s' "$apps" | oneline)"
  else
    printf '%s\n' "$apps" | grep -v '^WARNING' | sed 's/^/- /'
    for id in $(az containerapp list -g "$RG" --query "[].id" -o tsv 2>/dev/null); do
      restarts=$(with_timeout 90 az monitor metrics list --resource "$id" --metric RestartCount \
        --offset 1d --interval PT1H --aggregation Maximum \
        --query "max(value[0].timeseries[0].data[?maximum != null].maximum)" -o tsv 2>&1 | grep -v '^WARNING' | tr -d '\n')
      printf -- '- %s replica restarts, highest hourly value in 24h: %s\n' "${id##*/}" "${restarts:-0}"
    done
  fi

  printf '\n### Postgres %s — highest hourly value in 24h (alert thresholds: cpu 90%%, storage 80%%, connections 40)\n' "$PG_SERVER"
  PG_ID="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.DBforPostgreSQL/flexibleServers/$PG_SERVER"
  pg=$(with_timeout 90 az monitor metrics list --resource "$PG_ID" --metric cpu_percent storage_percent active_connections \
    --offset 1d --interval PT1H --aggregation Maximum \
    --query "value[].join(': ', [name.value, to_string(max(timeseries[0].data[?maximum != null].maximum))])" -o tsv 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then printf -- '- POSTGRES METRICS FAILED: %s\n' "$(printf '%s' "$pg" | oneline)"; else printf '%s\n' "$pg" | sed 's/^/- /'; fi
fi

# ------------------------------------------------------------------ Sentry (optional)
section "Sentry — unresolved backend issues seen in the last 24h"
if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "${SENTRY_ORG:-}" ] && [ -n "${SENTRY_PROJECT:-}" ]; then
  base="${SENTRY_API_BASE:-https://sentry.io}"
  issues=$(curl -sS -m 30 -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "$base/api/0/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?statsPeriod=24h&query=is:unresolved&sort=freq&limit=10" 2>&1)
  printf '%s' "$issues" | jq -r 'if type == "array" then (if length == 0 then "- none" else .[] | "- \(.count)× \(.title[0:100]) (last seen \(.lastSeen))" end) else "- SENTRY QUERY FAILED: \(tostring[0:300])" end' 2>/dev/null \
    || printf -- '- SENTRY QUERY FAILED: %s\n' "$(printf '%s' "$issues" | oneline)"
else
  echo "- NOT CONFIGURED: to include Sentry, put SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT in ~/.config/pplcrm-ops/env (see README.md)."
fi

# ------------------------------------------------------------------ history
section "Previous reports (date, status line) — for spotting changes only"
if [ -s "$HISTORY" ]; then tail -n 7 "$HISTORY" | sed 's/^/- /'; else echo "- none yet"; fi
