---
'dexto': patch
---

Refactor the CLI entrypoint into smaller command/mode modules while preserving lazy loading for startup paths.

- Split runtime command registration into per-command modules (`run`, `session`, `search`, `auth`, `billing`) with shared registration context.
- Extract main mode execution into `cli/modes/*` and dynamically import mode dispatch from `index-main.ts`.
- Keep `index-main.ts` focused on orchestration, reducing merge-conflict surface and improving maintainability.

Local benchmark medians (`/usr/bin/time -l`, with `DEXTO_DISABLE_ANALYTICS=1` and `DEXTO_DISABLE_VERSION_CHECK=1`) versus the pre-refactor baseline:
- `dexto --help`: ~3.3% faster, ~1.5% lower RSS
- `dexto --version`: comparable speed, ~3.6% lower RSS
- `dexto auth status`: comparable speed, ~2.4% lower RSS
