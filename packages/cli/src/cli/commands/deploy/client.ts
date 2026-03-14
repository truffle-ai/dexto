import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { getAuthToken, getDextoApiKey } from '../../auth/service.js';

const SANDBOX_URL_ENV_VAR = 'DEXTO_SANDBOX_URL';

type RequestHeaders = Record<string, string> | Array<[string, string]>;

const CloudAgentStateSchema = z
    .object({
        status: z.string(),
    })
    .passthrough();

const CloudAgentSummarySchema = z
    .object({
        runId: z.string(),
        agentUrl: z.string(),
        hostUrl: z.string().nullable().optional(),
        state: CloudAgentStateSchema,
    })
    .passthrough();

const DeployResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        data: z
            .object({
                cloudAgentId: z.string(),
                agentUrl: z.string(),
                cloudAgent: CloudAgentSummarySchema,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const StatusResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        data: z
            .object({
                cloudAgentId: z.string(),
                agentUrl: z.string(),
                cloudAgent: CloudAgentSummarySchema,
                stale: z.boolean().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const StopResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        data: z
            .object({
                cloudAgentId: z.string(),
                agentUrl: z.string(),
                stopped: z.boolean(),
                alreadyStopped: z.boolean(),
                snapshotStatus: z.string(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const DeleteResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        data: z
            .object({
                cloudAgentId: z.string(),
                agentUrl: z.string(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export interface DeployCloudAgentResult {
    cloudAgentId: string;
    agentUrl: string;
    state: z.output<typeof CloudAgentStateSchema>;
}

export interface CloudAgentStatusResult {
    cloudAgentId: string;
    agentUrl: string;
    state: z.output<typeof CloudAgentStateSchema>;
    stale: boolean;
}

export interface CloudAgentStopResult {
    cloudAgentId: string;
    agentUrl: string;
    stopped: boolean;
    alreadyStopped: boolean;
    snapshotStatus: string;
}

export interface CloudAgentDeleteResult {
    cloudAgentId: string;
    agentUrl: string;
}

class SandboxApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        Object.setPrototypeOf(this, SandboxApiError.prototype);
        this.name = 'SandboxApiError';
        this.status = status;
    }
}

function resolveSandboxBaseUrl(): string {
    const explicit = process.env[SANDBOX_URL_ENV_VAR]?.trim();
    if (explicit && explicit.length > 0) {
        return explicit.replace(/\/+$/, '');
    }

    const apiUrl = process.env.DEXTO_API_URL?.trim();
    if (apiUrl?.startsWith('http://localhost:')) {
        return 'http://localhost:3004';
    }

    throw new Error(
        `Missing required environment variable: ${SANDBOX_URL_ENV_VAR}. Set it to your sandbox service URL before using \`dexto deploy\`.`
    );
}

async function resolveAccessToken(): Promise<string> {
    const dextoApiKey = await getDextoApiKey();
    if (dextoApiKey && dextoApiKey.trim().length > 0) {
        return dextoApiKey.trim();
    }

    const authToken = await getAuthToken();
    if (authToken && authToken.trim().length > 0) {
        return authToken.trim();
    }

    throw new Error('Authentication required. Run `dexto login` before using `dexto deploy`.');
}

async function parseJsonResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return null;
    }
    return response.json().catch(() => null);
}

async function request(
    pathName: string,
    init: Omit<RequestInit, 'headers'> & { headers?: RequestHeaders }
): Promise<Response> {
    const accessToken = await resolveAccessToken();
    const headers = new globalThis.Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);

    return fetch(`${resolveSandboxBaseUrl()}/api${pathName}`, {
        ...init,
        headers,
    });
}

function requireSuccessData<T extends z.ZodTypeAny>(
    payload: unknown,
    response: Response,
    schema: T
): NonNullable<z.output<T>['data']> {
    const parsed = schema.parse(payload);
    if (!parsed.success || !parsed.data) {
        throw new SandboxApiError(parsed.error ?? 'Sandbox request failed', response.status);
    }
    return parsed.data;
}

async function throwApiError(response: Response): Promise<never> {
    const payload = await parseJsonResponse(response);
    const parsed =
        payload && typeof payload === 'object' && payload !== null && 'error' in payload
            ? z
                  .object({
                      error: z.string().optional(),
                      hint: z.string().optional(),
                  })
                  .passthrough()
                  .safeParse(payload)
            : null;
    const errorMessage =
        parsed?.success && parsed.data.error
            ? parsed.data.hint
                ? `${parsed.data.error} (${parsed.data.hint})`
                : parsed.data.error
            : `Sandbox request failed with status ${response.status}`;
    throw new SandboxApiError(errorMessage, response.status);
}

export function createDeployClient() {
    return {
        async deployWorkspace(input: {
            entryAgent: string;
            snapshotPath: string;
            cloudAgentId?: string;
        }): Promise<DeployCloudAgentResult> {
            const snapshotBuffer = await fs.readFile(input.snapshotPath);
            const formData = new globalThis.FormData();
            formData.set('entryAgent', input.entryAgent);
            if (input.cloudAgentId && input.cloudAgentId.trim().length > 0) {
                formData.set('cloudAgentId', input.cloudAgentId.trim());
            }
            formData.set(
                'workspaceSnapshot',
                new globalThis.File(
                    [new Uint8Array(snapshotBuffer)],
                    path.basename(input.snapshotPath),
                    {
                        type: 'application/gzip',
                    }
                )
            );

            const response = await request('/cloud-agents/deploy', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = await parseJsonResponse(response);
            const data = requireSuccessData(payload, response, DeployResponseSchema);
            return {
                cloudAgentId: data.cloudAgentId,
                agentUrl: data.agentUrl,
                state: data.cloudAgent.state,
            };
        },

        async getCloudAgent(cloudAgentId: string): Promise<CloudAgentStatusResult> {
            const response = await request(`/cloud-agents/${encodeURIComponent(cloudAgentId)}`, {
                method: 'GET',
            });
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = await parseJsonResponse(response);
            const data = requireSuccessData(payload, response, StatusResponseSchema);
            return {
                cloudAgentId: data.cloudAgentId,
                agentUrl: data.agentUrl,
                state: data.cloudAgent.state,
                stale: data.stale === true,
            };
        },

        async stopCloudAgent(cloudAgentId: string): Promise<CloudAgentStopResult> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/stop`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = await parseJsonResponse(response);
            const data = requireSuccessData(payload, response, StopResponseSchema);
            return {
                cloudAgentId: data.cloudAgentId,
                agentUrl: data.agentUrl,
                stopped: data.stopped,
                alreadyStopped: data.alreadyStopped,
                snapshotStatus: data.snapshotStatus,
            };
        },

        async deleteCloudAgent(cloudAgentId: string): Promise<CloudAgentDeleteResult> {
            const response = await request(`/cloud-agents/${encodeURIComponent(cloudAgentId)}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = await parseJsonResponse(response);
            const data = requireSuccessData(payload, response, DeleteResponseSchema);
            return {
                cloudAgentId: data.cloudAgentId,
                agentUrl: data.agentUrl,
            };
        },
    };
}
