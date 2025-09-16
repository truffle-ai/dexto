---
'dexto': patch
---

Simplify CLI session management with -c/-r flags and streamlined session commands 

- Add -c/--continue flag to resume most recent session 
- Add -r/--resume <sessionId> flag to resume specific session 
- Remove redundant session commands (new, switch, current) 
- Update default behavior to create new sessions 
- Simplify help text and command descriptions
