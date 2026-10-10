## Why

Standalone MCP configuration can contain credentials. Editing an existing YAML file currently retains permissive file modes and truncates the current file before the replacement is fully written.

## What Changes

- Replace add/remove writes with an exclusively created private temporary file in the same directory, followed by atomic rename.
- All successful edits produce an owner-readable/writable `0600` file on POSIX, including edits of existing `0644` files.
- **BREAKING**: Add/remove reject observed existing or dangling leaf symlinks. Select the actual regular configuration file instead. Read-only commands retain their current path handling.
- Preserve literal credential templates, YAML comments, unrelated fields, duplicate handling, and configuration selection.
- Keep failures credential-safe and attempt to clean up owned temporary files without replacing the original failure.

## Capabilities

### New Capabilities

- `mcp-configuration-writes`: Private, atomic replacement of standalone MCP-only YAML through add/remove commands.

### Modified Capabilities

None.

## Impact

Only standalone CLI configuration mutation changes; portable Core, other configuration writers, hosted services, and agent execution are unaffected. Atomic replacement changes the file inode and does not retain its previous mode. Windows permissions remain governed by the filesystem ACL. Parent directory traversal, concurrent edit ownership, locking, crash durability, and OAuth credential storage are outside this slice.
