---
'@dexto/agent-management': patch
---

Trim surrounding whitespace from values saved to a `.env` file, refuse values with an inner line break as a user error (a 400 from the server), reject invalid names, and keep that file readable by its owner only.
