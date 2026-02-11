# Image Resolution Plan (CLI + Platform)

This plan is a follow-up to the DI + image refactor in [`PLAN.md`](./PLAN.md). It focuses on **how `image:` values are resolved at runtime**, especially for the globally-installed CLI.

**Why this exists:** Node’s ESM resolution for `import('<package>')` is anchored to the importing module’s install location. A globally-installed `dexto` cannot reliably import images that are only installed in some project’s `node_modules`. The DI refactor fixed the *shape* of images and removed side effects; this plan fixes *distribution + resolution*.

---

## 1. Problem Statement

### The underlying issue
- In the current refactor, the CLI calls `setImageImporter((s) => import(s))`, and `loadImage()` ultimately does `import(imageName)`.
- For global installs, `import('@myorg/my-image')` resolves relative to the global CLI package, **not** relative to the user’s project or agent YAML.
- Under pnpm and other strict layouts, “host package dependencies” are the only reliably resolvable packages from a given module.

### Symptoms
- Users can create and publish an image, install it into a project, and still have `dexto --image @myorg/my-image` fail when `dexto` is installed globally.
- Workarounds (installing the image globally in the same prefix as `dexto`) are fragile across npm/pnpm/yarn prefixes and Node version managers.

---

## 2. Goals / Non-Goals

### Goals
1. **Deterministic CLI resolution**: `image: '@scope/name'` should resolve the same way regardless of cwd/project/global installs.
2. **Support “bring your own image”**: users can build and run custom images without needing platform changes.
3. **Explicit install semantics**: for the CLI, **no auto-install**; images must be installed intentionally first.
4. **Preserve `DextoImageModule` contract**: image modules remain plain typed exports; no side effects on import.
5. **Clear UX errors**: if an image isn’t installed, provide a single canonical next step.

### Non-goals (for this plan)
- Building a full package registry to replace npm.
- Implementing platform sandboxing (we’ll define interfaces and expectations, not deliver infra).
- Changing core DI architecture (core stays DI-first; this plan is host-level behavior).

---

## 3. Terminology

- **Image**: a JS module exporting a `DextoImageModule` (typed factory maps + defaults).
- **Image store**: a local, Dexto-managed directory used by the CLI to store installed images.
- **Catalog**: a curated list of known images (optional), used for discovery and friendly aliases.
- **Specifier**: the user-facing `image:` value (from YAML / `--image` / env var).

---

## 4. Proposed Architecture: Dexto-managed Image Store

### Core idea
Adopt a Docker-like model:
- npm remains the **distribution channel**
- Dexto CLI maintains its own **local store** for deterministic resolution

**Default store path:**
- `~/.dexto/images/` (via existing context-aware path utilities)

### Store shape (proposed)
```
~/.dexto/images/
  registry.json
  packages/
    @dexto/
      image-local/
        1.5.8/
          node_modules/...
          package.json
          dist/index.js
          dist/index.d.ts
    @myorg/
      image-foo/
        1.2.3/
          ...
```

### Registry manifest (proposed)
`registry.json` maps a logical image id to installed versions and the “active” version:
```jsonc
{
  "images": {
    "@dexto/image-local": {
      "active": "1.5.8",
      "installed": {
        "1.5.8": {
          "entryFile": "file:///Users/me/.dexto/images/packages/@dexto/image-local/1.5.8/dist/index.js",
          "installedAt": "2026-02-11T00:00:00.000Z"
        }
      }
    }
  }
}
```

**Rationale:** YAML can stay `image: '@dexto/image-local'` while the store decides which installed version is active.

---

## 5. Image Specifier Semantics

The CLI should accept multiple forms:

### A) Store-resolved (recommended)
- `@scope/name`
- `@scope/name@1.2.3` (optional; implies “must have that version installed”, no network)

Resolution:
1. Look up `@scope/name` in `~/.dexto/images/registry.json`
2. Choose `@version` if specified, else choose `active`
3. Import via `file://.../dist/index.js`

### B) Direct file/module imports (dev/advanced)
- Absolute paths: `/abs/path/to/dist/index.js`
- File URLs: `file:///abs/path/to/dist/index.js`

Resolution:
- Import directly without touching the store.

**Note:** This is a power-user escape hatch for local iteration.

---

## 6. CLI UX + Commands

### New CLI surface (proposal)
- `dexto image install <specifier>`:
  - Installs an image into `~/.dexto/images` and marks it active (unless `--no-activate`).
  - Specifier may be:
    - npm package (`@myorg/my-image@1.2.3`), or
    - local folder / file for developer workflows.
- `dexto image list`:
  - Shows installed images, active versions, and entry paths.
- `dexto image remove <id>[@version]`:
  - Removes a specific version or the entire image from the store.
- `dexto image use <id>@<version>`:
  - Sets active version.
- `dexto image doctor`:
  - Prints store location and common resolution debugging info.

### CLI runtime behavior changes
When loading an image from YAML / `--image`:
- If it is a store-resolved specifier and it is not installed:
  - error with: `Run: dexto image install <id>`
- No implicit network activity.

---

## 7. Integration with `loadImage()` / `setImageImporter()`

### Keep `@dexto/agent-config` host-agnostic
`@dexto/agent-config` should not know about the image store. It should continue to:
- validate module shape at runtime
- accept a host-provided importer

### CLI owns resolution policy
CLI should set an importer that:
1. Detects file/URL specifiers → direct `import(...)`
2. Else resolves via `~/.dexto/images` registry → `import(fileUrl)`

This preserves pnpm safety while making resolution deterministic.

### End-to-end runtime flows (concrete examples)

#### Example A: Official image (global CLI)
**Agent YAML:**
```yaml
# agents/coding-agent/coding-agent.yml
image: '@dexto/image-local'

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

tools:
  - type: filesystem-tools
    allowedPaths: ['.']
  - type: process-tools
    securityLevel: moderate
```

**One-time install:**
```bash
dexto image install @dexto/image-local@1.5.8
```

**Runtime flow (CLI):**
1. CLI startup configures the importer (today: `setImageImporter((s) => import(s))` in `packages/cli/src/index.ts`; under this plan: a store-resolving importer).
2. CLI loads YAML via `@dexto/agent-management` → picks `imageName` (flag > YAML > env > default).
3. CLI calls `loadImage(imageName)` (`packages/agent-config/src/resolver/load-image.ts`):
   - the configured importer resolves `@dexto/image-local` → `file:///.../.dexto/images/.../dist/index.js`
   - the module is imported and validated as a `DextoImageModule`
4. CLI applies image defaults (`applyImageDefaults(...)`), validates config (`createAgentConfigSchema(...).parse(...)`), resolves DI services (`resolveServicesFromConfig(...)`), and constructs the agent (`new DextoAgent(toDextoAgentOptions(...))`).

#### Example B: User-built image (published) + deterministic CLI usage
**Build & publish:**
1. `dexto create-image my-image` (scaffolds a package with `dexto.image.ts`)
2. `pnpm build` (runs `dexto-bundle build`, producing `dist/index.js`)
3. Publish to npm: `pnpm publish` (or your org’s publishing flow)

**Install into the CLI store (not into a project):**
```bash
dexto image install @myorg/my-image@1.2.3
```

**Use from YAML (anywhere):**
```yaml
image: '@myorg/my-image'
```

#### Example C: Local development without installing (escape hatch)
When iterating on an image locally, point YAML directly at a built entry file:
```yaml
image: /abs/path/to/my-image/dist/index.js
```

This bypasses the store and uses direct `import()` of the file path/URL.

---

## 8. Platform Model Alignment

Platform should choose one of these policies based on sandbox maturity:

### A) Allowlisted images (safe default)
- `image:` is treated as an ID in a curated allowlist.
- Resolution is a lookup in a catalog + preinstalled bundle mapping.
- No dynamic “npm import arbitrary code” in the platform runtime.

### B) User-provided images (requires isolation)
If “users can run anything” is a product goal:
- Images must run in a sandbox boundary (container/microVM/worker isolate).
- The platform’s “image resolver” becomes: fetch/verify artifact → provision sandbox runtime → run agent.
- The YAML shape can remain the same; the runtime implementation changes.

This plan does not implement sandboxing; it defines the contract for how the platform can remain compatible with the same `image:` field.

---

## 9. Security Considerations (CLI)

- Installing an image is consenting to execute arbitrary JS on the local machine.
- Requiring explicit `dexto image install` is an intentional trust gate.
- The store should prefer reproducibility:
  - record package name/version
  - optionally record integrity hash (if we install from npm tarballs)

---

## 10. Work Plan (Tasks)

### Phase 0 — Spec + decisions
- [ ] Define image specifier grammar (store id vs file/url).
- [ ] Decide whether YAML may omit version (active version) vs must pin.
- [ ] Decide installer strategy:
  - shell out to `npm` (always present), or
  - use `pacote`/tarball extraction (no external tools), or
  - ship `pnpm` as a dependency (unlikely).

### Phase 1 — Store implementation (library)
- [ ] Implement store paths + registry manifest read/write.
- [ ] Implement “resolve image id → entry file URL”.
- [ ] Implement “is this specifier a file/URL?” helpers.

### Phase 2 — CLI commands
- [ ] Add `dexto image install/list/remove/use/doctor` commands.
- [ ] Add clear error messages for missing images.
- [ ] Validate installed images by importing the entry and running `loadImage()` conformance checks.

### Phase 3 — CLI runtime wiring
- [ ] Update CLI startup to set an image importer that resolves via the store.
- [ ] Ensure agent switching/server mode uses the same importer.

### Phase 4 — Tests
- [ ] Unit tests for registry read/write + resolution.
- [ ] Integration tests:
  - install from a local bundled image directory
  - run `loadImage('@myorg/image')` via store importer
  - error path when not installed

### Phase 5 — Catalog (optional)
- [ ] Add an “official images” catalog (could live in `@dexto/registry`) and CLI discovery UX.
- [ ] Add alias mapping (`local` → `@dexto/image-local`).

---

## 11. Acceptance Criteria

- Global `dexto` can run `image: '@myorg/my-image'` **after** `dexto image install @myorg/my-image@x.y.z`, independent of project `node_modules`.
- CLI never auto-installs images during normal agent startup.
- Error messages for missing images are actionable and consistent.
- `@dexto/agent-config` remains host-agnostic (store logic lives in CLI or a host-level lib).
