# Transport Layer Structure

We are skipping the dedicated `handlers/` abstraction for now to keep the migration lightweight. All
business logic will live inside the Hono route modules, alongside the request/response validation
schemas that power automatic OpenAPI generation.
Dedicated `handlers` would allow us to use tools other than hono to host the API layer - not reqd right now.

## Current approach
- Each route module (e.g. `packages/server/src/hono/routes/messages.ts`) imports the shared
  `DextoAgent` instance and invokes it directly.
- Input validation is handled with Zod inside the route before calling the agent.
- Responses are serialized directly in the route using the returned value.
- WebSocket helpers remain colocated with the route/bridge code.

## Why this is acceptable today
- The Express implementation already bundles transport + business logic; keeping the
  consolidation avoids unnecessary churn while we ship the Hono swap.
- We have no external consumers yet (0 users); backwards compatibility and multi-transport reuse
  are not blockers.
- Hono already gives us runtime portability. Platform adapters (Node, Cloudflare, Vercel) can
  reuse the same `createDextoApp` without an intermediate layer.

## Future extraction (optional)
If we later want a framework-agnostic handler layer (for SDK generation, edge deployers, or direct
CLI reuse), we can lift the logic out of the route modules. To make that refactor easier:
- Keep route code focused on validation + serialization.
- Use well-typed helpers/utilities that can be shared later.
- Add a TODO comment in each route module noting the potential extraction point.

Until that need materialises, we will prioritise the direct Hono route implementation to unblock
OpenAPI docs, typed client generation, and alternative deploy targets.
