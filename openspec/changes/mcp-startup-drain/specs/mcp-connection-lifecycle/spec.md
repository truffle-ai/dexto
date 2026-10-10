## Purpose

Provide reusable, orderly MCP manager teardown that accounts for connection operations already in progress.

## ADDED Requirements

### Requirement: Drain pending manager startup before teardown

When callers stop starting new connection and restart operations, `disconnectAll()` SHALL await operations already pending at invocation, including handshake, discovery, and connection publication, before disconnecting registered clients and clearing connection caches.

#### Scenario: Connection handshake is pending

- **WHEN** cleanup begins before an existing connection handshake completes
- **THEN** cleanup waits for that operation to settle and then disconnects its registered client

#### Scenario: Discovery is pending after registration

- **WHEN** cleanup begins while an existing connection is discovering tools, prompts or resources
- **THEN** cleanup waits for discovery and publication before clearing clients and discovery caches

#### Scenario: Replacement startup is pending

- **WHEN** cleanup begins during an existing restart operation
- **THEN** cleanup waits for the full restart and disconnects any successfully registered replacement

### Requirement: Preserve operation outcomes and reusable ownership

Draining SHALL preserve each pending operation's original success or failure outcome and SHALL retain desired registrations. The manager SHALL remain reusable after teardown.

#### Scenario: Startup fails during draining

- **WHEN** a pending startup fails while cleanup is waiting
- **THEN** the caller observes the original connection failure and cleanup still completes its existing cache clearing

#### Scenario: Reconnect after draining

- **WHEN** cleanup has completed and a caller explicitly reconnects a desired registration
- **THEN** the existing connection API can connect it again

### Requirement: Keep orderly drain timing explicit

Draining SHALL introduce no cancellation or additional timeout. Callers SHALL stop initiating new connection/restart operations before invoking cleanup; operations started afterward are outside this guarantee.

#### Scenario: Existing protocol or authentication remains pending

- **WHEN** an already-started operation has not settled its protocol or caller-owned authentication work
- **THEN** cleanup remains pending until that work settles under existing behavior
