---
'@dexto/core': patch
---

Log redaction now masks the password in connection URLs (`postgres://`, `redis://`, `mysql://`, `mongodb://`, `amqp://` and the like) in messages and data, keeping the scheme, user, host and database readable. An "@" in a URL's query or fragment is never read as part of its userinfo. An object that appears more than once in one log entry is written once and later references read `[Shared]`; an object that is also reached under an `env` or `headers` map reads `[REDACTED]` there, never `[Shared]`, so a densely linked object no longer makes a very large entry and a secret map is never left unmasked.
