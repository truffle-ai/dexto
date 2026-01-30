---
'@dexto/agent-management': patch
'dexto': minor
---

Add interactive memory management commands to CLI:

- New `# <content>` command to add memory entries to agent instruction files (AGENTS.md, CLAUDE.md, or GEMINI.md)
- New `/memory` command to view current memory file path
- New `/memory list` command to list all memory entries
- New `/memory remove <number>` command to remove specific memory entries
- Memory entries are stored in a `## Memory` section within the instruction file

