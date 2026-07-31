#!/bin/sh
#
# Run a verification command and report the single bit of information it exists
# to produce: did it pass.
#
#   tools/quiet.sh npx nx build frontend
#   tools/quiet.sh npx prettier --write file-a.ts file-b.ts
#
# Passing prints one line. Failing prints one line plus the last 40 lines of the
# captured log, which is where the actual error is. The exit code is the wrapped
# command's own, so `&&` chains and CI still behave normally.
#
# Why a script instead of appending `>log 2>&1 && echo ... || { ...; }` to each
# command: that suffix made every verification command prompt for permission.
# A permission rule such as Bash(npx prettier*) can only match a literal prefix,
# and the suffix introduced three things it cannot resolve — a "$TMPDIR"
# expansion whose value is unknown before the shell runs, `&&`/`||` segments
# that are each matched separately, and a `{ ...; }` group. Hiding all of it
# behind one fixed command name makes Bash(tools/quiet.sh*) match every time.

set -u

if [ "$#" -eq 0 ]; then
  echo "usage: tools/quiet.sh <command> [args...]" >&2
  exit 2
fi

log="${TMPDIR:-/tmp}/quiet-$$.log"

# Label: the first few tokens of the command, minus a leading "npx", stopping
# before the first argument that looks like a file path. Keeps "nx build
# frontend" and "prettier --write" intact without echoing a long file list.
label=""
count=0
for arg in "$@"; do
  if [ -z "$label" ] && [ "$arg" = "npx" ]; then continue; fi
  case "$arg" in */* | *.ts | *.js | *.json | *.html | *.css) break ;; esac
  if [ -z "$label" ]; then label="$arg"; else label="$label $arg"; fi
  count=$((count + 1))
  [ "$count" -ge 3 ] && break
done
[ -z "$label" ] && label="command"

"$@" >"$log" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "$label: success"
else
  echo "$label: FAILED (exit $rc)"
  tail -40 "$log"
fi

exit "$rc"
