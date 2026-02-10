# @dexto/registry

## 1.5.8

## 1.5.7

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

## 1.5.5

### Patch Changes

- 6df3ca9: Updated readme. Removed stale filesystem and process tool from dexto/core.

## 1.5.4

## 1.5.3

## 1.5.2

## 1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating
