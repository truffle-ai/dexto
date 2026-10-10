import { mkdtemp, writeFile, readFile, readdir, rm, open, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runStandaloneMcp } from './standalone.js';

vi.mock('node:fs/promises', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) };
});

const directories: string[] = [];
const filesystem = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(open).mockImplementation(filesystem.open);
    vi.mocked(rename).mockImplementation(filesystem.rename);
    await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

it.skipIf(process.platform === 'win32').each(['write', 'rename'])(
    'preserves the original YAML and removes the private temporary file on %s failure',
    async (failure) => {
        const directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-write-'));
        directories.push(directory);
        const config = join(directory, 'mcp.yml');
        const before = '# operator notes\nmcpServers: {}\n';
        await writeFile(config, before);
        const error = Object.assign(new Error('sentinel-filesystem-secret'), { code: 'EIO' });
        if (failure === 'write') {
            vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
                const file = await filesystem.open(path, flags, mode);
                const write = file.writeFile.bind(file);
                vi.spyOn(file, 'writeFile').mockImplementationOnce(async () => {
                    await write('partial');
                    throw error;
                });
                return file;
            });
        } else {
            vi.mocked(rename).mockRejectedValueOnce(error);
        }
        const result = await runStandaloneMcp(
            { command: 'add', server: 'local', serverConfig: '{"type":"stdio","command":"node"}' },
            { config }
        );
        expect(result).toEqual({
            exitCode: 2,
            output: {
                error: {
                    code: 'config_write_failed',
                    message:
                        'Cannot write MCP configuration. Use a regular file in a writable directory.',
                },
            },
        });
        expect(JSON.stringify(result)).not.toContain('sentinel-filesystem-secret');
        expect(await readFile(config, 'utf8')).toBe(before);
        expect(await readdir(directory)).toEqual(['mcp.yml']);
    }
);
