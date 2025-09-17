# API Documentation & Typed Clients

## Goals
- Generate consistent API documentation directly from Hono route metadata.
- Keep CLI, client SDK, and external consumers aligned via OpenAPI or typed clients.

## Approach
1. **Annotate routes**
   - Use `hono-openapi` (or similar) decorators to describe parameters, request bodies, and responses in routers.
   - Example:
     ```ts
     router.post('/message-sync', describeRoute({
       tags: ['messages'],
       requestBody: { ... },
       responses: { 200: { description: 'Synchronous response' } },
     }), async (c) => { ... });
     ```
2. **Generate OpenAPI spec**
   - Provide a script (e.g., `pnpm run generate:openapi`) that instantiates the app and emits `openapi.json` to `docs/static/api`.
   - Use this spec for docs site, SDK type verification, and future monetization portal.
3. **Typed Client**
   - Export `createTypedClient` from `@dexto/server/hono` using `hc`. This generates client-side method signatures automatically.
   - Client SDK wraps this typed client (see `05-client-sdk.md`).
4. **Docs site integration**
   - Update the docs site (Docusaurus) to pull `openapi.json`, render reference pages, or link to the spec.
5. **Testing**
   - Add a CI step verifying that generating the spec succeeds.
   - Optionally compare the generated spec against snapshots to detect accidental route changes.

## Benefits
- Documentation always matches shipped API.
- Simplifies onboarding for hosted deployments / third-party developers.
- Sets foundation for future monetization (API keys, rate limits, versioning).
