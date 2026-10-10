## ADDED Requirements

### Requirement: Progressive Cloud discovery

The SDK and CLI SHALL expose sources, search, and describe against existing application-origin Cloud capability routes. Discovery SHALL preserve server pagination and capability schema, execution, and invocability metadata without granting invocation authority.

#### Scenario: Search then describe

- **WHEN** an authenticated user searches and describes a returned capability path
- **THEN** the CLI returns the server's search pagination and full description without executing the capability

### Requirement: Explicit authenticated boundary

The SDK SHALL require an explicit credential and origin, disable redirects, validate response contracts, and distinguish HTTP errors from malformed successful responses. The CLI SHALL reuse current device/API-key login and never claim cached credentials prove current identity or scope.

#### Scenario: Permission denied

- **WHEN** Cloud rejects discovery with HTTP 403
- **THEN** the CLI fails with a permission explanation and JSON mode emits a machine-readable error without credential bytes

#### Scenario: Missing credentials

- **WHEN** no existing API key is available
- **THEN** the CLI fails before networking and directs the user to login or supply DEXTO_API_KEY

#### Scenario: Legacy saved credential without an issuing origin

- **WHEN** discovery selects a saved credential without platform origin metadata
- **THEN** the CLI fails before networking and directs the user to log in again to the intended application origin

#### Scenario: Shell credential overrides

- **WHEN** Cloud discovery resolves credentials and application origin
- **THEN** it uses the saved credential and issuing origin or explicit incoming shell overrides, without treating dotenv-loaded values as explicit overrides
- **AND** an explicit shell credential without a shell origin or CLI origin option uses the canonical application origin

### Requirement: Automation output

The CLI SHALL offer JSON output for each discovery command and useful human-readable output by default. Invalid query, path, or pagination input SHALL fail before networking.

#### Scenario: Paginated machine-readable search

- **WHEN** an agent requests search with JSON output, limit, and offset
- **THEN** one Cloud search request uses those parameters and stdout contains one valid JSON result
