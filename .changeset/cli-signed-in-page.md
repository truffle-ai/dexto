---
'@dexto/agent-management': patch
'dexto': patch
---

`dexto login` ends on the Dexto app's sign-in page in light or dark, instead of a bare localhost page. That page says when a sign-in was cancelled or failed; the old one said "Signed in" even after the person declined.
