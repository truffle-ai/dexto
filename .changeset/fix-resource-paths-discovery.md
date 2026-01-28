---
"dexto": patch
"@dexto/core": patch
---

- Fix resource path display and suggestion logic in CLI to correctly handle filesystem URIs.
- Refine resource references to prioritize project-relative paths (e.g., `@src/main.ts`) over filenames to avoid ambiguity.
- Improve resource discoverability by implementing directory exclusions (`node_modules`, `.git`, `.turbo`, etc.) in `FileSystemResourceHandler`.
- Refine exclusion logic to ensure project files with names similar to ignored directories are not incorrectly skipped.
