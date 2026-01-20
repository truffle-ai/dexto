---
'@dexto/analytics': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Fix model override persistence after compaction and improve context token tracking

**Bug Fixes:**
- Fix model override resetting to config model after compaction (now respects session overrides)

**Context Tracking Improvements:**
- New algorithm uses actual `input_tokens` and `output_tokens` from LLM responses as source of truth
- Self-correcting estimates: inaccuracies auto-correct when next LLM response arrives
- Handles pruning automatically (next response's input_tokens reflects pruned state)
- `/context` and compaction decisions now share common calculation logic
- Removed `outputBuffer` concept in favor of single configurable threshold
- Default compaction threshold lowered to 90%

**New `/context` Command:**
- Interactive overlay with stacked token bar visualization
- Breakdown by component: system prompt, tools, messages, free space, auto-compact buffer
- Expandable per-tool token details
- Shows pruned tool count and compaction history

**Observability:**
- Comparison logging between estimated vs actual tokens for calibration
- `dexto_llm_tokens_consumed` metric now includes estimated input tokens and accuracy metrics
