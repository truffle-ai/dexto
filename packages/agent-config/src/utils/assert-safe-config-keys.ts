/** Reject keys that can alter object prototypes when configuration is copied or merged. */
export function assertSafeConfigKeys(value: unknown): void {
    const seen = new WeakSet<object>();
    function visit(current: unknown, path: string): void {
        if (current === null || typeof current !== 'object' || seen.has(current)) return;
        seen.add(current);
        for (const [key, child] of Object.entries(current)) {
            const childPath = path ? `${path}.${key}` : key;
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                throw new Error(`Forbidden configuration key: ${childPath}`);
            }
            visit(child, childPath);
        }
    }
    visit(value, '');
}
