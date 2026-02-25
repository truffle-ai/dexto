---
'@dexto/agent-management': patch
'@dexto/analytics': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Add reasoning presets + reasoning trace controls across CLI/WebUI:

- Introduce structured reasoning config (preset + optional budget tokens) with provider-aware reasoning presets (`off|low|medium|high|max|xhigh`) and validate availability via the LLM registry (including the dynamic OpenRouter catalog).
- Map presets to provider-native knobs (e.g. OpenAI `reasoningEffort`, budget-token models) and reuse the same behavior across gateways (OpenRouter / Dexto Nova / native).
- Rename “reasoning effort” terminology to “reasoning preset” throughout the UX.
- CLI: Tab cycles the active reasoning preset; reasoning traces can be displayed in the transcript.
- Add `/reasoning` overlay to toggle reasoning trace visibility and (when supported) set/clear budget tokens.
- Enable Claude interleaved thinking for Claude 4+ models and align gateway/provider request headers so reasoning tuning behaves consistently (OpenRouter / Dexto Nova / native).
- Improve `/model` to surface all gateway models (OpenRouter/Dexto Nova) and their reasoning capability metadata.
- Default spawned sub-agents to reduced/no reasoning to avoid long-running spawned tasks.
