## Decisions

- **One helper:** `askWithin` sends a question (a permission or a form) with a cancellation signal that combines the turn's abort with `AbortSignal.timeout` of the approval's `timeout`, which core fills from `permissions.timeout` or `elicitation.timeout`. With `stopWaitingOnCancel` the SDK sends `$/cancel_request` and stops waiting.
- **Results:**
    - a timeout gives `cancelled` with reason `timeout`, a message and `timeoutMs`, the same shape as the CLI's approval handler;
    - a turn cancel gives `cancelled` with reason `user_cancelled`;
    - any other request error is rethrown.
- **The helper returns** a discriminated `answered` or `withdrawn` result, so each caller keeps its own answer mapping.
