# Proposal

## Why

Dexto currently resolves MCP SDK 1.28.0. Update within the monolithic v1 package to receive upstream fixes while explicitly validating transport behavior and documenting compatibility changes.

## What Changes

- Align Core, CLI, server, the workspace example and the workspace override on MCP SDK `^1.32.1` and update the lockfile.
- Preserve Dexto public APIs and ordinary stdio/HTTP/SSE operations through existing and real HTTP regressions.
- **BREAKING**: adopt the SDK's origin-restricted redirect default. Remote configurations that redirect to another origin must use the final endpoint URL.
- Document upstream stdio frame buffering and OAuth persistence compatibility.

## Capabilities

### New Capabilities

- `mcp-transport-compatibility`: remote transport redirect defaults and public SDK-client composition.

### Modified Capabilities

None; the repository currently has no durable spec for this transport boundary.

## Impact

Only OSS dependency manifests, lockfile, transport tests, documentation and release metadata change. Existing consumers retain Core APIs, results, authorization and lifecycle ownership. Consumer-composition checks and actual HTTP integration provide focused compatibility evidence; they do not represent a complete external application upgrade. No v2 migration, new transport engine, policy flag, agent behavior, task limit or consumer dependency update is included.
