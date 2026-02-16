# @dexto/tools-lifecycle

Lifecycle and self-observation tools for Dexto agents.

This package is intended for **Node/CLI** environments. It provides tools that help an agent
inspect its own runtime state, including session logs and stored memories.

## Tools

- `view_logs` — Tail the current session log file (if file logging is configured).
- `memory_list` / `memory_get` / `memory_create` / `memory_update` / `memory_delete` — Manage agent memories.

## Usage (image)

Register the factory in an image:

```ts
import { lifecycleToolsFactory } from '@dexto/tools-lifecycle';

export default {
  tools: {
    'lifecycle-tools': lifecycleToolsFactory,
  },
  defaults: {
    tools: [{ type: 'lifecycle-tools' }],
  },
};
```

