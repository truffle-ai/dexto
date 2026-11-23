## 1. Questions as ACP forms

- [x] 1.1 `acp` bootstrap mode: quiet, with elicitation on.
- [x] 1.2 Read the client's form support at initialize.
- [x] 1.3 Turn `ELICITATION` approvals into `elicitation/create` forms and map accept, decline and cancel.
- [x] 1.4 Answer with an ask-in-chat message when the client shows no forms or the schema cannot be shown.
- [x] 1.5 Withdraw the open form when the turn is cancelled or the elicitation timeout passes; honor an explicit `elicitation.enabled: false`.
- [x] 1.6 Unit tests for the schema check, including multi-select and fields ACP cannot show, checked against the SDK validator once by hand. Integration tests with the real `ask_user` for accept, decline, a client without forms, and a cancel with the form open.
