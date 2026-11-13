import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, readdirSync } from 'node:fs';

const selected = readFileSync('scripts/cli-beta-packages.txt', 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(':')[0]);
const packages = readdirSync('packages').map((dir) => {
    const path = `packages/${dir}`;
    return { path, ...JSON.parse(readFileSync(`${path}/package.json`, 'utf8')) };
});
const positions = new Map(
    selected.map((path, index) => [packages.find((pkg) => pkg.path === path).name, index])
);
for (const pkg of packages.filter((pkg) => !pkg.private)) {
    // No public package retains a stable pin after the 1.17.0 merge.
    assert(positions.has(pkg.name), `Public package missing from beta: ${pkg.name}`);
    for (const dep of Object.keys({
        ...pkg.dependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
    })) {
        if (!positions.has(dep)) continue;
        assert(positions.has(pkg.name), `Missing dependent ${pkg.name} of ${dep}`);
        assert(positions.get(dep) < positions.get(pkg.name), `Publish ${dep} before ${pkg.name}`);
    }
}
console.log(`Publish closure and dependency order: ${selected.length} packages PASS`);
