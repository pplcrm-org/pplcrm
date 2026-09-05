#!/bin/bash
# Installs (or with --remove, removes) the launchd job that runs run.sh every morning.
# Usage:  tools/ops/daily-health/install.sh            # install or refresh
#         tools/ops/daily-health/install.sh --remove   # stop and delete the job
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
LABEL=com.pplcrm.ops-daily-health
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OPS_HOME="${PPLCRM_OPS_HOME:-$HOME/pplcrm-ops}"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL (reports under $OPS_HOME were left in place)"
  exit 0
fi

mkdir -p "$OPS_HOME/logs" "$HOME/Library/LaunchAgents"
chmod +x "$HERE/run.sh" "$HERE/collect.sh"
sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" -e "s|__OPS_HOME__|$OPS_HOME|g" \
  "$HERE/$LABEL.plist.template" > "$PLIST"
plutil -lint -s "$PLIST"

# bootout first so re-running this script after an edit picks up the new plist.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl print "$DOMAIN/$LABEL" | grep -E '^\s*(state|last exit code|run interval|program) ' || true
echo "installed $LABEL — runs daily at 08:17 local time"
echo "run it now:   launchctl kickstart -k $DOMAIN/$LABEL   (then read $OPS_HOME/latest.md)"
