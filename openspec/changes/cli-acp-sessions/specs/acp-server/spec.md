## ADDED Requirements

### Requirement: Session list, resume and close

`dexto acp` SHALL advertise and serve `session/list`, `session/resume` and `session/close` for the project it serves.

#### Scenario: Listed

- **WHEN** the client lists sessions
- **THEN** it receives the stored sessions of this project, most recently active first, each with the project root as `cwd`, its last activity as `updatedAt`, and its title when it has one
- **AND** sessions created in other projects are not listed

#### Scenario: Resumed

- **WHEN** the client resumes a stored session of this project, including one from an earlier process
- **THEN** the session is ready for prompts and its history is not replayed

#### Scenario: Reopened while closing

- **WHEN** the client loads or resumes a session whose close is still waiting for its run or title
- **THEN** the session reopens after that close finishes, and prompts in it run to the end

#### Scenario: Closed while loading

- **WHEN** the client sends a load or resume of a session and then its close, without waiting, including as the first requests of a process
- **THEN** the session ends closed, and later prompts in it fail with `sessionNotFound`

#### Scenario: Unknown session resumed

- **WHEN** the client resumes a session that does not exist, or one created in another project
- **THEN** the request fails with `sessionNotFound`

#### Scenario: Closed

- **WHEN** the client closes a session with a running turn
- **THEN** the turn ends `cancelled`, the session is ended, no title update follows, and later prompts in it fail with `sessionNotFound`
- **AND** its history stays stored, so it can be loaded or resumed again

### Requirement: Session titles

`dexto acp` SHALL title a session after its first prompt and tell the client with a `session_info_update`.

#### Scenario: Titled

- **WHEN** the first prompt in an untitled session ends
- **THEN** the client receives a `session_info_update` with the session's title and an `updatedAt` time

#### Scenario: Already titled

- **WHEN** a later prompt ends in a session that is titled, or whose title is still being made
- **THEN** no further title update is sent
