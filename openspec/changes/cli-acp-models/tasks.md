## 1. Models

- [x] 1.1 Offer the Dexto account's models in the model picker.
- [x] 1.2 Offer and apply reasoning effort for models that reason.
- [x] 1.3 Answer a model without its key or sign-in with `auth_required`, on choosing it and when a session starts on it.
- [x] 1.4 Core: drop the previous provider's `baseURL` on a provider change, with resolver tests.

## 2. Setup

- [x] 2.1 Start `dexto acp` on the saved model preference, including with `--agent`.
- [x] 2.1a Drop the agent's endpoint and key when the saved provider differs, with a test.
- [x] 2.2 Rename `invoke_skill` to `skill_load` when an agent config loads, with a loader test.

## 3. Tests

- [x] 3.1 Integration tests: account models and reasoning effort; key and sign-in errors on choosing a model; a session starting on a keyless model; the saved preference with `--agent`.
