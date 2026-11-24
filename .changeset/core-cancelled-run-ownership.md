---
"@dexto/core": patch
---

End a cancelled run once even when a hook ignores the abort and times out, keep the original setup error when a `run:complete` subscriber throws, and stop a cancelled stream from releasing a newer run that took the session.
