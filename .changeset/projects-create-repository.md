---
'dexto': patch
---

Add `dexto projects create --repository <owner/name|url>` to bind a new Project to a GitHub repository through its Environment. A new Environment's first build is metered compute, so `--repository` needs the `computers:write` permission and your agreement (or `--yes`).
