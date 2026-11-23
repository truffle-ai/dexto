## Context

Dexto file tools report changes as a unified patch (`ToolDisplayData` of type `diff`), not as whole before and after files. ACP's `diff` content holds an old text and a new text for a path.

## Decisions

- Each patch hunk becomes one ACP diff. Its old text is the hunk's context and removed lines, and its new text is the context and added lines. A hunk that adds to an empty file has no old text. Clients can render that without reading the file, and no file is read twice.
- Diff paths are resolved against the session's workspace root, because ACP paths are absolute.
- Shell results become one text block, so clients that don't render terminals still show the command and its output.
- Displays other than diff and shell stay text, as before.

## Risks / Trade-offs

A hunk-level diff shows only the changed region, not the whole file. That matches what Dexto's own CLI shows for edits.
