---
'dexto': minor
---

Add `dexto review`, which reviews the current branch's changes (committed since it left its base, uncommitted and untracked) with the bundled code-review skill and prints the review. It follows `dexto run`'s output and exit codes: `--json`, `--stream-json` or `--text`, and with no changes it prints "Nothing to review." and exits 0 without starting an agent. `--base` picks the branch to compare against (default: the upstream, else main) and `--focus` names an area to look at hardest.
