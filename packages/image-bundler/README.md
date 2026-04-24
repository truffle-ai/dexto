# `@dexto/image-bundler`

Bundler for convention-based Dexto images.

It consumes a `dexto.image.ts` (metadata + defaults) and a convention folder layout (tools/hooks/compaction),
then produces a distributable package that **default-exports a typed `DextoImage`** (no side effects, no registries).

## CLI

This package ships a CLI:

```bash
dexto-bundle build --image dexto.image.ts --out dist
```

Outputs:
- `dist/index.js` (default export: `DextoImage`)
- `dist/index.d.ts` (types)
- compiled convention folders under `dist/`

## Convention folders

Each `<type>/index.ts` must export a `factory` constant with `{ configSchema, create }`:

```
tools/<type>/index.ts
hooks/<type>/index.ts
compaction/<type>/index.ts
```

## Generated image contract

The generated default export matches `@dexto/agent-config`’s `DextoImage` interface:

- `metadata` + optional `defaults`
- `tools`, `hooks`, `compaction` factory maps (keyed by config `type`)
- `storage.createStores` inherited from the base image, or a generated placeholder for custom base images
- `logger` factory

## Related

- `dexto create-image` (CLI scaffold that uses this bundler)
- `@dexto/agent-config` (image loading + config→services resolver)
