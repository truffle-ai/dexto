## ADDED Requirements

### Requirement: Account models and reasoning effort

The model picker SHALL offer the models the person's Dexto account serves, and a reasoning picker SHALL appear for a session whose model reasons.

#### Scenario: Account models offered

- **WHEN** Dexto models are enabled and the person is signed in or has `DEXTO_API_KEY`
- **THEN** the model picker includes each model from the account's `GET /v1/models`

#### Scenario: Reasoning effort

- **WHEN** the session's model reasons
- **THEN** a `thought_level` picker lists its variants with the current one selected, choosing a variant applies it, and an unknown variant is rejected as invalid params

### Requirement: Key and sign-in errors

A model that cannot run without a provider key or a Dexto sign-in SHALL be refused with ACP's `auth_required` error, saying which environment variable to set or that `dexto login` is needed.

#### Scenario: Choosing a model without its key

- **WHEN** the client chooses a model whose provider has no key, or a Dexto model without a usable sign-in
- **THEN** the request fails with `auth_required` and the session keeps its model

#### Scenario: Starting on a model without its key

- **WHEN** the agent's configured model has no key and the client creates a session
- **THEN** `session/new` fails with `auth_required` naming the key to set

### Requirement: Saved model preference

`dexto acp` SHALL start on the person's saved model once setup has saved one, for any agent, unless `--model` is given.

#### Scenario: Agent named with --agent

- **WHEN** preferences hold a saved model and `dexto --agent <path> acp` starts
- **THEN** new sessions start on the saved model
