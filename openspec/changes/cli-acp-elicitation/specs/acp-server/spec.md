## ADDED Requirements

### Requirement: Questions as forms

When the agent asks the person for structured input (`ask_user`, or an MCP server's elicitation), `dexto acp` SHALL ask it as an ACP `elicitation/create` form if the client supports forms and the form uses only fields ACP forms can show. Otherwise an `ask_user` call SHALL tell the model to ask in its reply, and an MCP server's elicitation SHALL be declined.

#### Scenario: Answered

- **WHEN** the client advertises form support and the agent calls `ask_user`
- **THEN** the client receives a form for the session with the question as its message and the fields as its schema
- **AND** the values the person submits are returned to the tool

#### Scenario: Declined

- **WHEN** the person declines the form
- **THEN** the tool call fails and the turn continues

#### Scenario: No form support

- **WHEN** the client does not advertise form support
- **THEN** no form is sent, and the tool result tells the model to ask the person in its reply

#### Scenario: A field ACP cannot show

- **WHEN** the client advertises form support and `ask_user` asks for a field ACP forms cannot show, such as a nested object
- **THEN** no form is sent, and the tool result tells the model to ask the person in its reply

#### Scenario: Multi-select

- **WHEN** `ask_user` asks for a multi-select written as `type: "array"` with `items: { enum: [...] }`
- **THEN** the form's field carries `items: { type: "string", enum: [...] }`, the shape ACP accepts

#### Scenario: Turned off

- **WHEN** the agent config sets `elicitation.enabled: false`, or `dexto --no-elicitation acp` is run
- **THEN** no form is sent and `ask_user` fails as elicitation is disabled

#### Scenario: Timed out

- **WHEN** the agent config sets `elicitation.timeout` and the form is not answered in time
- **THEN** the form request is withdrawn and the tool call fails as timed out, and the turn continues

#### Scenario: Cancelled while open

- **WHEN** the client cancels the turn while a form is open
- **THEN** the form request is withdrawn, the prompt ends with `cancelled`, and the next prompt in that session is accepted
