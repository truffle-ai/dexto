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
cat > "$artifacts/t/check.sh" <<'CHECK'
set -euo pipefail
beta=${1:?beta}
echo "Node $(node -v), npm $(npm -v)"
for tool in python python3 gcc g++ make; do
    if command -v "$tool"; then echo "Unexpected build tool: $tool"; exit 1; fi
done
export HOME=/tmp/home npm_config_registry=http://127.0.0.1:4873
export DEXTO_LLM_REGISTRY_DISABLE_FETCH=1
mkdir -p "$HOME" /app
node /t/test-beta-registry.mjs /t/*.tgz > /tmp/registry.log 2>&1 &
registry_pid=$!
trap 'kill "$registry_pid"' EXIT
for attempt in $(seq 1 50); do
    if grep -q 'registry ready' /tmp/registry.log; then break; fi
    sleep 0.1
done
grep -q 'registry ready' /tmp/registry.log
check_cli() {
    local cli=$1 tree=$2
    "$cli" --version
    local rc=0
    "$cli" whoami --json > /tmp/whoami.out 2>&1 || rc=$?
    cat /tmp/whoami.out
    [ "$rc" -eq 3 ]
    cp /t/test-beta-runtime.mjs "$tree/beta-install-check.mjs"
    node "$tree/beta-install-check.mjs"
    # No stale beta-closure package or stable core/storage may appear anywhere in the tree.
    node - "$tree" "$beta" <<'NODE'
const fs = require('fs');
const path = require('path');
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = path.join(dir, entry.name);
        const file = path.join(child, 'package.json');
        if (fs.existsSync(file)) {
            const pkg = JSON.parse(fs.readFileSync(file));
            if (pkg.name?.startsWith('@dexto/') && !pkg.version.endsWith(`-beta.${process.argv[3]}`)) {
                throw new Error(`Stale workspace dependency: ${pkg.name}@${pkg.version}`);
            }
        }
        scan(child);
    }
}
scan(path.dirname(process.argv[2]));
NODE
}
cd /app
npm init -y > /dev/null
# Install only dexto: all transitive beta dependencies must resolve from unchanged tarballs.
npm install --no-audit --no-fund /t/dexto-[0-9]*.tgz > /tmp/local-install.log 2>&1 || { cat /tmp/local-install.log; exit 1; }
check_cli /app/node_modules/.bin/dexto /app/node_modules/dexto
echo 'LOCAL PASS (dexto tarball, transitive dependencies, signed-out CLI, storage SQLite read/write)'
# Install the CLI as users do. Installing all tarballs as separate globals makes npm link sibling
# workspace packages outside dexto, where they cannot see its optional peers. The fixture makes
# every packed beta available without changing tarball dependency declarations.
export npm_config_cache=/tmp/global-cache
npm install -g --prefix /prefix --no-audit --no-fund dexto@next > /tmp/global-install.log 2>&1 || { cat /tmp/global-install.log; exit 1; }
cd /tmp
check_cli /prefix/bin/dexto /prefix/lib/node_modules/dexto
echo 'GLOBAL PASS (dexto@next from packed registry, prefix install, signed-out CLI, storage SQLite read/write)'
CHECK
failed=0
for image in node:20-bookworm-slim node:22-bookworm-slim node:24-bookworm-slim; do
    rc=0
    docker run --rm -v "$artifacts/t:/t:ro" "$image" bash /t/check.sh "$beta" > "$artifacts/${image//:/-}.log" 2>&1 || rc=$?
    cat "$artifacts/${image//:/-}.log"
    echo "RESULT $image rc=$rc" | tee -a "$artifacts/summary.log"
    if [ "$rc" -ne 0 ]; then failed=1; fi
done
exit "$failed"
