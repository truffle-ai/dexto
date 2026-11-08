#!/usr/bin/env bash
# Regression tests for scripts/check-cli-security-drift.sh. Fully offline and deterministic: the
# script runs against a throwaway git fixture (a fake origin with main and cli-2.0) and a mocked
# `gh` that returns canned JSON. Nothing depends on truffle-ai/dexto history, the network or auth.
# Needs git and jq.
#   scripts/check-cli-security-drift.test.sh
set -uo pipefail

check="$(cd "$(dirname "$0")" && pwd)/check-cli-security-drift.sh"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
# Fixture directory: made by mktemp under the temp root, and only ever removed when it still is
# a non-empty directory path directly under that root.
tmp_root=${TMPDIR:-/tmp}
tmp_root=${tmp_root%/}
work=$(mktemp -d "$tmp_root/drift-test.XXXXXX") || exit 2
inside_tmp_root() { case $1 in *..*) return 1 ;; "$tmp_root"/drift-test.?*) [ -d "$1" ] ;; *) return 1 ;; esac; }
inside_tmp_root "$work" || { echo "refusing to use fixture dir '$work'" >&2; exit 2; }
remove_work() { inside_tmp_root "$work" && rm -rf -- "$work"; }
trap remove_work EXIT
failures=0

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z"

# ---- mocked gh: `gh pr view N -R repo --json ... --jq F` and `gh api --paginate repos/.../issues?... --jq F`
mkdir "$work/bin" "$work/mock"
cat > "$work/bin/gh" <<'MOCK'
#!/usr/bin/env bash
d=$MOCK_GH_DIR
fail() { echo "mock gh: forced failure: $*" >&2; exit 1; }
filter="" repo="" paginate=0 pos=()
while [ $# -gt 0 ]; do
  case $1 in
    --jq) filter=$2; shift 2 ;;
    -R) repo=$2; shift 2 ;;
    --json) shift 2 ;;
    --paginate) paginate=1; shift ;;
    *) pos+=("$1"); shift ;;
  esac
done
case "${pos[0]:-} ${pos[1]:-}" in
  "pr view")
    [ "$repo" = "$MOCK_GH_REPO" ] || fail "pr view for repo '$repo'"
    line=$(awk -v n="${pos[2]}" '$1 == n' "$d/prs.txt")
    [ -n "$line" ] || fail "no PR ${pos[2]}"
    read -r _ state base merge <<< "$line"
    [ "$state" != ERROR ] || fail "PR ${pos[2]} lookup"
    jq -n --arg s "$state" --arg b "$base" --arg m "$merge" \
      '{state: $s, baseRefName: $b, mergeCommit: (if $m == "-" then null else {oid: $m} end)}' | jq -r "$filter" ;;
  "api repos/"*)
    [ "${pos[1]}" = "repos/$MOCK_GH_REPO/issues?labels=security&state=closed&per_page=100" ] || fail "api ${pos[1]}"
    [ ! -e "$d/api_fail" ] || fail "label search"
    # Like gh: only --paginate follows the pages; without it the caller sees page 1 only.
    for page in "$d"/page*.json; do
      jq -r "$filter" "$page"
      [ "$paginate" = 1 ] || break
    done ;;
  *) fail "unexpected call: ${pos[*]}" ;;
esac
MOCK
chmod +x "$work/bin/gh"

# ---- git fixture: origin with main and cli-2.0, one file per fix so nothing conflicts
src="$work/src"
git init -q -b main "$src"
cd "$src" || exit 2
commit() { echo "$1" > "$1.txt"; git add "$1.txt"; git commit -q -m "$1"; git rev-parse HEAD; }
commit base >/dev/null
git switch -q -c cli-2.0

git switch -q main
fix_merged_into_cli=$(commit fix-merged-into-cli)             # PR 110
git switch -q cli-2.0
git merge -q --no-ff -m "merge main" main

git switch -q main
fix_trailer=$(commit fix-trailer)                              # PR 101: cherry-picked with -x
fix_same_patch=$(commit fix-same-patch)                        # PR 102: same patch, no trailer
fix_hand_commit=$(commit fix-hand-commit)                      # PR 103: ported by hand, commit sha listed
fix_hand_pr=$(commit fix-hand-pr)                              # PR 104: ported by hand, cli-2.0 PR #201 listed
fix_unported=$(commit fix-unported)                            # PR 105: never ported
fix_unknown=$(commit fix-unknown)                              # PR 106
fix_off_branch=$(commit fix-off-branch)                        # PR 107
fix_open_port=$(commit fix-open-port)                          # PR 108
fix_wrong_base=$(commit fix-wrong-base)                        # PR 109
fix_garbage=$(commit fix-garbage)                              # PR 111
fix_missing_pr=$(commit fix-missing-pr)                        # PR 112
fix_view_fails=$(commit fix-view-fails)                        # PR 500: gh pr view fails
unrelated_main=$(commit unrelated-main-only)                   # exists, never on cli-2.0

git switch -q cli-2.0
git cherry-pick -x "$fix_trailer" >/dev/null
git cherry-pick "$fix_same_patch" >/dev/null
hand_commit=$(echo hand > hand-port.txt; git add hand-port.txt; git commit -q -m "hand port of 103"; git rev-parse HEAD)
git switch -q -c port-201
echo hand2 > hand-port-pr.txt; git add hand-port-pr.txt; git commit -q -m "hand port of 104"
git switch -q cli-2.0
git merge -q --no-ff -m "Merge PR 201" port-201
merge_201=$(git rev-parse HEAD)
git branch -q -D port-201

git init -q --bare -b main "$work/origin.git"
git push -q "$work/origin.git" main cli-2.0
git clone -q "$work/origin.git" "$work/clone"

# <PR> <state> <base> <merge commit or ->. 202 and 203 carry a merge commit that is on cli-2.0, so only
# their state and base can reject them.
cat > "$work/mock/prs.txt" <<EOF
101 MERGED main $fix_trailer
102 MERGED main $fix_same_patch
103 MERGED main $fix_hand_commit
104 MERGED main $fix_hand_pr
105 MERGED main $fix_unported
106 MERGED main $fix_unknown
107 MERGED main $fix_off_branch
108 MERGED main $fix_open_port
109 MERGED main $fix_wrong_base
110 MERGED main $fix_merged_into_cli
111 MERGED main $fix_garbage
112 MERGED main $fix_missing_pr
120 OPEN main -
121 MERGED cli-2.0 $merge_201
201 MERGED cli-2.0 $merge_201
202 OPEN cli-2.0 $merge_201
203 MERGED release-x $merge_201
500 ERROR main -
EOF

export MOCK_GH_DIR="$work/mock" MOCK_GH_REPO="fixture/repo" GITHUB_REPOSITORY="fixture/repo"
export PATH="$work/bin:$PATH"
cd "$work/clone" || exit 2

# expect <want exit: 0|fail> <description> <ported-list contents> <PRs to check; empty scans the label> [text the output must contain]
expect() {
  local want=$1 what=$2 list=$3 prs=$4 text=${5:-} got ok=1
  printf '%s\n' "$list" > "$work/ported.txt"
  DRIFT_PORTED_FILE="$work/ported.txt" SECURITY_PRS="$prs" "$check" > "$work/out.txt" 2>&1
  got=$?
  if [ "$want" = 0 ]; then [ "$got" -eq 0 ] || ok=0; else [ "$got" -ne 0 ] || ok=0; fi
  [ -z "$text" ] || grep -qF -- "$text" "$work/out.txt" || ok=0
  if [ "$want" != 0 ] && grep -q '^No security-labelled fix' "$work/out.txt"; then ok=0; fi
  if [ "$ok" = 1 ]; then
    echo "PASS  $what (exit $got)"
  else
    echo "FAIL  $what: wanted ${want/fail/non-zero} exit${text:+ and output containing '$text'}, got $got"; sed 's/^/        /' "$work/out.txt"
    failures=$((failures + 1))
  fi
}

# One search page, as `gh api` returns it: the given pull requests plus an issue, which does not count.
page() { local f=$1; shift; jq -n '[$ARGS.positional[] | {number: (. | tonumber), pull_request: {}}] + [{number: 999}]' --args "$@" > "$work/mock/$f"; }
reset_pages() { rm -f "$work"/mock/page*.json "$work/mock/api_fail"; }

echo "--- how a fix counts as on cli-2.0"
expect 0 "a fix whose merge commit is an ancestor of cli-2.0 passes" "" "110"
expect 0 "a fix cherry-picked with -x passes" "" "101"
expect 0 "a fix with an identical patch on cli-2.0 passes" "" "102"
expect 0 "an entry naming a port commit that is on cli-2.0 passes" "103 $hand_commit" "103"
expect 0 "an entry naming a PR merged into cli-2.0 passes" "104 #201" "104"
expect 0 "an open PR, or one merged into another base, is not a main fix and is skipped" "" "120 121"

echo "--- fail closed"
expect fail "a fix with no entry and no ancestry is missing" "104 #201" "105" "MISSING from cli-2.0: #105"
expect fail "an entry naming an unknown commit fails" "106 0123456789abcdef0123456789abcdef01234567" "106" "MISSING from cli-2.0: #106"
expect fail "an entry naming a commit that is not on cli-2.0 fails" "107 $unrelated_main" "107" "MISSING from cli-2.0: #107"
expect fail "an entry naming an unmerged PR fails" "108 #202" "108" "MISSING from cli-2.0: #108"
expect fail "an entry naming a PR merged into the wrong base fails" "109 #203" "109" "MISSING from cli-2.0: #109"
expect fail "a malformed entry fails" "111 garbage" "111" "MISSING from cli-2.0: #111"
expect fail "an entry naming a PR that cannot be read fails" "112 #999" "112" "MISSING from cli-2.0: #112"
expect fail "gh failing on a PR lookup fails the check" "" "500" "mock gh: forced failure"

echo "--- label search pagination and gh failure"
reset_pages
page page1.json 101 102 103 104
page page2.json 105
expect fail "a security PR found only on page 2 is still checked" $'103 '"$hand_commit"$'\n104 #201' "" "MISSING from cli-2.0: #105"
reset_pages
page page1.json 101 102 103 104
page page2.json 110
expect 0 "every page of the label search is read and all fixes are known" $'103 '"$hand_commit"$'\n104 #201' ""
reset_pages
page page1.json 101
touch "$work/mock/api_fail"
expect fail "gh failing on the label search fails the check" "" "" "mock gh: forced failure"
reset_pages

[ "$failures" -eq 0 ] && echo "all regressions passed" || { echo "$failures regression(s) failed"; exit 1; }
