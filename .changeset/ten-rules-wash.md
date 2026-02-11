---
'@dexto/server': patch
'@dexto/core': patch
---

Add per-model token usage tracking for multi-model sessions

**Features:**
- Track token usage and costs separately for each model used within a session
- New `modelStats` field in session metadata provides per-model breakdown:
  - Provider and model identifiers
  - Message count per model
  - Token usage breakdown (input, output, reasoning, cache read/write)
  - Estimated cost per model
  - First and last used timestamps
- Session-level aggregates (total tokens, total cost) now accurately sum across all models
- Pricing calculations now use the actual model from response payload, ensuring correct cost attribution when switching models mid-session

**Implementation:**
- Added `ModelStatistics` interface and schema for per-model tracking
- Added `SessionTokenUsageSchema` for comprehensive token accounting
- Extracted `accumulateTokensInto()` helper to eliminate duplication
- Updated OpenAPI documentation with new schema fields

**Bug Fixes:**
- Fixed pricing calculation to use response payload's model instead of session config, preventing incorrect costs when models are switched via `/model` command

This enables accurate resource tracking and cost attribution in sessions that use multiple models (e.g., switching from GPT-4 to Claude mid-conversation).
