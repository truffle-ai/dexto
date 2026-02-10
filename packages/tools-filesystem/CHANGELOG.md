# @dexto/tools-filesystem

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
    - @dexto/core@1.5.8

## 1.5.7

### Patch Changes

- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [1960235]
    - @dexto/core@1.5.7

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
    - @dexto/core@1.5.6

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

- 4f00295: Added spawn-agent tools and explore agent.
- 69c944c: File integrity & performance improvements, approval system fixes, and developer experience enhancements

    ### File System Improvements
    - **File integrity protection**: Store file hashes to prevent edits from corrupting files when content changes between operations (resolves #516)
    - **Performance optimization**: Disable backups and remove redundant reads, switch to async non-blocking reads for faster file writes

    ### Approval System Fixes
    - **Coding agent auto-approve**: Fix auto-approve not working due to incorrect tool names in auto-approve policies
    - **Parallel tool calls**: Fix multiple parallel same-tool calls requiring redundant approvals - now checks all waiting approvals and resolves ones affected by newly approved commands
    - **Refactored CLI approval handler**: Decoupled approval handler pattern from server for better separation of concerns

    ### Shell & Scripting Fixes
    - **Bash mode aliases**: Fix bash mode not honoring zsh aliases
    - **Script improvements**: Miscellaneous script improvements for better developer experience

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
