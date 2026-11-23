## ADDED Requirements

### Requirement: Terminal sign-in

`initialize` SHALL offer a terminal auth method that signs the person in to Dexto when the client can run one, and `dexto acp login` SHALL behave exactly like `dexto login`.

#### Scenario: Client can run a terminal sign-in

- **WHEN** the client's capabilities include `auth.terminal: true` or `_meta["terminal-auth"]: true`
- **THEN** `authMethods` contains `dexto-login` of type `terminal` with args `login --scope cloud:write`

#### Scenario: Client cannot run a terminal sign-in

- **WHEN** the client declares neither marker
- **THEN** `authMethods` is empty

#### Scenario: Args added after or in place of acp

- **WHEN** the client runs `dexto acp login <args>` or `dexto login <args>`
- **THEN** both give the same output and exit code
