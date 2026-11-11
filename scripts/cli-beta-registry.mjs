import assert from 'node:assert/strict';

// Only an explicit registry 404 permits publication. Network/auth/server failures abort.
export async function isPublished(name, version, request = globalThis.fetch) {
    const response = await request(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
        { signal: globalThis.AbortSignal.timeout(30_000) }
    );
    if (response.status === 404) return false;
    if (!response.ok)
        throw new Error(`Registry lookup failed: ${name}@${version}: HTTP ${response.status}`);
    const pkg = await response.json();
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, version);
    return true;
}
