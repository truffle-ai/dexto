import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { DextoMcpClient } from './mcp-client.js';
import { McpServerConfigSchema } from './schemas.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

const probeServer = fileURLToPath(new URL('./fixtures/env-probe-server.mjs', import.meta.url));

const HOST_MARKER = 'DEXTO_TEST_HOST_MARKER';
const FORWARDED_MARKER = 'DEXTO_TEST_FORWARDED_MARKER';
const OTHER_MARKER = 'DEXTO_TEST_OTHER_MARKER';
const CONFIGURED = 'DEXTO_TEST_CONFIGURED';

let client: DextoMcpClient;

async function readEnvironment(names: string[]): Promise<Record<string, string | null>> {
    const result = await client.callTool('read_env', { names });
    expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
    const [first] = result.content;
    return JSON.parse(first.text);
}

async function connect(extra: { env?: Record<string, string>; passEnvironment?: string[] } = {}) {
    const config = McpServerConfigSchema.parse({
        type: 'stdio',
        command: process.execPath,
        args: [probeServer],
        ...extra,
    });
    if (config.type !== 'stdio') throw new Error('expected a stdio config');
    await client.connect(config, 'env-probe');
}

describe('MCP stdio server environment', () => {
    beforeEach(() => {
        client = new DextoMcpClient(createMockLogger());
        process.env[HOST_MARKER] = 'host-marker-value';
        process.env[FORWARDED_MARKER] = 'forwarded-marker-value';
        process.env[OTHER_MARKER] = 'other-marker-value';
    });

    afterEach(async () => {
        await client.disconnect();
        delete process.env[HOST_MARKER];
        delete process.env[FORWARDED_MARKER];
        delete process.env[OTHER_MARKER];
    });

    it('does not pass host variables the server was not given', async () => {
        await connect();

        expect(await readEnvironment([HOST_MARKER, FORWARDED_MARKER, OTHER_MARKER])).toEqual({
            [HOST_MARKER]: null,
            [FORWARDED_MARKER]: null,
            [OTHER_MARKER]: null,
        });
    });

    it('passes PATH so servers launched through PATH still start', async () => {
        await connect();

        const { PATH } = await readEnvironment(['PATH']);
        expect(PATH).toBe(process.env.PATH);
    });

    it('passes the server configured env', async () => {
        await connect({ env: { [CONFIGURED]: 'configured-value' } });

        expect(await readEnvironment([CONFIGURED, HOST_MARKER])).toEqual({
            [CONFIGURED]: 'configured-value',
            [HOST_MARKER]: null,
        });
    });

    it('forwards exactly the host variables named in passEnvironment', async () => {
        await connect({ passEnvironment: [FORWARDED_MARKER] });

        expect(await readEnvironment([FORWARDED_MARKER, HOST_MARKER, OTHER_MARKER])).toEqual({
            [FORWARDED_MARKER]: 'forwarded-marker-value',
            [HOST_MARKER]: null,
            [OTHER_MARKER]: null,
        });
    });

    it('lets configured env override a forwarded host variable', async () => {
        await connect({
            env: { [FORWARDED_MARKER]: 'configured-wins' },
            passEnvironment: [FORWARDED_MARKER],
        });

        expect(await readEnvironment([FORWARDED_MARKER])).toEqual({
            [FORWARDED_MARKER]: 'configured-wins',
        });
    });
});
