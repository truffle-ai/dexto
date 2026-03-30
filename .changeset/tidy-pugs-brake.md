---
'@dexto/server': patch
'@dexto/agent-management': patch
---

Patch release for the recent Hono contract cleanup and package export fix.

- `@dexto/server`: publish the Hono inference contract/schema cleanup so downstream typed clients stop seeing opaque response shapes.
- `@dexto/agent-management`: publish the `exports["."].types` fix so NodeNext consumers resolve declarations correctly.
