# Daily production health report (runs on the operator's Mac)

A once-a-day job on the operator's MacBook that collects production facts, has headless Claude
turn them into a short plain-language report, saves the report under `~/pplcrm-ops/`, and shows
a macOS notification with the status line.

**Position in the monitoring stack.** This is the daily-review layer only. Detection and paging
stay with the Azure Monitor availability probes and the `pplcrm-ops-ag` action group (SMS,
email, app push), which run from Azure and do not depend on this Mac. If the Mac is asleep at
08:17, launchd runs the job once when it wakes; if the Mac is off all day there is simply no
report that day and nothing else is affected. Background: `.claude/skills/pplcrm-observability/SKILL.md`.

## Files

| File                                         | What it does                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collect.sh`                                 | Gathers facts and prints markdown: HTTP checks of api/app/go (+ an optional forms host), latest deploy and failed CI runs (`gh`), Azure alerts fired in the last 24 h + container app status and restarts + Postgres 24 h peaks (`az`), Sentry top issues (optional), and the previous status lines. Every source fails independently and is reported as UNAVAILABLE / FAILED / NOT CONFIGURED. |
| `PROMPT.md`                                  | The instructions given to Claude: fixed report format, GREEN/YELLOW/RED rules, "state only what the facts show".                                                                                                                                                                                                                                                                                |
| `run.sh`                                     | Runs `collect.sh`, pipes `PROMPT.md` + the facts into `claude -p --tools ""` (no tools — Claude can only read the facts and write text), saves the report, appends the status line to `history.tsv`, copies it to `latest.md`, shows the notification. Falls back to `STATUS: UNKNOWN` plus the raw facts when Claude fails.                                                                    |
| `com.pplcrm.ops-daily-health.plist.template` | The launchd job definition: 08:17 daily, output to `~/pplcrm-ops/logs/launchd.log`.                                                                                                                                                                                                                                                                                                             |
| `install.sh`                                 | Renders the template into `~/Library/LaunchAgents` and loads it. `install.sh --remove` unloads and deletes it.                                                                                                                                                                                                                                                                                  |

## Install

```bash
tools/ops/daily-health/install.sh
launchctl kickstart -k gui/$(id -u)/com.pplcrm.ops-daily-health   # run it once right now
cat ~/pplcrm-ops/latest.md
```

Prerequisites on this Mac: `claude` signed in, `gh auth login` done, `az login` done, `jq`
(ships with macOS). The `az` session expires periodically; the report then shows an
"AZURE UNAVAILABLE" data gap until you run `az login` again — nothing else breaks.

## Output

- `~/pplcrm-ops/latest.md` — the newest report.
- `~/pplcrm-ops/reports/<date>_<time>.md` and `.facts.md` — each report and its raw facts, kept 60 days.
- `~/pplcrm-ops/history.tsv` — one status line per run.
- `~/pplcrm-ops/logs/launchd.log` — stdout/stderr of every launchd-started run.

## Optional settings — `~/.config/pplcrm-ops/env`

Sourced by `run.sh` when present. Deliberately outside the repository.

```bash
SENTRY_AUTH_TOKEN=...                          # with the next two: adds the Sentry section
SENTRY_ORG=...
SENTRY_PROJECT=...
FORMS_PROBE_URL=https://<org>.pplforms.com/    # adds one tenant forms host to the HTTP checks
OPS_REPORT_MODEL=claude-sonnet-5               # a cheaper model for the write-up; default = the CLI default
PPLCRM_OPS_HOME=/some/other/dir                # move the output directory
```

## Change the time / uninstall

Edit `Hour` / `Minute` in the template and re-run `install.sh`. Remove with `install.sh --remove`.

## Cost and limits

One headless Claude call per day, with no tools. A report is only produced while the Mac is
awake; this is not a substitute for the Azure probes. Log Analytics error counts are not
included yet — the container app's log destination is not described anywhere in the repo.
