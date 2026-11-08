#!/usr/bin/env bash
# Regression tests for scripts/check-cli-security-drift.sh (needs network and an authenticated gh).
# A hand-ported entry must name a port that is really on cli-2.0; everything else must fail closed.
#   scripts/check-cli-security-drift.test.sh
set -uo pipefail

here=$(dirname "$0")
check="$here/check-cli-security-drift.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

# expect <exit code> <description> <ported-list contents> <PRs to check>
expect() {
  local want=$1 what=$2 list=$3 prs=$4 got
  printf '%s\n' "$list" > "$work/ported.txt"
  DRIFT_PORTED_FILE="$work/ported.txt" SECURITY_PRS="$prs" "$check" > "$work/out.txt" 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "PASS  $what (exit $got)"
  else
    echo "FAIL  $what: wanted exit $want, got $got"; sed 's/^/        /' "$work/out.txt"
    failures=$((failures + 1))
  fi
}

# 1116 and 1091 are merged main PRs that are not on cli-2.0 (the check treats any PR as security here).
expect 1 "a PR with no ported entry and no ancestry is missing" "" "1116"
expect 1 "an entry naming a commit that is not on cli-2.0 fails" "1116 0123456789abcdef0123456789abcdef01234567" "1116"
expect 1 "an entry naming a PR that is not merged fails (#1138 never merged)" "1116 #1138" "1116"
expect 1 "an entry naming a PR merged into main, not cli-2.0, fails (#1091)" "1116 #1091" "1116"
expect 1 "an entry that is not a commit or PR reference fails" "1116 garbage" "1116"
expect 0 "an entry naming a PR merged into cli-2.0 passes (#1131 for 1132)" "1132 #1131" "1132"
expect 0 "the real ported list passes for the hand-ported PRs" "$(cat "$here/cli-security-drift-ported.txt")" "997 998 1005 1132"

[ "$failures" -eq 0 ] && echo "all regressions passed" || { echo "$failures regression(s) failed"; exit 1; }
