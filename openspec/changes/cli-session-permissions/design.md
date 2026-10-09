# Design

Use the existing ApprovalManager keys, AllowedToolsProvider session entries and user-selected SessionToolPolicy entries. List and revoke them through DextoAgent; preserve global preferences and unrelated sessions. Remembered grants survive resuming the same logical session through existing stores. UI modes last only for the active TUI session and reset when switching sessions.

Reuse BaseSelector for `/permissions`. Show normal, accept-edits and auto-approve modes plus individual remembered grants that can be revoked. Gate this surface by backend support so remote backends do not advertise local controls they cannot enforce. Show scopes literally; opaque exact-command keys are shown as exact identities rather than inferred prefixes.

Retain generic Core tool-authored approval keys. Complex shell syntax receives an exact hashed identity rather than a coarse prefix. Do not build a shell parser or imply tool permissions are OS sandboxing.

Auto-approval must respect a request's `autoApproval: disallowed` policy. Reuse Core policy decisions rather than treating broader TUI mode as authority to override mandatory approvals.
