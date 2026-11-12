#!/usr/bin/env bash
# Run on a Linux Docker host, never on the Mac. Usage: bash scripts/test-beta-install.sh [beta]
# Mirrors publish-cli-beta.yml without publishing; artifacts/logs go to BETA_INSTALL_DIR.
set -euo pipefail
beta=${1:-99}
[[ "$beta" =~ ^[0-9]+$ ]] || { echo 'beta must be a whole number' >&2; exit 1; }
cd "$(dirname "$0")/.."
artifacts=${BETA_INSTALL_DIR:-$(mktemp -d)}
mkdir -p "$artifacts/t"
artifacts=$(cd "$artifacts" && pwd)
echo "Artifacts: $artifacts; head: $(git rev-parse HEAD)"
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
node scripts/check-cli-beta-packages.mjs
git diff --quiet HEAD -- 'packages/*/package.json' || { echo 'Start with clean package manifests.' >&2; exit 1; }
trap 'git restore --source=HEAD --worktree -- packages/*/package.json' EXIT
pnpm install --frozen-lockfile > "$artifacts/install.log" 2>&1
while IFS=: read -r -u 3 dir version; do
    VERSION="$version-beta.$beta" node -e 'const fs = require("fs"); const path = process.argv[1] + "/package.json"; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.version = process.env.VERSION; fs.writeFileSync(path, JSON.stringify(pkg, null, 4) + "\n");' "$dir"
done 3< scripts/cli-beta-packages.txt
pnpm run build > "$artifacts/build.log" 2>&1
while IFS=: read -r -u 3 dir version; do
    (cd "$dir" && pnpm pack --pack-destination "$artifacts/t") > "$artifacts/pack-${dir##*/}.log" 2>&1
done 3< scripts/cli-beta-packages.txt
cp scripts/test-beta-{registry,runtime}.mjs "$artifacts/t/"
cp scripts/test-beta-install-check.sh "$artifacts/t/check.sh"
failed=0
for image in node:20-bookworm-slim node:22-bookworm-slim node:24-bookworm-slim node:26-bookworm-slim; do
    rc=0
    docker run --rm -v "$artifacts/t:/t:ro" "$image" bash /t/check.sh "$beta" > "$artifacts/${image//:/-}.log" 2>&1 || rc=$?
    cat "$artifacts/${image//:/-}.log"
    echo "RESULT $image rc=$rc" | tee -a "$artifacts/summary.log"
    if [ "$rc" -ne 0 ]; then failed=1; fi
done
exit "$failed"
