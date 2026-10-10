# Design

## Context

Standalone discovery already owns one Core MCP manager per command. See proposal.md for motivation.

## Goals / Non-Goals

Return full upstream resource and prompt results with the same selected-file and owned-cleanup boundary. Keep identity and permission authority with the direct local caller. No new agent runtime, HTTP listener, Core contract or dependency.

## Decisions

Use the existing connected client's SDK readResource/getPrompt methods with configured timeout, preserving literal URI/name and full results. Validate prompt arguments as a string-valued JSON object before connecting; tool arguments retain their existing broader schema. Reuse operation errors rather than exposing upstream exception text. Keep the existing parent/leaf configuration resolver for both commands.

## Risks / Trade-offs

Requested result data can contain sensitive upstream content → preserve it as requested user data; sanitize diagnostics only. Upstream protocol errors lack a result → return the existing safe operation-failure outcome. Abrupt OS termination remains outside normal owned-cleanup guarantees.
