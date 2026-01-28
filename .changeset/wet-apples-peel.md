---
'dexto': patch
---

Fix Escape key getting stuck during tool approval prompts. Previously, pressing Escape while a tool approval was showing would trigger the global "Interrupted" message but leave the approval UI visible and the tool stuck in "Waiting..." state. Now Escape properly cancels the approval and finalizes the tool with a "Cancelled" status.
