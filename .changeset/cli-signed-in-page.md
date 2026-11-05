---
'@dexto/agent-management': patch
'dexto': patch
---

`dexto login` ends on the Dexto app's sign-in page, in light or dark, instead of a bare localhost page. When you deny access or the authorization server returns an error, the page now says so; the old page said "Signed in" even then. A failure after the redirect, such as the token exchange, still shows only in the terminal.
