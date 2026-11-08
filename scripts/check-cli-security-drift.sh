#!/usr/bin/env bash
# Fails when a merged main PR labelled `security` has no sign of having reached cli-2.0 (DEXTO-2681).
#
# A PR counts as on cli-2.0 when ANY of these holds:
#   1. its merge commit is an ancestor of origin/cli-2.0;
#   2. a cli-2.0 commit says "(cherry picked from commit <sha>)" for it (git cherry-pick -x; a
#      squash merge keeps those lines);
#   3. its patch is identical to a commit already on cli-2.0 (git cherry);
#   4. scripts/cli-security-drift-ported.txt names how it was ported by hand, as
#        <main PR number> <cli-2.0 commit sha | #<cli-2.0 PR number>> [free-text note]
#      and that port is verified: the commit must be an ancestor of origin/cli-2.0, or the PR must
#      be merged into cli-2.0 with its merge commit on the branch. An entry that cannot be
#      verified (unknown commit, open or closed PR, wrong base, unreadable) does not count, so a
#      port that never landed fails the check instead of silencing it.
#
# Structural limits. Ancestry and patch matching show that a fix's commit reached cli-2.0. They do
# not prove that a conflict resolution kept the fix, or that a later commit did not revert it. For
# that, check the shipped code (see the tarball greps in DEXTO-2681). The check also trusts the
# `security` label: a fix that was never labelled is not seen. Treat a pass as "nothing known to be
# missing", not as proof that cli-2.0 is fully patched.
#
#   scripts/check-cli-security-drift.sh                     # every merged main PR labelled security
#   SECURITY_PRS="1089 1095" scripts/check-cli-security-drift.sh   # just these (to test the script)
#   DRIFT_PORTED_FILE=/path/to/list scripts/check-cli-security-drift.sh   # another ported list
# scripts/check-cli-security-drift.test.sh runs the negative regressions (needs network and gh).
set -euo pipefail

repo=${GITHUB_REPOSITORY:-truffle-ai/dexto}
ported_file=${DRIFT_PORTED_FILE:-"$(dirname "$0")/cli-security-drift-ported.txt"}

git fetch --quiet origin main cli-2.0

# port_landed <commit sha | #PR>: succeeds only when that port is really on origin/cli-2.0.
port_landed() {
  local ref=$1 info state base merge
  if [[ "$ref" =~ ^#([0-9]+)$ ]]; then
    info=$(gh pr view "${BASH_REMATCH[1]}" -R "$repo" --json state,baseRefName,mergeCommit \
      --jq '[.state, .baseRefName, (.mergeCommit.oid // "")] | @tsv') || return 1
    IFS=$'\t' read -r state base merge <<< "$info"
    [ "$state" = MERGED ] && [ "$base" = cli-2.0 ] && [ -n "$merge" ] || return 1
    git merge-base --is-ancestor "$merge" origin/cli-2.0
  elif [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]]; then
    git merge-base --is-ancestor "$ref" origin/cli-2.0 2>/dev/null
  else
    return 1
  fi
}

# Every merged main PR labelled security, all pages.
if [ -n "${SECURITY_PRS:-}" ]; then
  prs=$SECURITY_PRS
else
  prs=$(gh api --paginate "repos/$repo/issues?labels=security&state=closed&per_page=100" \
    --jq '.[] | select(.pull_request) | .number')
fi

missing=0
for n in $prs; do
  info=$(gh pr view "$n" -R "$repo" --json state,baseRefName,mergeCommit \
    --jq '[.state, .baseRefName, (.mergeCommit.oid // "")] | @tsv')
  IFS=$'\t' read -r state base sha <<< "$info"
  # Only merged PRs into main count; an open or closed-unmerged PR has nothing to port yet.
  [ "$state" = MERGED ] && [ "$base" = main ] && [ -n "$sha" ] || continue

  git merge-base --is-ancestor "$sha" origin/cli-2.0 && continue
  [ -n "$(git log origin/cli-2.0 -1 --format=%h -F --grep="cherry picked from commit $sha")" ] && continue
  git cherry origin/cli-2.0 "$sha" "$sha^" | grep -q '^-' && continue

  ref=$(awk -v n="$n" '$1 == n { print $2; exit }' "$ported_file" 2>/dev/null || true)
  if [ -n "$ref" ] && port_landed "$ref"; then
    continue
  elif [ -n "$ref" ]; then
    echo "MISSING from cli-2.0: #$n $(git log -1 --format='%h %s' "$sha")  (ported list says '$ref', which is not on cli-2.0)"
  else
    echo "MISSING from cli-2.0: #$n $(git log -1 --format='%h %s' "$sha")"
  fi
  missing=$((missing + 1))
done

if [ "$missing" -gt 0 ]; then
  echo "$missing security fix(es) on main are not known to be on cli-2.0. Port them (cherry-pick -x) or, for a hand port that has landed, list it in $ported_file."
  exit 1
fi
echo "No security-labelled fix from main is known to be missing from cli-2.0 (see the script header for what this cannot prove)."
