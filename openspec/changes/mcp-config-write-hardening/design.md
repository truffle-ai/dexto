## Context

Standalone add/remove load a YAML document to preserve comments, then previously wrote directly to the selected path. Creation used mode `0600`, but existing files retained their mode and writes followed leaf symlinks. Whole-document read/modify/write can also lose overlapping edits.

## Goals / Non-Goals

**Goals:** Private replacement, preservation of current YAML conventions, observed leaf-symlink refusal, safe failure outcomes, and best-effort cleanup through the existing CLI boundary.

**Non-Goals:** Cross-command locking, conflict detection, parent-directory symlink/ownership controls, crash durability, other configuration writers, hosted policy, agent behavior, OAuth stores, or new flags.

## Decisions

- Keep one private writer in the existing standalone command module and reuse it for add/remove. Existing agent configuration helpers are private and use a shared fixed temporary name; the deployment lock owns unrelated product state and uses timed stale-lock reclamation. Neither fits this narrow boundary.
- On POSIX, generate a unique sibling temporary path, open with `wx` and mode `0600`, set the open file's mode explicitly, then write and close it before renaming. Exclusivity prevents overwriting a pre-existing temporary path. Cleanup starts only after this command successfully owns the temporary file.
- On Windows, keep the existing in-place writer rather than introducing a runtime ACL tool. Creating a replacement file could inherit broader parent ACLs and discard a restrictive existing file ACL. New Windows files retain default filesystem ACL behavior; in-place partial-write failures remain unchanged.
- Reject observed leaf symlinks before reading edit input and again before writing or rename. Rename replaces the leaf path rather than writing through its target. This is not protection against arbitrary directory mutations or filesystem races.
- Preserve the original exception while attempting to close/remove the owned temporary file. Existing output mapping returns a fixed message without raw filesystem details.
- Keep all credential templates literal and preserve YAML document editing. Read-only commands and portable library APIs are unchanged.

## Risks / Trade-offs

- Every successful POSIX edit produces mode `0600`, and replacement changes the file inode. Existing shared-file permissions and hard-link relationships are not retained. Symlink-based edit workflows must select the actual file.
- Windows in-place edits retain existing file ACLs. POSIX mode assertions do not establish an equivalent Windows ACL policy, and Windows partial-write failures can leave incomplete content.
- Overlapping external or CLI read/modify/write operations can still lose changes. Callers must serialize edits and control the selected parent directory. Lock ownership/conflict handling needs a separate design.
- Cleanup is best-effort. A cleanup failure or process crash can leave a private temporary file; no fsync-based crash durability is promised.

## Validation

Real file tests cover POSIX permissions, existing/dangling symlinks, unchanged YAML on injected partial-write/rename failures, temporary cleanup, literal templates and comments. Actual CLI subprocess tests cover successful add/remove and symlink refusal. A native Windows-only subprocess regression compares the file security descriptor across actual add/remove under a broader parent ACL. The existing Windows standalone build workflow runs that regression; local platform mocks establish only branch behavior. Existing standalone process coverage remains part of the final gate.
