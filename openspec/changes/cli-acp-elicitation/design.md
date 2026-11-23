## Context

`ask_user` asks core's approval manager for an `ELICITATION` approval carrying a JSON Schema form. Core refuses it when `elicitation.enabled` is false, which the CLI bootstrap forces for every non-interactive mode. ACP v1 has `elicitation/create` in form mode with a primitive-typed object schema, and the client's answer is `accept` (with content), `decline` or `cancel`.

## Decisions

- **A bootstrap mode, not a flag:** `BootstrapAgentMode` gains `acp`. Like `headless-run` it is quiet, with an error-level silent logger and thrown image-load failures, but it is the only mode with elicitation on. This puts the "who can answer" rule in one place instead of adding an optional flag to the bootstrap.
- **Form support:** it is read once from `initialize` (`clientCapabilities.elicitation.form`). Without it no `elicitation/create` is sent.
- **Schema check:** the Dexto schema becomes the ACP schema only when every property is an object with a `type`. Extra keys such as `enum`, `title` and `x-dexto` pass through, and clients ignore keys they do not know. Anything else, such as boolean schemas or untyped fields, is not shown.
- **Fallback:** the request is denied with reason `elicitation_disabled` and the message "… Ask the person in your reply instead." Core passes that message on as the tool error, so the model sees it.
- **Mapping the answer:**
    - `accept` → approved with `formData`, the content or `{}`;
    - `decline` → denied (`user_denied`);
    - `cancel` or an unknown action → cancelled.
- **Cancel:** the request is sent with the turn's abort signal and `stopWaitingOnCancel`. A cancelled turn sends `$/cancel_request` and stops waiting, so the tool sees a cancellation and the run ends.
- **Scope:** the form is scoped to the session. The approval handler does not know which tool call raised it, so `toolCallId` is left out.

## Risks / Trade-offs

Clients that render forms but ignore extra keys lose Dexto's `x-dexto` step labels; that only affects presentation.
