# Design

## Context

See proposal.md for motivation. Workspace direct dependencies and the workspace override currently resolve the monolithic MCP SDK 1.28.0. The target is official v1 release 1.32.1; v2 split-package migration is separate.

## Goals / Non-Goals

**Goals:** align dependency resolution, preserve public client composition and make upstream transport compatibility effects explicit.

**Non-Goals:** new transport construction, redirect policy flags, OAuth protocol changes, agent permission changes or external consumer dependency updates.

## Decisions

- Align existing ranges and the workspace override on `^1.32.1`. Preserve the existing monolithic package entrypoints and Dexto runtime source. Independently installed nested examples remain outside this workspace update and its validation. A partial update would retain conflicting resolution rules.
- Adopt upstream origin-restricted redirects without injecting `redirectPolicy: 'follow'`. Configure the final endpoint for cross-origin services. Real loopback HTTP tests exercise both direct and same-origin success and cross-origin failure.
- Retain existing OAuth JSON persistence: it serializes full SDK token/client objects, including new optional issuer fields. Custom stores must preserve those fields; legacy issuerless refresh data remains supported by upstream with a warning.
- Retain the upstream stdio buffer default of 10 MiB. It applies to pending protocol input, not an agent task budget. Servers requiring larger single frames need a separately designed transport configuration change; no automatic bypass is introduced here.

## Risks / Trade-offs

- Cross-origin redirect configurations stop connecting → document the final endpoint migration and verify no target request occurs.
- Large pending stdio frames exceed the new default → document this upstream limit and run existing real stdio regressions.
- SDK type and result compatibility changes → full OSS type/build gates, complete HTTP results/resource regression and focused existing consumer composition checks.

## Migration Plan

Update configured HTTP/SSE URLs to their final endpoints where redirects cross origins. Custom OAuth stores must retain SDK issuer metadata. Existing direct endpoints, caller-owned authorization and Dexto APIs remain unchanged. Rolling back the dependency restores older upstream behavior; no durable Dexto state migration is required.

## Official Sources

- [1.32.1 release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.1)
- [1.32.0 redirect behavior](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.0)
- [1.31.0 issuer persistence](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0)
- [1.30.0 stdio buffering](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.30.0)
