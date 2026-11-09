---
'@dexto/core': patch
'@dexto/server': patch
---

Mask secrets the same way in both loggers. Log messages now hide quoted and unquoted values for secret-named keys (including `client_secret`, `Authorization`, `Cookie`, `X-Api-Key` and anything with secret, token, password or key in its name) and every value in `env` and `headers` maps, in the message and in the logged data. The structured logger now masks as well. Saving a custom agent logs only its id and size, not its configuration.
