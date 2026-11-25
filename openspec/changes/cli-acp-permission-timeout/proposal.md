## Why

Under `dexto acp`, a tool permission request ignores `permissions.timeout`, so an unanswered request blocks the turn forever. The CLI's own approval prompt, and `dexto acp` forms since `cli-acp-elicitation`, give up after the configured timeout. Found in the review of truffle-ai/dexto#1280 (DEXTO-3588).

## What Changes

- A `session/request_permission` left unanswered past `permissions.timeout` is withdrawn with `$/cancel_request` and answered as timed out: the tool does not run, its call ends `failed`, and the turn continues.
- A cancelled turn also withdraws its open permission request, as it already did for forms. A turn already cancelled sends none.
- Forms and permissions share one helper for this.

## Capabilities

### Modified Capabilities

- `acp-server`: permission requests honor `permissions.timeout` and are withdrawn on cancel.

## Impact

- `packages/cli/src/cli/commands/acp/acp-agent.ts`. No core changes.
