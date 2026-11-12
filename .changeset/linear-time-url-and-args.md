---
'@dexto/cloud-client': patch
'@dexto/core': patch
'@dexto/tui': patch
---

Three string clean-ups no longer slow down badly on long runs of the same character: trimming trailing slashes from the Cloud API base URL, redacting credentials in a resource URI that is not a valid URL, and joining a multi-line tool argument onto one row.
