## Context

HTTP routes already resolve the CLI host's current available agent and current card. MCP is initialized once with fixed references. The published server initializer and standalone card-registration function also serve static callers.

## Goals / Non-Goals

Goals: make new MCP requests follow the active agent, preserve static callers, and retain session ownership within one call.

Non-goals: alter permission modes, introduce execution limits, migrate in-flight work, mutate negotiated MCP connection identity, or change Core lifecycle behavior.

## Decisions

- Add one `McpAgentContext` argument to `initializeMcpServer`, with required agent/card getters. Default it once at the compatibility boundary to the original references. No per-request fallback selection.
- Resolve the agent once at chat entry. Use that reference for session creation, execution, logging and cleanup even if the host changes during an await.
- Read the card through its getter for each resource request. Keep `initializeAgentCardResource`'s existing three-argument signature by sharing the private resource-registration implementation.
- The CLI getter callbacks use the existing availability check. Failed switches leave getters pointing at the retained agent/card; switching and stopped hosts produce existing availability errors.
- Keep the protocol server name/version negotiated at initial connection unchanged. The card resource describes the active agent.

## Risks / Trade-offs

An agent switch can still interrupt already-running work because the existing host stops its previous agent; this change only preserves which agent owns cleanup. No claim of call migration or draining is made. The standalone static call remains unchanged, Core source is unchanged, and no hosted application source is modified.
