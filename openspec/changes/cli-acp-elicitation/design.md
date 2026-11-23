## Context

`ask_user` asks core's approval manager for an `ELICITATION` approval carrying a JSON Schema form. Core refuses it when `elicitation.enabled` is false, which the CLI bootstrap forces for every non-interactive mode. ACP v1 has `elicitation/create` in form mode with a primitive-typed object schema, and the client's answer is `accept` (with content), `decline` or `cancel`.

## Decisions

- **A bootstrap mode, not a flag:** `BootstrapAgentMode` gains `acp`. Like `headless-run` it is quiet, with an error-level silent logger and thrown image-load failures, but it is the only mode with elicitation on. This puts the "who can answer" rule in one place instead of adding an optional flag to the bootstrap.
- **Form support:** it is read once from `initialize` (`clientCapabilities.elicitation.form`). Without it no `elicitation/create` is sent.
- **Schema check:** the Dexto schema becomes the ACP schema only when every property is one of ACP's standard field shapes: a string (optionally with choices or a known format), number, integer, boolean, or a multi-select of string choices. `ask_user` describes multi-select as `items: { enum }`, so the item type `string` is added. Keys ACP does not know, such as `x-dexto`, are dropped. Anything else, such as nested objects, lists without choices, or untyped fields, is not shown: ACP lets other field types through as custom fields, but clients cannot render them, and malformed standard fields are rejected by the client's validator.
- **Fallback:** the request is denied with reason `elicitation_disabled` and the message "… Ask the person in your reply instead." For `ask_user`, core passes that message on as the tool error, so the model sees it. Core answers an MCP server's elicitation with a plain decline, so the server decides what the model sees.
- **Mapping the answer:**
    - `accept` → approved with `formData`, the content or `{}`;
    - `decline` → denied (`user_denied`);
    - `cancel` or an unknown action → cancelled.
- **Cancel:** the request is sent with the turn's abort signal and `stopWaitingOnCancel`. A cancelled turn sends `$/cancel_request` and stops waiting, so the tool sees a cancellation and the run ends. A turn already cancelled sends no form.
- **Scope:** the form is scoped to the session. The approval handler does not know which tool call raised it, so `toolCallId` is left out.

## Risks / Trade-offs

Keys outside ACP's field shapes are dropped: Dexto's `x-dexto` step labels, and MCP's older `enumNames`, so such choices show their raw values. A `const` string becomes a free-text field. These only affect presentation.
