#!/bin/bash
# Daily production health report: collect facts (collect.sh), have headless Claude turn
# them into a short plain-language report (PROMPT.md), save it under ~/pplcrm-ops, and show
# a macOS notification with the status line. Started by the launchd job that install.sh
# creates, or by hand. Runs under the macOS system bash (3.2).
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
OPS_HOME="${PPLCRM_OPS_HOME:-$HOME/pplcrm-ops}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Optional secrets and overrides (Sentry token, a forms host to probe, the model). Kept
# outside the repository on purpose.
ENV_FILE="$HOME/.config/pplcrm-ops/env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

mkdir -p "$OPS_HOME/reports" "$OPS_HOME/logs"
export PPLCRM_OPS_HISTORY="$OPS_HOME/history.tsv"

STAMP=$(date '+%Y-%m-%d_%H%M')
DAY=${STAMP%%_*}
FACTS="$OPS_HOME/reports/$STAMP.facts.md"
REPORT="$OPS_HOME/reports/$STAMP.md"
CLAUDE_ERR="$OPS_HOME/logs/claude-$STAMP.err"

echo "[$(date '+%H:%M:%S')] collecting facts → $FACTS"
"$HERE/collect.sh" > "$FACTS" 2>&1

CLAUDE_BIN=$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")

# Run from OPS_HOME, not from the repository: no project hooks, CLAUDE.md or skills load,
# and `--tools ""` means Claude can only read the facts and write text — it cannot run
# commands. The perl alarm kills the call after 10 minutes (macOS has no `timeout`).
cd "$OPS_HOME" || exit 1
echo "[$(date '+%H:%M:%S')] asking Claude ($CLAUDE_BIN)"
if { cat "$HERE/PROMPT.md"; printf '\n\n----- FACTS (collected by collect.sh) -----\n\n'; cat "$FACTS"; } \
     | perl -e 'alarm shift @ARGV; exec @ARGV' 600 "$CLAUDE_BIN" -p --tools "" --no-session-persistence \
         --output-format text ${OPS_REPORT_MODEL:+--model "$OPS_REPORT_MODEL"} > "$REPORT" 2> "$CLAUDE_ERR" \
   && grep -q '^STATUS:' "$REPORT"; then
  rm -f "$CLAUDE_ERR"
else
  {
    echo "STATUS: UNKNOWN — Claude analysis failed or returned no STATUS line; raw facts follow"
    echo
    echo "Claude stderr (last lines):"
    tail -n 8 "$CLAUDE_ERR" 2>/dev/null | sed 's/^/    /'
    if [ -s "$REPORT" ]; then echo; echo "Claude output (partial):"; sed 's/^/    /' "$REPORT"; fi
    echo
    cat "$FACTS"
  } > "$REPORT.tmp" && mv "$REPORT.tmp" "$REPORT"
fi

HEADLINE=$(grep -m1 '^STATUS:' "$REPORT")
printf '%s\t%s\n' "$DAY" "$HEADLINE" >> "$PPLCRM_OPS_HISTORY"
cp "$REPORT" "$OPS_HOME/latest.md"
find "$OPS_HOME/reports" -type f -mtime +60 -delete 2>/dev/null
find "$OPS_HOME/logs" -type f -mtime +60 -delete 2>/dev/null

# launchd user agents run inside the logged-in GUI session, so this shows a normal macOS
# banner. Double quotes and backslashes are replaced so the AppleScript literal stays valid.
SAFE=$(printf '%s' "$HEADLINE" | tr '"\\' "'/")
osascript -e "display notification \"${SAFE:0:200}\" with title \"pplCRM daily health\" subtitle \"$DAY\"" >/dev/null 2>&1 || true

echo "[$(date '+%H:%M:%S')] $HEADLINE"
echo "report: $REPORT"
