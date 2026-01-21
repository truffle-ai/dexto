---
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Session and context management fixes:

- Remove continuation session logic after compaction, now sticks to same session
- `/clear` continues same session and resets context (frees up AI context window)
- `/new` command creates new session with fresh context and clears screen
- Add context tokens remaining to footer, align context calculations everywhere
- Fix context calculation logic by including cache read tokens

Other improvements:

- Fix code block syntax highlighting in terminal (uses cli-highlight)
- Make terminal the default mode during onboarding
- Reduce OTEL dependency bloat by replacing auto-instrumentation with specific packages (47 MB saved: 65 MB → 18 MB)
