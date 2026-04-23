import { promises as fs } from 'fs';
import path from 'path';
import { createMessageStream } from '@dexto/client-sdk';
import type { StreamingEvent } from '@dexto/core';
import { z } from 'zod';
import { getAuthToken, getDextoApiKey, loadAuth } from '../../auth/service.js';
import type { DeployAgent } from './config.js';

const SANDBOX_URL_ENV_VAR = 'DEXTO_SANDBOX_URL';
const DEFAULT_SANDBOX_URL = 'https://sandbox.dexto.ai';

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

const CloudAgentListItemSchema = z
    .object({
        cloudAgentId: z.string(),
        name: z.string().nullable().optional(),
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

const ListResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        data: z
            .object({
                cloudAgents: z.array(CloudAgentListItemSchema),
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

const CloudChatContentPartSchema = z
    .discriminatedUnion('type', [
        z
            .object({
                type: z.literal('text'),
                text: z.string(),
            })
            .strict(),
        z
            .object({
                type: z.literal('image'),
                image: z.string(),
                mimeType: z.string().optional(),
            })
            .strict(),
        z
            .object({
                type: z.literal('file'),
                data: z.string(),
                mimeType: z.string(),
                filename: z.string().optional(),
            })
            .strict(),
    ])
    .describe('Cloud chat content part');

const CloudChatSessionSchema = z
    .object({
        id: z.string(),
        createdAt: z.number().nullable().optional(),
        lastActivity: z.number().nullable().optional(),
        messageCount: z.number().int().nonnegative().optional(),
        title: z.string().nullable().optional(),
        workspaceId: z.string().nullable().optional(),
        parentSessionId: z.string().nullable().optional(),
    })
    .passthrough();

const CloudChatSessionListResponseSchema = z
    .object({
        sessions: z.array(CloudChatSessionSchema),
    })
    .passthrough();

const CloudChatSessionResponseSchema = z
    .object({
        session: CloudChatSessionSchema,
    })
    .passthrough();

const CloudChatHistoryMessageSchema = z
    .object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.array(CloudChatContentPartSchema),
        timestamp: z.number().optional(),
        name: z.string().optional(),
        toolCallId: z.string().optional(),
        success: z.boolean().optional(),
        reasoning: z.string().optional(),
        model: z.string().optional(),
        provider: z.string().optional(),
        displayData: z.unknown().optional(),
        presentationSnapshot: z.unknown().optional(),
    })
    .passthrough();

const CloudChatHistoryResponseSchema = z
    .object({
        history: z.array(CloudChatHistoryMessageSchema),
        isBusy: z.boolean().optional(),
        stale: z.boolean().optional(),
    })
    .passthrough();

const CloudChatApprovalsResponseSchema = z
    .object({
        approvals: z.array(z.unknown()).default([]),
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

export interface CloudAgentListItemResult {
    cloudAgentId: string;
    name: string | null;
    agentUrl: string;
    state: z.output<typeof CloudAgentStateSchema>;
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

export interface CloudChatSessionResult {
    id: string;
    createdAt: number | null;
    lastActivity: number | null;
    messageCount: number;
    title: string | null;
    workspaceId: string | null;
    parentSessionId: string | null;
}

export interface CloudChatHistoryMessageResult {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: z.output<typeof CloudChatContentPartSchema>[];
    timestamp?: number;
    name?: string;
    toolCallId?: string;
    success?: boolean;
    reasoning?: string;
    model?: string;
    provider?: string;
}

export interface CloudChatHistoryResult {
    history: CloudChatHistoryMessageResult[];
    isBusy: boolean;
    stale: boolean;
}

export interface CloudChatApprovalDecision {
    status: 'approved' | 'denied' | 'cancelled';
    formData?: Record<string, unknown>;
    rememberChoice?: boolean;
    rememberPattern?: string;
    rememberDirectory?: boolean;
    reason?: string;
    message?: string;
}

function normalizeCloudChatSession(
    session: z.output<typeof CloudChatSessionSchema>
): CloudChatSessionResult {
    return {
        id: session.id,
        createdAt: session.createdAt ?? null,
        lastActivity: session.lastActivity ?? null,
        messageCount: session.messageCount ?? 0,
        title: session.title ?? null,
        workspaceId: session.workspaceId ?? null,
        parentSessionId: session.parentSessionId ?? null,
    };
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

export function resolveSandboxBaseUrl(): string {
    const explicit = process.env[SANDBOX_URL_ENV_VAR]?.trim();
    if (explicit && explicit.length > 0) {
        return explicit.replace(/\/+$/, '');
    }

    const apiUrl = process.env.DEXTO_API_URL?.trim();
    if (apiUrl?.startsWith('http://localhost:')) {
        return 'http://localhost:3004';
    }

    return DEFAULT_SANDBOX_URL;
}

async function resolveAccessToken(): Promise<string> {
    const auth = await loadAuth();
    const storedDextoApiKey = auth?.dextoApiKey?.trim();
    if (storedDextoApiKey && storedDextoApiKey.length > 0) {
        return storedDextoApiKey;
    }

    const authToken = await getAuthToken();
    if (authToken && authToken.trim().length > 0) {
        return authToken.trim();
    }

    const dextoApiKey = await getDextoApiKey();
    if (dextoApiKey && dextoApiKey.trim().length > 0) {
        return dextoApiKey.trim();
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

type SuccessEnvelope = {
    success: boolean;
    error?: string | undefined;
    data?: unknown;
};

function requireSuccessData<T extends z.ZodType<SuccessEnvelope, unknown>>(
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
            agent: DeployAgent;
            snapshotPath: string;
            cloudAgentId?: string;
        }): Promise<DeployCloudAgentResult> {
            const snapshotBuffer = await fs.readFile(input.snapshotPath);
            const formData = new globalThis.FormData();
            formData.set('agentType', input.agent.type);
            if (input.agent.type === 'workspace') {
                formData.set('entryAgent', input.agent.path);
            }
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

        async listCloudAgents(): Promise<CloudAgentListItemResult[]> {
            const response = await request('/cloud-agents/list', {
                method: 'GET',
            });
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = await parseJsonResponse(response);
            const data = requireSuccessData(payload, response, ListResponseSchema);
            return data.cloudAgents.map((cloudAgent) => ({
                cloudAgentId: cloudAgent.cloudAgentId,
                name: cloudAgent.name ?? null,
                agentUrl: cloudAgent.agentUrl,
                state: cloudAgent.state,
            }));
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

        async listCloudAgentSessions(cloudAgentId: string): Promise<CloudChatSessionResult[]> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions`,
                {
                    method: 'GET',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = CloudChatSessionListResponseSchema.parse(await response.json());
            return payload.sessions.map(normalizeCloudChatSession);
        },

        async createCloudAgentSession(
            cloudAgentId: string,
            input?: { sessionId?: string }
        ): Promise<CloudChatSessionResult> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(input ?? {}),
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = CloudChatSessionResponseSchema.parse(await response.json());
            return normalizeCloudChatSession(payload.session);
        },

        async getCloudAgentSessionHistory(
            cloudAgentId: string,
            sessionId: string
        ): Promise<CloudChatHistoryResult> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}/history`,
                {
                    method: 'GET',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = CloudChatHistoryResponseSchema.parse(await response.json());
            return {
                history: payload.history.map((entry) => ({
                    role: entry.role,
                    content: entry.content,
                    ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
                    ...(entry.name !== undefined ? { name: entry.name } : {}),
                    ...(entry.toolCallId !== undefined ? { toolCallId: entry.toolCallId } : {}),
                    ...(entry.success !== undefined ? { success: entry.success } : {}),
                    ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
                    ...(entry.model !== undefined ? { model: entry.model } : {}),
                    ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
                })),
                isBusy: payload.isBusy ?? false,
                stale: payload.stale === true,
            };
        },

        async resetCloudAgentSession(cloudAgentId: string, sessionId: string): Promise<void> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}/reset`,
                {
                    method: 'POST',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }
        },

        async clearCloudAgentSessionContext(
            cloudAgentId: string,
            sessionId: string
        ): Promise<void> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}/clear-context`,
                {
                    method: 'POST',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }
        },

        async deleteCloudAgentSession(cloudAgentId: string, sessionId: string): Promise<void> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}`,
                {
                    method: 'DELETE',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }
        },

        async generateCloudAgentSessionTitle(
            cloudAgentId: string,
            sessionId: string
        ): Promise<{ title: string | null; sessionId: string } | null> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}/generate-title`,
                {
                    method: 'POST',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = z
                .object({
                    title: z.string().nullable().optional(),
                    sessionId: z.string().optional(),
                })
                .passthrough()
                .parse(await response.json());

            return {
                title: payload.title ?? null,
                sessionId: payload.sessionId ?? sessionId,
            };
        },

        async cancelCloudAgentSessionRun(cloudAgentId: string, sessionId: string): Promise<void> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
                {
                    method: 'POST',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }
        },

        async listCloudAgentApprovals(cloudAgentId: string, sessionId: string): Promise<unknown[]> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/approvals?sessionId=${encodeURIComponent(sessionId)}`,
                {
                    method: 'GET',
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }

            const payload = CloudChatApprovalsResponseSchema.parse(await response.json());
            return payload.approvals;
        },

        async submitCloudAgentApproval(
            cloudAgentId: string,
            approvalId: string,
            decision: CloudChatApprovalDecision
        ): Promise<void> {
            const response = await request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/approvals/${encodeURIComponent(approvalId)}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        status: decision.status,
                        ...(decision.formData !== undefined ? { formData: decision.formData } : {}),
                        ...(decision.rememberChoice !== undefined
                            ? { rememberChoice: decision.rememberChoice }
                            : {}),
                        ...(decision.rememberPattern !== undefined
                            ? { rememberPattern: decision.rememberPattern }
                            : {}),
                        ...(decision.rememberDirectory !== undefined
                            ? { rememberDirectory: decision.rememberDirectory }
                            : {}),
                        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
                        ...(decision.message !== undefined ? { message: decision.message } : {}),
                    }),
                }
            );
            if (!response.ok) {
                await throwApiError(response);
            }
        },

        async streamCloudAgentMessage(
            cloudAgentId: string,
            input: {
                sessionId: string;
                content: string;
                signal?: AbortSignal;
            }
        ): Promise<AsyncIterableIterator<StreamingEvent>> {
            const responsePromise = request(
                `/cloud-agents/${encodeURIComponent(cloudAgentId)}/agent/message-stream`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'text/event-stream',
                    },
                    body: JSON.stringify({
                        sessionId: input.sessionId,
                        content: input.content,
                    }),
                    ...(input.signal ? { signal: input.signal } : {}),
                }
            );

            const response = await responsePromise;
            if (
                response.status === 202 &&
                response.headers.get('content-type')?.includes('application/json')
            ) {
                const busyPayload = await response.json().catch(() => null);
                const parsed = z
                    .object({
                        hint: z.string().optional(),
                    })
                    .passthrough()
                    .safeParse(busyPayload);
                throw new Error(
                    parsed.success
                        ? (parsed.data.hint ?? 'Cloud session is busy')
                        : 'Cloud session is busy'
                );
            }

            return createMessageStream(Promise.resolve(response), {
                ...(input.signal ? { signal: input.signal } : {}),
            });
        },
    };
}
