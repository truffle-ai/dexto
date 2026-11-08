#!/usr/bin/env bash
# Fails when a merged main PR labelled `security` has not reached cli-2.0 (DEXTO-2681).
#
# A PR counts as on cli-2.0 when its merge commit is an ancestor of cli-2.0, a cli-2.0 commit says
# "(cherry picked from commit <sha>)" (git cherry-pick -x; a squash merge keeps those lines), or
# its patch is identical to one already on cli-2.0. A fix ported by hand (a fresh install, say)
# goes in scripts/cli-security-drift-ported.txt as `<PR number> <where it landed>`.
#
#   scripts/check-cli-security-drift.sh                     # every merged main PR labelled security
#   SECURITY_PRS="1089 1095" scripts/check-cli-security-drift.sh   # just these (to test the script)
set -euo pipefail

repo=${GITHUB_REPOSITORY:-truffle-ai/dexto}
ported_file="$(dirname "$0")/cli-security-drift-ported.txt"

git fetch --quiet origin main cli-2.0
prs=${SECURITY_PRS:-$(gh pr list -R "$repo" --label security --state merged --base main --limit 200 --json number --jq '.[].number')}

missing=0
for n in $prs; do
  grep -qE "^$n( |$)" "$ported_file" 2>/dev/null && continue
  sha=$(gh pr view "$n" -R "$repo" --json mergeCommit --jq '.mergeCommit.oid')
  git merge-base --is-ancestor "$sha" origin/cli-2.0 && continue
  [ -n "$(git log origin/cli-2.0 -1 --format=%h -F --grep="cherry picked from commit $sha")" ] && continue
  git cherry origin/cli-2.0 "$sha" "$sha^" | grep -q '^-' && continue
  echo "MISSING from cli-2.0: #$n $(git log -1 --format='%h %s' "$sha")"
  missing=$((missing + 1))
done

if [ "$missing" -gt 0 ]; then
  echo "$missing security fix(es) on main have not reached cli-2.0. Port them (cherry-pick -x) or list them in scripts/cli-security-drift-ported.txt."
  exit 1
fi
echo "cli-2.0 has every security-labelled fix from main."
