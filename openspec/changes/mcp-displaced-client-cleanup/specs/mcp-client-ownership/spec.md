## ADDED Requirements

### Requirement: Retain displaced client ownership

The manager SHALL retain a different client identity displaced by successful same-name registration until manager-wide cleanup, without closing it during replacement or changing registry overwrite behavior.

#### Scenario: Overlapping connections replace the same name

- **WHEN** two connections finish successfully for the same name
- **THEN** the final registry entry is the latest registered client
- **AND** the displaced client remains owned for cleanup

#### Scenario: Captured direct call crosses replacement

- **WHEN** a call captures the original client before a same-name replacement
- **THEN** replacement does not close that client eagerly
- **AND** the call retains its original routing behavior

### Requirement: Disconnect owned identities once per cleanup pass

After existing startup draining, `disconnectAll()` SHALL attempt cleanup of the union of current and displaced identities, deduplicated by client identity, and clear retirement ownership with existing registries. One rejected cleanup SHALL NOT skip other identities.

#### Scenario: Real replaced children are both closed

- **WHEN** manager-wide cleanup follows two successful overlapping stdio connections
- **THEN** both original and replacement child processes are closed

#### Scenario: Identity appears repeatedly

- **WHEN** the same client identity is registered repeatedly or under multiple names
- **THEN** manager-wide cleanup attempts that identity once in that pass

#### Scenario: One cleanup rejects

- **WHEN** one owned client rejects disconnection
- **THEN** other owned identities still receive disconnection attempts
- **AND** repeated cleanup does not repeat cleared retirement entries
