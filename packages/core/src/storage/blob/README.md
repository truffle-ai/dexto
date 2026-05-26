# Blob Storage (Interfaces)

Core (`@dexto/core`) defines low-level storage **interfaces** such as `BlobStore` plus typed
runtime store contracts exposed through `DextoStores`.

Concrete blob store implementations and config schemas live in `@dexto/storage`.

- Node/runtime usage: import implementations from `@dexto/storage`
- Browser/schema usage: import from `@dexto/storage/schemas`

Config → instance resolution is handled in product layers (CLI/server/apps) via:

- `@dexto/agent-management` (load/enrich YAML)
- `@dexto/agent-config` (load image + apply defaults + resolve factories)
