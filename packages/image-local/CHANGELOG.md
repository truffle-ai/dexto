# @dexto/image-local

## 1.5.8

### Patch Changes

- Updated dependencies [8687817]
- Updated dependencies [fc77b59]
- Updated dependencies [9417803]
- Updated dependencies [5618ac1]
- Updated dependencies [ef90f6f]
- Updated dependencies [20a2b91]
- Updated dependencies [9990e4f]
- Updated dependencies [c49bc44]
    - @dexto/agent-management@1.5.8
    - @dexto/core@1.5.8
    - @dexto/tools-filesystem@1.5.8
    - @dexto/tools-plan@1.5.8
    - @dexto/tools-process@1.5.8
    - @dexto/tools-todo@1.5.8

## 1.5.7

### Patch Changes

- c4ae9e7: Added support for skills and plugins. Create a custom plugin for plan tools and skills along with support for Plan mode.
- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [eb71ec9]
- Updated dependencies [1960235]
    - @dexto/agent-management@1.5.7
    - @dexto/core@1.5.7
    - @dexto/tools-plan@1.5.7
    - @dexto/tools-process@1.5.7
    - @dexto/tools-filesystem@1.5.7
    - @dexto/tools-todo@1.5.7

## 1.5.6

### Patch Changes

- 042f4f0: ### CLI Improvements
    - Add `/export` command to export conversations as Markdown or JSON
    - Add `Ctrl+T` toggle for task list visibility during processing
    - Improve task list UI with collapsible view near the processing message
    - Fix race condition causing duplicate rendering (mainly visible with explore tool)
    - Don't truncate `pattern` and `question` args in tool output display

    ### Bug Fixes
    - Fix build script to preserve `.dexto` storage (conversations, logs) during clean builds
    - Fix `@dexto/tools-todo` versioning - add to fixed version group in changeset config

    ### Configuration Changes
    - Remove approval timeout defaults - now waits indefinitely (better UX for CLI)
    - Add package versioning guidelines to AGENTS.md

- Updated dependencies [042f4f0]
    - @dexto/agent-management@1.5.6
    - @dexto/tools-filesystem@1.5.6
    - @dexto/tools-process@1.5.6
    - @dexto/tools-todo@1.5.6
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- 9ab3eac: Added todo tools.
- Updated dependencies [9ab3eac]
- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/tools-todo@0.1.1
    - @dexto/core@1.5.5
    - @dexto/tools-filesystem@1.5.5
    - @dexto/tools-process@1.5.5
    - @dexto/agent-management@1.5.5

## 1.5.4

### Patch Changes

- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4
    - @dexto/agent-management@1.5.4
    - @dexto/tools-filesystem@1.5.4
    - @dexto/tools-process@1.5.4

## 1.5.3

### Patch Changes

- 4f00295: Added spawn-agent tools and explore agent.
- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/agent-management@1.5.3
    - @dexto/tools-filesystem@1.5.3
    - @dexto/core@1.5.3
    - @dexto/tools-process@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/core@1.5.2
    - @dexto/tools-filesystem@1.5.2
    - @dexto/tools-process@1.5.2

## 1.5.1

### Patch Changes

- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/core@1.5.1
    - @dexto/tools-filesystem@1.5.1
    - @dexto/tools-process@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- 1e7e974: Added image bundler, @dexto/image-local and moved tool services outside core. Added registry providers to select core services.
- 5fa79fa: Renamed compression to compaction, added context-awareness to hono, updated cli tool display formatting and added integration test for image-local.
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
    - @dexto/tools-filesystem@1.5.0
    - @dexto/tools-process@1.5.0
