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
# Check closure and ordering before changing manifests or building anything.
node --input-type=module <<'MANIFEST'
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const selected = readFileSync('scripts/cli-beta-packages.txt', 'utf8').trim().split('\n').map(line => line.split(':')[0]);
const packages = readdirSync('packages').map(dir => {
    const path = `packages/${dir}`;
    return { path, ...JSON.parse(readFileSync(`${path}/package.json`, 'utf8')) };
});
const positions = new Map(selected.map((path, index) => [packages.find(pkg => pkg.path === path).name, index]));
for (const pkg of packages.filter(pkg => !pkg.private)) {
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })) {
        if (!positions.has(dep)) continue;
        assert(positions.has(pkg.name), `Missing dependent ${pkg.name} of ${dep}`);
        assert(positions.get(dep) < positions.get(pkg.name), `Publish ${dep} before ${pkg.name}`);
    }
}
console.log(`Publish closure and dependency order: ${selected.length} packages PASS`);
MANIFEST
pnpm install --frozen-lockfile > "$artifacts/install.log" 2>&1
while IFS=: read -r dir version; do
    VERSION="$version-beta.$beta" node -e 'const fs = require("fs"); const path = process.argv[1] + "/package.json"; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.version = process.env.VERSION; fs.writeFileSync(path, JSON.stringify(pkg, null, 4) + "\n");' "$dir"
done < scripts/cli-beta-packages.txt
pnpm run build > "$artifacts/build.log" 2>&1
while IFS=: read -r dir version; do
    (cd "$dir" && pnpm pack --pack-destination "$artifacts/t") > "$artifacts/pack-${dir##*/}.log" 2>&1
done < scripts/cli-beta-packages.txt
cp scripts/test-beta-{registry,runtime}.mjs "$artifacts/t/"
cat > "$artifacts/t/check.sh" <<'CHECK'
set -euo pipefail
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
    node - "$tree" <<'NODE'
const fs = require('fs');
const path = require('path');
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = path.join(dir, entry.name);
        const file = path.join(child, 'package.json');
        if (fs.existsSync(file)) {
            const pkg = JSON.parse(fs.readFileSync(file));
            if (pkg.name?.startsWith('@dexto/') && !['@dexto/llm', '@dexto/registry', '@dexto/client-sdk'].includes(pkg.name) && !pkg.version.includes('-beta.')) {
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
# Global installs use a fresh prefix and npm cache; dependencies live below each global package.
export npm_config_cache=/tmp/global-cache
npm install -g --prefix /prefix --no-audit --no-fund /t/*.tgz > /tmp/global-install.log 2>&1 || { cat /tmp/global-install.log; exit 1; }
cd /tmp
check_cli /prefix/bin/dexto /prefix/lib/node_modules/dexto
echo 'GLOBAL PASS (all tarballs, prefix install, signed-out CLI, storage SQLite read/write)'
CHECK
failed=0
for image in node:20-bookworm-slim node:22-bookworm-slim node:24-bookworm-slim; do
    rc=0
    docker run --rm -v "$artifacts/t:/t:ro" "$image" bash /t/check.sh > "$artifacts/${image//:/-}.log" 2>&1 || rc=$?
    cat "$artifacts/${image//:/-}.log"
    echo "RESULT $image rc=$rc" | tee -a "$artifacts/summary.log"
    if [ "$rc" -ne 0 ]; then failed=1; fi
done
exit "$failed"
