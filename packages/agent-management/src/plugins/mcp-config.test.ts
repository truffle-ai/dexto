import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMcpConfigFromDirectory } from './mcp-config.js';

describe('loadMcpConfigFromDirectory', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-mcp-config-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('merges root .mcp.json and nested mcps/*.json configs for standalone skills', async () => {
        await fs.writeFile(path.join(tempDir, 'root.js'), 'console.log("root");\n', 'utf8');
        await fs.writeFile(
            path.join(tempDir, '.mcp.json'),
            JSON.stringify({
                rootServer: {
                    command: 'node',
                    args: ['root.js'],
                },
            }),
            'utf8'
        );
        await fs.mkdir(path.join(tempDir, 'mcps'), { recursive: true });
        await fs.writeFile(
            path.join(tempDir, 'mcps', 'docs.json'),
            JSON.stringify({
                mcpServers: {
                    docsServer: {
                        type: 'http',
                        url: 'https://docs.example.test/mcp',
                    },
                },
            }),
            'utf8'
        );

        const result = loadMcpConfigFromDirectory(tempDir, 'release-skill', {
            scanNestedMcps: true,
        });

        expect(result.warnings).toEqual([]);
        expect(result.mcpConfig).toEqual({
            mcpServers: {
                rootServer: {
                    type: 'stdio',
                    enabled: true,
                    command: 'node',
                    args: [path.join(tempDir, 'root.js')],
                    env: {},
                    timeout: 30000,
                    connectionMode: 'lenient',
                },
                docsServer: {
                    type: 'http',
                    url: 'https://docs.example.test/mcp',
                    headers: {},
                    enabled: true,
                    timeout: 30000,
                    connectionMode: 'lenient',
                },
            },
        });
    });
});
