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

### Requirement: Automation output

The CLI SHALL offer JSON output for each discovery command and useful human-readable output by default. Invalid query, path, or pagination input SHALL fail before networking.

#### Scenario: Paginated machine-readable search

- **WHEN** an agent requests search with JSON output, limit, and offset
- **THEN** one Cloud search request uses those parameters and stdout contains one valid JSON result
