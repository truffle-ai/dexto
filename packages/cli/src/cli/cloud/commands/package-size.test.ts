import { beforeEach, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs/promises')>()),
    stat: files.stat,
    readFile: files.readFile,
}));

import { readPackage } from './apps.js';

beforeEach(() => {
    files.stat.mockReset();
    files.readFile.mockReset();
});

it('rejects a package that grows beyond its limit between stat and read', async () => {
    files.stat.mockResolvedValue({ isFile: () => true, size: 1 });
    files.readFile.mockResolvedValue(Buffer.from('ab'));
    await expect(
        readPackage('deploy.json', {
            label: 'a Function package',
            maxBytes: 1,
            purpose: 'function-package',
        })
    ).rejects.toThrow('can be up to');
});
