#!/usr/bin/env sh
set -eu

# Optional escape hatch for CI or manual bypass.
if [ "${DEXTO_SKIP_WORKTREE_BOOTSTRAP:-0}" = "1" ]; then
    exit 0
fi

if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    exit 0
fi

root_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root_dir"

primary_worktree_dir="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"

copy_env_file() {
    relative_path="$1"
    target_file="$root_dir/$relative_path"
    example_file="$target_file.example"
    primary_file=""

    if [ -n "${primary_worktree_dir:-}" ]; then
        primary_file="$primary_worktree_dir/$relative_path"
    fi

    # Respect any existing non-empty .env in the current worktree.
    if [ -s "$target_file" ]; then
        return
    fi

    # First preference: copy from the primary worktree.
    if [ -n "$primary_file" ] && [ -s "$primary_file" ] && [ "$primary_file" != "$target_file" ]; then
        cp "$primary_file" "$target_file"
        printf '[worktree-bootstrap] copied %s -> %s\n' "$primary_file" "$target_file"
        return
    fi

    # Fallback: copy from local .env.example when available.
    if [ -s "$example_file" ]; then
        cp "$example_file" "$target_file"
        printf '[worktree-bootstrap] copied %s -> %s\n' "$example_file" "$target_file"
    fi
}

copy_env_file ".env"
copy_env_file "examples/discord-bot/.env"
copy_env_file "examples/telegram-bot/.env"

if [ -d "node_modules" ]; then
    exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
    printf '[worktree-bootstrap] pnpm not found; skipping install\n' >&2
    exit 0
fi

printf '[worktree-bootstrap] node_modules missing; running pnpm install...\n'
pnpm install
