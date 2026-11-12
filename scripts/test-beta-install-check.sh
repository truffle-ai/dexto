#!/usr/bin/env bash
# Runs inside a node:<version>-bookworm-slim container with the packed beta tarballs at /t.
# The image has no Python or compiler, so it passes only when every native dependency has a
# prebuilt binary for this Node.js. Used by scripts/test-beta-install.sh and publish-cli-beta.yml.
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
    # Node.js 26 has no better-sqlite3 12.9 prebuild: npm skips the optional dependency there.
    local driver=better-sqlite3
    if [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 26 ]; then driver=node:sqlite; fi
    EXPECT_SQLITE_DRIVER=$driver node "$tree/beta-install-check.mjs"
    # 2.0 ships chat sync off by default, and holds chat move and the catalog connect.
    rm -rf /tmp/sync-home && mkdir -p /tmp/sync-home
    node --input-type=module -e '
        const [store, dir] = process.argv.slice(1);
        const { chatSyncStore, syncIsOn } = await import(store);
        const settings = await chatSyncStore(dir).readSettings();
        if (settings.sync !== "off" || syncIsOn(settings)) throw new Error("chat sync is on by default");
        console.log("CHAT SYNC DEFAULT: off");
    ' "$tree/dist/cli/chat-sync/store.js" /tmp/sync-home/chat-sync
    for held in "chat move x --to cloud" "connect linear"; do
        rc=0
        # shellcheck disable=SC2086
        "$cli" $held --json > /tmp/held.out 2>&1 || rc=$?
        [ "$rc" -eq 2 ] || { cat /tmp/held.out; echo "dexto $held should be unknown (exit 2), got $rc"; exit 1; }
    done
    echo 'HELD COMMANDS: chat move and connect <connector> are not registered'
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
