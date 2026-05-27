"@dexto/llm": patch
"@dexto/core": patch
"@dexto/agent-management": patch
"@dexto/server": patch
"@dexto/tui": patch
"dexto": patch

Extract shared LLM catalog and reasoning metadata into @dexto/llm, wire core, CLI, TUI, server, and agent-management to consume it, and use OpenAI-compatible Dexto Nova transport semantics.
