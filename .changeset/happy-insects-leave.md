---
'dexto': patch
---

Enhanced session exit statistics and token usage reporting:

- Updated exit message to "Exiting Dexto CLI. Goodbye!" (was "Exiting AI CLI. Goodbye!")
- Enhanced token usage display with explicit labels ("Input tokens", "Output tokens", "Total tokens" instead of just "Input", "Output", "Total")
- Show all token types even when 0 (reasoning tokens, cache read tokens, cache write tokens)
- Simplified color scheme for consistency (all token types in gray)
- Display cache savings percentage when prompt caching is used
