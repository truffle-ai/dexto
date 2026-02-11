# Blob Storage (Interfaces)

Core (`@dexto/core`) defines the storage **interfaces** used by agents (e.g., `BlobStore`) and the
`StorageManager` that composes concrete backends.

Concrete blob store implementations + factories + config schemas live in `@dexto/storage`.

- Node/runtime usage: import factories/implementations from `@dexto/storage`
- Browser/schema usage: import from `@dexto/storage/schemas`

Config → instance resolution is handled in product layers (CLI/server/apps) via:

- `@dexto/agent-management` (load/enrich YAML)
- `@dexto/agent-config` (load image + apply defaults + resolve factories)

