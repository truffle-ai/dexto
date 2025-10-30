# @dexto/analytics

Shared analytics utilities for Dexto CLI and WebUI.

## What's included

- **constants.ts**: PostHog configuration (keys, host, analytics disabled check)
- **state.ts**: Analytics state management (distinct ID persistence)

## Usage

```typescript
import { loadState, isAnalyticsDisabled, DEFAULT_POSTHOG_KEY } from '@dexto/analytics';

// Check if analytics is disabled
if (isAnalyticsDisabled()) {
  // Skip analytics
}

// Load analytics state (distinct ID)
const state = await loadState();
console.log(state.distinctId);
```

## Note

This is an internal package used by `@dexto/cli` and `@dexto/webui`. It is marked as private and not published to npm.
