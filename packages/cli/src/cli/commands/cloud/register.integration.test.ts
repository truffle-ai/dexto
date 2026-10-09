import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
const tool = {
    aliases: ['drive.list'],
    description: 'List files',
    execution: { mode: 'hosted', owner: 'cloud' },
    invocable: { mode: 'available' },
    id: { sourceId: 'drive', toolId: 'list' },
    name: 'List files',
    sourceId: 'drive',
    tags: ['files'],
    inputSchema: { type: 'object' },
};

describe('Cloud CLI process discovery', () => {
    let server: Server;
    let directory: string;
    let origin: string;
    const requests: {
        method: string | undefined;
        url: string | undefined;
        body: string;
        authorization: string | undefined;
    }[] = [];

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dexto-cloud-discovery-'));
        server = createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            requests.push({
                method: request.method,
                url: request.url,
                body,
                authorization: request.headers.authorization,
            });
            response.setHeader('content-type', 'application/json');
            if (request.url?.includes('q=denied')) {
                response.statusCode = 403;
                response.end(JSON.stringify({ error: { code: 'forbidden' } }));
            } else if (request.url?.startsWith('/api/capabilities/sources')) {
                response.end(
                    JSON.stringify({
                        sources: [{ id: 'platform', kind: 'platform', title: 'Dexto' }],
                    })
                );
            } else if (request.url?.startsWith('/api/capabilities/search')) {
                response.end(
                    JSON.stringify({ hasMore: true, items: [tool], nextOffset: 3, total: 4 })
                );
            } else if (request.url === '/api/capabilities/describe') {
                response.end(JSON.stringify({ found: true, tool }));
            } else {
                response.statusCode = 404;
                response.end('{}');
            }
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP fixture server');
        origin = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
        if (server?.listening)
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    function run(args: string[]) {
        return execute(
            process.execPath,
            ['--import', tsx, entrypoint, 'cloud', ...args, '--json'],
            {
                cwd: directory,
                env: {
                    PATH: process.env.PATH,
                    SystemRoot: process.env.SystemRoot,
                    HOME: directory,
                    USERPROFILE: directory,
                    DEXTO_DEV_MODE: 'false',
                    DEXTO_PLATFORM_URL: origin,
                    DEXTO_API_KEY: 'cloud-fixture-key',
                    DEXTO_ANALYTICS_DISABLED: '1',
                    DEXTO_FEATURE_AUTH: 'false',
                    DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                },
                timeout: 20000,
            }
        );
    }

    it('uses the published Cloud SDK subpath through real CLI registration', async () => {
        const sources = await run(['sources', '--limit', '2']);
        expect(JSON.parse(sources.stdout)).toMatchObject({ sources: [{ id: 'platform' }] });
        const search = await run(['search', 'drive files', '--limit', '2', '--offset', '1']);
        expect(JSON.parse(search.stdout)).toMatchObject({ total: 4, nextOffset: 3, items: [tool] });
        const description = await run(['describe', 'drive.list']);
        expect(JSON.parse(description.stdout)).toEqual({ found: true, tool });
        expect(requests).toEqual([
            {
                method: 'GET',
                url: '/api/capabilities/sources?limit=2',
                body: '',
                authorization: 'Bearer cloud-fixture-key',
            },
            {
                method: 'GET',
                url: '/api/capabilities/search?limit=2&offset=1&q=drive+files',
                body: '',
                authorization: 'Bearer cloud-fixture-key',
            },
            {
                method: 'POST',
                url: '/api/capabilities/describe',
                body: '{"path":"drive.list"}',
                authorization: 'Bearer cloud-fixture-key',
            },
        ]);
    }, 60000);

    it('returns exit 1 and parseable JSON for permission failure', async () => {
        try {
            await run(['search', 'denied']);
            throw new Error('Expected a failed process');
        } catch (error) {
            expect(error).toMatchObject({ code: 1, stdout: expect.any(String) });
            if (
                !(error instanceof Error) ||
                !('stdout' in error) ||
                typeof error.stdout !== 'string'
            )
                throw error;
            expect(JSON.parse(error.stdout)).toMatchObject({
                error: { code: 'http_error', status: 403 },
            });
            expect(error.stdout).not.toContain('cloud-fixture-key');
        }
    }, 30000);
});
