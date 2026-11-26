import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const TOKEN = 'access-feedback-secret';
const REPORT_ID = '3d8f2b6a-1c4e-4f7a-9b2d-5e6c7a8b9c0d';

const REPORT = {
    summary: 'Profile changes fail to save',
    actualBehavior: 'Saving the profile returns an error and keeps the old name.',
    expectedBehavior: 'The updated profile name should be saved.',
    impact: 'The user cannot update their public profile.',
    reproduction: { kind: 'steps', steps: ['Open profile settings', 'Change the name', 'Save'] },
    diagnostics: [{ kind: 'page_url', value: '/settings/profile' }],
    relatedIdentifiers: [{ kind: 'trace', value: 'trace-456' }],
};
const RECEIPT = {
    createdAt: '2026-11-24T10:00:00.000Z',
    recorded: true,
    reportId: REPORT_ID,
    status: 'new',
};

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto feedback submit', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let stdin: string;
    let scopes: string[];
    let calls: { name: string; arguments: unknown; requestId: string | null; auth: string }[];
    let host: CloudHost;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-feedback-')), 'accounts');
        stdout = '';
        stderr = '';
        stdin = '';
        scopes = ['feedback:write'];
        calls = [];
        const writeLogin = () =>
            dextoAccounts.writeLogin(dir, 'default', {
                kind: 'oauth',
                accessToken: TOKEN,
                refreshToken: 'refresh-feedback-secret',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                clientId: 'dexto-cli',
                appUrl: 'https://app.dexto.ai',
                apiBaseUrl: 'https://api.dexto.ai',
                resource: MCP,
                tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
                scopes,
                savedAt: '2026-11-01T00:00:00.000Z',
                signedInAs: null,
                cloudProject: null,
            });
        await writeLogin();
        const environment: Record<string, string> = {};
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                const message = JSON.parse(await request.text());
                calls.push({
                    name: message.params.name,
                    arguments: message.params.arguments,
                    requestId: request.headers.get('x-request-id'),
                    auth: request.headers.get('authorization') ?? '',
                });
                // As Cloud does: the strict report schema refuses a report missing a field.
                if (message.params.arguments.impact === undefined)
                    return Response.json({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32602,
                            message: 'Invalid Dexto feedback input.',
                            data: { kind: 'invalid_arguments' },
                        },
                    });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(RECEIPT) }],
                        structuredContent: RECEIPT,
                    },
                });
            },
            prompt: null,
            readStdin: async () => stdin,
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            stdoutIsTerminal: false,
            writeBytes: async () => undefined,
            writeError: (text) => {
                stderr += text;
            },
            writeOutput: (text) => {
                stdout += text;
            },
        };
        host = {
            commands: cloudCommands(dir, unusedSignIn),
            signIn: unusedSignIn,
            groups: CLOUD_GROUPS,
            runtime,
            resolveConnection: async (overrides) => {
                await writeLogin();
                return resolveConnection({
                    dir,
                    environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                });
            },
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('sends the report from a file unchanged and prints the receipt with its request id', async () => {
        const file = path.join(path.dirname(dir), 'report.json');
        await writeFile(file, JSON.stringify(REPORT));

        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--file',
                file,
                '--request-id',
                'report-1',
                '--yes',
                '--json',
            ])
        ).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_feedback_submit',
                arguments: REPORT,
                requestId: 'report-1',
                auth: `Bearer ${TOKEN}`,
            },
        ]);
        expect(JSON.parse(stdout)).toEqual({ ...RECEIPT, requestId: 'report-1' });
        expect(stderr).toContain('Request id: report-1');
    });

    it('reads the report from stdin and names the request itself when no id is given', async () => {
        stdin = JSON.stringify(REPORT);

        expect(await runCloud(host, ['feedback', 'submit', '--file', '-', '--yes', '--json'])).toBe(
            0
        );

        const requestId = calls[0]?.requestId;
        expect(requestId).toMatch(/^[\da-f-]{36}$/u);
        expect(calls[0]?.arguments).toEqual(REPORT);
        // Printed before the call, so a retry after a lost response can reuse it.
        expect(stderr).toContain(`Request id: ${requestId}`);
        expect(JSON.parse(stdout)).toEqual({ ...RECEIPT, requestId });
    });

    it('sends a retry under the same request id it is given', async () => {
        const args = ['feedback', 'submit', '--data', JSON.stringify(REPORT), '--yes'];

        expect(await runCloud(host, [...args, '--request-id', 'report-2'])).toBe(0);
        expect(await runCloud(host, [...args, '--request-id', 'report-2'])).toBe(0);

        expect(calls.map((call) => call.requestId)).toEqual(['report-2', 'report-2']);
    });

    it('refuses a request id Cloud would not keep, before calling', async () => {
        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--data',
                JSON.stringify(REPORT),
                '--request-id',
                'has spaces',
                '--yes',
            ])
        ).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it('submits only once agreed', async () => {
        const args = ['feedback', 'submit', '--data', JSON.stringify(REPORT)];

        expect(await runCloud(host, args)).toBe(4);
        expect(JSON.parse(stderr).error.fix).toContain('--yes');
        expect(calls).toHaveLength(0);
    });

    it('shows the call without sending it on --dry-run', async () => {
        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--data',
                JSON.stringify(REPORT),
                '--request-id',
                'report-3',
                '--dry-run',
                '--json',
            ])
        ).toBe(0);

        expect(calls).toHaveLength(0);
        expect(JSON.parse(stdout)).toEqual({
            dryRun: true,
            tool: 'dexto_feedback_submit',
            requestId: 'report-3',
            arguments: REPORT,
        });
    });

    it('refuses a missing, malformed or non-object report before calling', async () => {
        expect(await runCloud(host, ['feedback', 'submit', '--yes'])).toBe(2);
        expect(await runCloud(host, ['feedback', 'submit', '--data', '{"summary":', '--yes'])).toBe(
            2
        );
        expect(await runCloud(host, ['feedback', 'submit', '--data', '["a"]', '--yes'])).toBe(2);
        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--data',
                '{}',
                '--file',
                'report.json',
                '--yes',
            ])
        ).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it("leaves field validation to Cloud and exits 2 with Cloud's message", async () => {
        const { impact: _impact, ...missingImpact } = REPORT;

        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--data',
                JSON.stringify(missingImpact),
                '--yes',
                '--json',
            ])
        ).toBe(2);

        expect(calls).toHaveLength(1);
        // The request id note comes first, so a retry can reuse it; the error follows.
        expect(stderr).toMatch(new RegExp(`^Request id: ${calls[0]?.requestId}\n`, 'u'));
        expect(JSON.parse(stderr.slice(stderr.indexOf('{'))).error).toMatchObject({
            code: 'invalid_input',
            message: 'Invalid Dexto feedback input.',
        });
    });

    it('asks to sign in again for feedback:write before calling', async () => {
        scopes = ['cloud:read'];

        expect(
            await runCloud(host, [
                'feedback',
                'submit',
                '--data',
                JSON.stringify(REPORT),
                '--yes',
                '--json',
            ])
        ).toBe(3);

        expect(calls).toHaveLength(0);
        const error = JSON.parse(stderr).error;
        expect(error.code).toBe('needs_permission');
        expect(error.fix).toContain('--scope feedback:write');
    });

    it('never prints the sign-in token, on success or failure', async () => {
        const { impact: _impact, ...missingImpact } = REPORT;
        await runCloud(host, ['feedback', 'submit', '--data', JSON.stringify(REPORT), '--yes']);
        await runCloud(host, [
            'feedback',
            'submit',
            '--data',
            JSON.stringify(missingImpact),
            '--yes',
        ]);

        expect(calls).toHaveLength(2);
        expect(stdout + stderr).not.toContain(TOKEN);
        expect(stdout + stderr).not.toContain('refresh-feedback-secret');
    });
});
