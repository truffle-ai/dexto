---
'@dexto/core': patch
---

Log redaction now masks the password in connection URLs (`postgres://`, `redis://`, `mysql://`, `mongodb://`, `amqp://` and the like) in messages and data, keeping the scheme, user, host and database readable. An object that appears more than once in one log entry is written once and later references read `[Shared]`, so a densely linked object no longer makes a very large entry.
