---
'dexto': patch
---

`dexto loops create` creates a Loop and `dexto loops update <loop_id>` changes one, each from the tool's own input as JSON (`--data`, or `--file` with `-` for stdin): schedule or event trigger, scope, execution and reporting pass on as given. Both need `automations:write`, return `{automation}`, and report the server's approvals and refusals as their error.
