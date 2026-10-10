## Context

Cloud exposes `GET /api/capabilities/sources`, `GET /api/capabilities/search`, and `POST /api/capabilities/describe` on the application origin. The existing API request and response contracts define the wire contract. Discovery accepts organization API keys with `capabilities:read`; listing is not an invocation grant.

## Goals / Non-Goals

Goals: publish a small Cloud discovery boundary and a usable CLI journey; preserve server pagination, schemas, and availability metadata; reject malformed successful responses and report useful authentication/permission failures.

Non-goals: invocation, local agent composition changes, OAuth issuance/acceptance, credential introspection, billing or policy duplication, and any Cloud repository edits.

## Decisions

- Add a separate `@dexto/client-sdk/cloud` entrypoint. The existing Hono local-server client stays intact. This slice implements only the discovery wire contract in the existing public SDK.
- Require an explicit application origin, bearer credential, and injectable fetch in the SDK. Do not inspect environment or persist credentials there. Disable HTTP redirects so credentials cannot follow unexpected ingress redirects. Reject non-HTTPS origins except loopback development origins.
- Runtime schemas validate consumed response fields and preserve additive metadata. Cloud remains the owner of ranking, policy, execution modes, invocation availability, and JSON schemas.
- CLI resolves the existing API key, uses the application origin, and exposes pagination plus JSON. It makes one request per command and never fetches all pages implicitly. Missing credentials fail with a login instruction. No cached key metadata is presented as verified identity or authority.

## Risks / Trade-offs

- Wire drift → hermetic fixtures sourced from current Cloud contracts, runtime validation, and an isolated SDK boundary.
- OAuth migration remains pending → preserve current device/API-key login and keep Cloud discovery independently useful.
- Credential origin changes → require fresh login when a saved credential has no issuing origin, and refuse conflicting origin overrides; a different environment-provided API key remains an explicit operator choice.
- Managed `.env` may repeat a saved key → matching normalized keys retain the saved origin binding; a different environment credential can explicitly select another origin.
