# @dexto/tools-process

## 1.5.5

### Patch Changes

- 6df3ca9: Updated readme. Removed stale filesystem and process tool from dexto/core.
- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/core@1.5.5

## 1.5.4

### Patch Changes

- aa2c9a0: - new --dev flag for using dev mode with the CLI (for maintainers) (sets DEXTO_DEV_MODE=true and ensures local files are used)
    - improved bash tool descriptions
    - fixed explore agent task description getting truncated
    - fixed some alignment issues
    - fix search/find tools not asking approval for working outside directory
    - add sound feature (sounds when approval reqd, when loop done)
        - configurable in `preferences.yml` (on by default) and in `~/.dexto/sounds`, instructions in comment in `~/.dexto/preferences.yml`
    - add new `env` system prompt contributor that includes info about os, working directory, git status. useful for coding agent to get enough context to improve cmd construction without unnecessary directory shifts
    - support for loading `.claude/commands` and `.cursor/commands` global and local commands in addition to `.dexto/commands`
- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4

## 1.5.3

### Patch Changes

- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/core@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/core@1.5.2

## 1.5.1

### Patch Changes

- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/core@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- 1e7e974: Added image bundler, @dexto/image-local and moved tool services outside core. Added registry providers to select core services.
- Updated dependencies [ee12727]
- Updated dependencies [1e7e974]
- Updated dependencies [4c05310]
- Updated dependencies [5fa79fa]
- Updated dependencies [ef40e60]
- Updated dependencies [e714418]
- Updated dependencies [e7722e5]
- Updated dependencies [7d5ab19]
- Updated dependencies [436a900]
    - @dexto/core@1.5.0
