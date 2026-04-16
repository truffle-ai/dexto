import {
    AgentEventBus,
    logger,
    type ContentPart,
    type AgentEventMap,
    type DextoAgent,
    type InternalMessage,
    type QueuedMessage,
    type SearchOptions,
    type SearchResponse,
    type SearchResult,
    type SessionMetadata,
    type StreamingEvent,
} from '@dexto/core';
import { startInkCliRefactored, type TuiAgentBackend } from '@dexto/tui';
import { createDeployClient } from './commands/deploy/client.js';
import { loadWorkspaceDeployLink } from './commands/deploy/state.js';

export interface StartCloudChatCliOptions {
    cloudAgentId?: string;
    initialPrompt?: string;
    resume?: string;
    continueMostRecent?: boolean;
    workspaceRoot?: string;
}

type DeployClient = ReturnType<typeof createDeployClient>;
type CloudSession = Awaited<ReturnType<DeployClient['listCloudAgentSessions']>>[number];
type CloudHistoryEntry = Awaited<
    ReturnType<DeployClient['getCloudAgentSessionHistory']>
>['history'][number];
type CloudApprovalDecision = Parameters<DeployClient['submitCloudAgentApproval']>[2];

interface LLMConfig {
    provider: KnownProvider;
    model: string;
    baseURL?: string;
    reasoning?: { variant: string; budgetTokens?: number };
}

type CloudChatBackend = TuiAgentBackend;

const CLOUD_SUPPORTED_COMMANDS = [
    'help',
    'h',
    '?',
    'exit',
    'quit',
    'q',
    'new',
    'clear',
    'reset',
    'resume',
    'r',
    'search',
    'find',
    'export',
    'copy',
    'cp',
    'shortcuts',
    'docs',
    'doc',
    'login',
    'logout',
    'stream',
    'sounds',
] as const;

type KnownProvider = ReturnType<DextoAgent['getCurrentLLMConfig']>['provider'];

const KNOWN_PROVIDERS = new Set<KnownProvider>([
    'openai',
    'openai-compatible',
    'anthropic',
    'google',
    'groq',
    'xai',
    'cohere',
    'minimax',
    'glm',
    'openrouter',
    'litellm',
    'glama',
    'vertex',
    'bedrock',
    'local',
    'ollama',
    'dexto-nova',
]);

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function unsupportedCloudFeature(feature: string): Error {
    return new Error(`${feature} is not available while connected to a cloud agent.`);
}

function normalizeProvider(provider: string | undefined): KnownProvider | undefined {
    if (!provider || !KNOWN_PROVIDERS.has(provider as KnownProvider)) {
        return undefined;
    }
    return provider as KnownProvider;
}

function normalizeCloudParts(parts: CloudHistoryEntry['content']): ContentPart[] {
    return parts.map((part) => {
        if (part.type === 'text') {
            return {
                type: 'text' as const,
                text: part.text,
            };
        }

        if (part.type === 'image') {
            return {
                type: 'image' as const,
                image: part.image,
                ...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
            };
        }

        return {
            type: 'file' as const,
            data: part.data,
            mimeType: part.mimeType,
            ...(part.filename !== undefined ? { filename: part.filename } : {}),
        };
    });
}

function normalizeHistoryEntry(entry: CloudHistoryEntry, index: number): InternalMessage {
    const content = normalizeCloudParts(entry.content);

    if (entry.role === 'assistant') {
        const provider = normalizeProvider(entry.provider);
        return {
            role: 'assistant',
            content: content.length > 0 ? content : null,
            ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
            ...(entry.model !== undefined ? { model: entry.model } : {}),
            ...(provider ? { provider } : {}),
            ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
        };
    }

    if (entry.role === 'tool') {
        return {
            role: 'tool',
            content,
            toolCallId: entry.toolCallId ?? `cloud-tool-${index}`,
            name: entry.name ?? `tool-${index + 1}`,
            ...(entry.success !== undefined ? { success: entry.success } : {}),
            ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
        };
    }

    return {
        role: entry.role,
        content,
        ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
    };
}

function buildSessionMetadata(session: CloudSession): SessionMetadata {
    return {
        createdAt: session.createdAt ?? Date.now(),
        lastActivity: session.lastActivity ?? session.createdAt ?? Date.now(),
        messageCount: session.messageCount,
        ...(session.title ? { title: session.title } : {}),
    };
}

function extractTextContent(parts: ContentPart[]): string {
    return parts
        .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();
}

function contentInputToParts(input: Parameters<CloudChatBackend['stream']>[0]): ContentPart[] {
    return typeof input === 'string' ? [{ type: 'text', text: input }] : [...input];
}

function contentInputToCloudText(input: Parameters<CloudChatBackend['stream']>[0]): string {
    const parts = contentInputToParts(input);
    const unsupportedParts = parts.filter((part) => part.type !== 'text');
    if (unsupportedParts.length > 0) {
        throw unsupportedCloudFeature('Image and file attachments');
    }

    const text = extractTextContent(parts);
    if (!text) {
        throw new Error('Cloud chat messages must include text content.');
    }

    return text;
}

function contentPartsToCloudText(parts: ContentPart[]): string {
    return contentInputToCloudText(parts);
}

function combineQueuedContent(messages: QueuedMessage[]): ContentPart[] {
    return messages.flatMap((message) => message.content);
}

function buildQueuedMessage(id: string, content: ContentPart[]): QueuedMessage {
    return {
        id,
        content,
        queuedAt: Date.now(),
        kind: 'default',
    };
}

function extractMessageSearchText(message: InternalMessage): string {
    const content = message.role === 'assistant' ? (message.content ?? []) : message.content;
    const text = extractTextContent(content);
    if (message.role === 'assistant' && message.reasoning) {
        return [text, message.reasoning].filter(Boolean).join('\n');
    }
    return text;
}

function buildSearchContext(text: string, query: string): { matchedText: string; context: string } {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerQuery);
    if (matchIndex === -1) {
        return {
            matchedText: query,
            context: text.slice(0, 160),
        };
    }

    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(text.length, matchIndex + query.length + 100);
    return {
        matchedText: text.slice(matchIndex, matchIndex + query.length),
        context: text.slice(start, end).trim(),
    };
}

function emitStreamingEvent(eventBus: AgentEventBus, event: StreamingEvent): void {
    const { name, ...payload } = event;
    (eventBus.emit as (eventName: keyof AgentEventMap, payload: unknown) => void)(name, payload);
}

export function buildCloudApprovalDecision(
    approval: AgentEventMap['approval:response']
): CloudApprovalDecision | null {
    if (typeof approval.approvalId !== 'string' || typeof approval.status !== 'string') {
        return null;
    }

    const approvalData =
        typeof approval.data === 'object' && approval.data !== null
            ? (approval.data as {
                  rememberChoice?: boolean;
                  rememberPattern?: string;
                  rememberDirectory?: boolean;
                  formData?: Record<string, unknown>;
              })
            : undefined;

    return {
        status: approval.status,
        ...(approvalData?.formData !== undefined ? { formData: approvalData.formData } : {}),
        ...(approvalData?.rememberChoice !== undefined
            ? { rememberChoice: approvalData.rememberChoice }
            : {}),
        ...(approvalData?.rememberPattern !== undefined
            ? { rememberPattern: approvalData.rememberPattern }
            : {}),
        ...(approvalData?.rememberDirectory !== undefined
            ? { rememberDirectory: approvalData.rememberDirectory }
            : {}),
        ...(approval.reason !== undefined ? { reason: approval.reason } : {}),
        ...(approval.message !== undefined ? { message: approval.message } : {}),
    };
}

async function resolveCloudAgentId(options: StartCloudChatCliOptions): Promise<string> {
    const explicitCloudAgentId = options.cloudAgentId?.trim();
    if (explicitCloudAgentId) {
        return explicitCloudAgentId;
    }

    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const link = await loadWorkspaceDeployLink(workspaceRoot);
    if (link?.cloudAgentId) {
        return link.cloudAgentId;
    }

    throw new Error(
        'No cloud agent ID provided and this workspace is not linked to a deployment. Run `dexto deploy` first or pass a cloud agent ID.'
    );
}

async function resolveInitialSessionId(
    client: DeployClient,
    cloudAgentId: string,
    options: StartCloudChatCliOptions
): Promise<string | null> {
    const sessions = await client.listCloudAgentSessions(cloudAgentId);

    if (options.resume) {
        const requestedSession = sessions.find((session) => session.id === options.resume);
        if (!requestedSession) {
            throw new Error(`Cloud session '${options.resume}' not found for ${cloudAgentId}.`);
        }
        return requestedSession.id;
    }

    if (options.continueMostRecent) {
        const [mostRecentSession] = sessions
            .slice()
            .sort((left, right) => (right.lastActivity ?? 0) - (left.lastActivity ?? 0));
        return mostRecentSession?.id ?? null;
    }

    return null;
}

export function createCloudAgentBackend(
    client: DeployClient,
    cloudAgentId: string
): CloudChatBackend {
    const eventBus = new AgentEventBus();
    const sessionMetadataCache = new Map<string, SessionMetadata>();
    const sessionTitleCache = new Map<string, string | undefined>();
    const sessionModelCache = new Map<
        string,
        {
            model: string;
            provider?: KnownProvider;
        }
    >();
    const queueBySession = new Map<string, QueuedMessage[]>();
    const globalDisabledTools: string[] = [];
    const sessionDisabledTools = new Map<string, string[]>();
    const sessionAutoApproveTools = new Map<string, string[]>();
    const defaultLogFilePath = () => null;
    const defaultLogLevel: DextoAgent['logger']['getLevel'] = () => {
        return logger.getLevel() as ReturnType<DextoAgent['logger']['getLevel']>;
    };
    const backendLogger: CloudChatBackend['logger'] = {
        debug: (message: string, context?: Record<string, unknown>) => {
            logger.debug(message, context);
        },
        info: (message: string, context?: Record<string, unknown>) => {
            logger.info(message, context);
        },
        warn: (message: string, context?: Record<string, unknown>) => {
            logger.warn(message, context);
        },
        error: (message: string, context?: Record<string, unknown>) => {
            logger.error(message, context);
        },
        getLevel: defaultLogLevel,
        getLogFilePath: defaultLogFilePath,
    };

    const ensureSessionMetadata = async (
        sessionId: string
    ): Promise<SessionMetadata | undefined> => {
        const cached = sessionMetadataCache.get(sessionId);
        if (cached) {
            return cached;
        }

        const sessions = await client.listCloudAgentSessions(cloudAgentId);
        for (const session of sessions) {
            const metadata = buildSessionMetadata(session);
            sessionMetadataCache.set(session.id, metadata);
            sessionTitleCache.set(session.id, metadata.title);
        }

        return sessionMetadataCache.get(sessionId);
    };

    const hydrateSessionHistory = async (sessionId: string): Promise<InternalMessage[]> => {
        const historyResult = await client.getCloudAgentSessionHistory(cloudAgentId, sessionId);
        const history = historyResult.history.map(normalizeHistoryEntry);
        const latestAssistant = [...history]
            .reverse()
            .find((message): message is Extract<InternalMessage, { role: 'assistant' }> => {
                return message.role === 'assistant' && typeof message.model === 'string';
            });

        if (latestAssistant?.model) {
            sessionModelCache.set(sessionId, {
                model: latestAssistant.model,
                ...(latestAssistant.provider ? { provider: latestAssistant.provider } : {}),
            });
        }

        return history;
    };

    const dequeueQueuedMessages = (sessionId: string): QueuedMessage[] => {
        const queued = queueBySession.get(sessionId) ?? [];
        queueBySession.delete(sessionId);
        return queued;
    };

    const appendQueuedMessage = (sessionId: string, message: QueuedMessage): number => {
        const current = queueBySession.get(sessionId) ?? [];
        const next = [...current, message];
        queueBySession.set(sessionId, next);
        return next.length;
    };

    const currentLLMConfig = (sessionId?: string): LLMConfig => {
        const cachedModel = sessionId ? sessionModelCache.get(sessionId) : undefined;
        return {
            provider: cachedModel?.provider ?? 'dexto-nova',
            model: cachedModel?.model ?? 'cloud-agent',
        };
    };

    const sessionLogger: Awaited<ReturnType<CloudChatBackend['createSession']>>['logger'] = {
        getLogFilePath: defaultLogFilePath,
        getLevel: defaultLogLevel,
    };

    const backend: CloudChatBackend = {
        logger: backendLogger,
        config: {
            agentId: cloudAgentId,
        },
        capabilities: {
            supportedCommands: [...CLOUD_SUPPORTED_COMMANDS],
            prompts: false,
            resources: false,
            attachments: false,
            reasoningCycle: false,
            contextStats: false,
            startupInfo: false,
        },
        sessionManager: {
            getSessionMetadata: async (sessionId) => await ensureSessionMetadata(sessionId),
            getSessionStats: async () => {
                const sessions = await client.listCloudAgentSessions(cloudAgentId);
                return {
                    totalSessions: sessions.length,
                    inMemorySessions: sessions.length,
                    maxSessions: Number.MAX_SAFE_INTEGER,
                };
            },
        },
        mcpManager: {
            getClients: () => new Map(),
            getFailedConnections: () => ({}),
        },
        toolManager: {
            addSessionAutoApproveTools: async () => {},
        },
        services: {
            hookManager: {
                getHookNames: () => [],
            },
        },

        on: ((eventName, listener, options) => {
            eventBus.on(eventName, listener as never, options);
        }) as CloudChatBackend['on'],
        emit: ((eventName, ...args) => {
            const payload = args[0] as AgentEventMap[typeof eventName];
            if (eventName === 'approval:response') {
                const approval = payload as AgentEventMap['approval:response'];
                const decision = buildCloudApprovalDecision(approval);

                if (decision) {
                    void client
                        .submitCloudAgentApproval(cloudAgentId, approval.approvalId, decision)
                        .catch((error: unknown) => {
                            backendLogger.error('Failed to submit cloud approval response', {
                                cloudAgentId,
                                approvalId: approval.approvalId,
                                status: approval.status,
                                error: getErrorMessage(error),
                            });
                        });
                }
            }

            return (eventBus.emit as (eventName: keyof AgentEventMap, payload: unknown) => boolean)(
                eventName,
                payload
            );
        }) as CloudChatBackend['emit'],

        stream: (async (content, sessionId, options) => {
            const initialText = contentInputToCloudText(content);
            const signal = options?.signal;

            const iterator = async function* (): AsyncIterableIterator<StreamingEvent> {
                let currentText = initialText;

                for (;;) {
                    const upstream = await client.streamCloudAgentMessage(cloudAgentId, {
                        sessionId,
                        content: currentText,
                        ...(signal ? { signal } : {}),
                    });

                    let pendingRunComplete: StreamingEvent | null = null;

                    for await (const event of upstream) {
                        if (event.name === 'llm:response' && event.sessionId === sessionId) {
                            if (typeof event.model === 'string') {
                                sessionModelCache.set(sessionId, {
                                    model: event.model,
                                    ...(event.provider ? { provider: event.provider } : {}),
                                });
                            }
                        }

                        if (
                            event.name === 'session:title-updated' &&
                            event.sessionId === sessionId
                        ) {
                            sessionTitleCache.set(sessionId, event.title);
                            const metadata = await ensureSessionMetadata(sessionId);
                            if (metadata) {
                                sessionMetadataCache.set(sessionId, {
                                    ...metadata,
                                    title: event.title,
                                });
                            }
                        }

                        if (event.name === 'run:complete') {
                            pendingRunComplete = event;
                            continue;
                        }

                        emitStreamingEvent(eventBus, event);
                        yield event;
                    }

                    const queuedMessages = dequeueQueuedMessages(sessionId);
                    if (queuedMessages.length === 0) {
                        if (pendingRunComplete) {
                            emitStreamingEvent(eventBus, pendingRunComplete);
                            yield pendingRunComplete;
                        }
                        break;
                    }

                    const combinedContent = combineQueuedContent(queuedMessages);
                    const dequeuedEvent: StreamingEvent = {
                        name: 'message:dequeued',
                        sessionId,
                        count: queuedMessages.length,
                        ids: queuedMessages.map((message) => message.id),
                        coalesced: queuedMessages.length > 1,
                        content: combinedContent,
                        messages: queuedMessages,
                    };
                    emitStreamingEvent(eventBus, dequeuedEvent);
                    yield dequeuedEvent;
                    currentText = contentPartsToCloudText(combinedContent);
                }
            };

            return iterator();
        }) as CloudChatBackend['stream'],

        stop: (async () => {}) as CloudChatBackend['stop'],

        run: (async () => {
            throw unsupportedCloudFeature('Prompt execution');
        }) as CloudChatBackend['run'],

        createSession: (async (sessionId) => {
            const session = await client.createCloudAgentSession(
                cloudAgentId,
                sessionId ? { sessionId } : undefined
            );
            const metadata = buildSessionMetadata(session);
            sessionMetadataCache.set(session.id, metadata);
            sessionTitleCache.set(session.id, metadata.title);
            return {
                id: session.id,
                logger: sessionLogger,
            };
        }) as CloudChatBackend['createSession'],

        listSessions: (async () => {
            const sessions = await client.listCloudAgentSessions(cloudAgentId);
            for (const session of sessions) {
                const metadata = buildSessionMetadata(session);
                sessionMetadataCache.set(session.id, metadata);
                sessionTitleCache.set(session.id, metadata.title);
            }
            return sessions.map((session) => session.id);
        }) as CloudChatBackend['listSessions'],

        getSession: (async (sessionId) => {
            await ensureSessionMetadata(sessionId);
            return {
                id: sessionId,
                logger: sessionLogger,
            };
        }) as CloudChatBackend['getSession'],

        getSessionMetadata: (async (sessionId) =>
            await ensureSessionMetadata(sessionId)) as CloudChatBackend['getSessionMetadata'],

        getSessionHistory: (async (sessionId) =>
            await hydrateSessionHistory(sessionId)) as CloudChatBackend['getSessionHistory'],

        getSessionTitle: (async (sessionId) => {
            const cachedTitle = sessionTitleCache.get(sessionId);
            if (cachedTitle !== undefined) {
                return cachedTitle;
            }
            return (await ensureSessionMetadata(sessionId))?.title;
        }) as CloudChatBackend['getSessionTitle'],

        setSessionTitle: (async () => {
            throw unsupportedCloudFeature('Session renaming');
        }) as CloudChatBackend['setSessionTitle'],

        generateSessionTitle: (async (sessionId) => {
            const result = await client.generateCloudAgentSessionTitle(cloudAgentId, sessionId);
            const title = result?.title ?? undefined;
            sessionTitleCache.set(sessionId, title);
            const metadata = await ensureSessionMetadata(sessionId);
            if (metadata) {
                sessionMetadataCache.set(sessionId, {
                    ...metadata,
                    ...(title ? { title } : {}),
                });
            }
            if (title) {
                eventBus.emit('session:title-updated', {
                    sessionId,
                    title,
                });
            }
            return title;
        }) as CloudChatBackend['generateSessionTitle'],

        forkSession: (async () => {
            throw unsupportedCloudFeature('Session forking');
        }) as CloudChatBackend['forkSession'],

        getCurrentLLMConfig: ((sessionId) =>
            currentLLMConfig(sessionId)) as CloudChatBackend['getCurrentLLMConfig'],

        hasSessionLLMOverride: (() => false) as CloudChatBackend['hasSessionLLMOverride'],

        switchLLM: (async () => {
            throw unsupportedCloudFeature('Model switching');
        }) as CloudChatBackend['switchLLM'],

        getSupportedProviders: (() => []) as CloudChatBackend['getSupportedProviders'],
        getSupportedModels: (() => ({})) as CloudChatBackend['getSupportedModels'],

        getContextStats: (async () => {
            throw unsupportedCloudFeature('Context statistics');
        }) as CloudChatBackend['getContextStats'],

        clearContext: (async (sessionId) => {
            await client.clearCloudAgentSessionContext(cloudAgentId, sessionId);
            queueBySession.delete(sessionId);
            eventBus.emit('context:cleared', { sessionId });
        }) as CloudChatBackend['clearContext'],

        compactContext: (async () => {
            throw unsupportedCloudFeature('Context compaction');
        }) as CloudChatBackend['compactContext'],

        queueMessage: (async (sessionId, input) => {
            const messageId = `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const message = buildQueuedMessage(messageId, [...input.content]);
            const position = appendQueuedMessage(sessionId, message);
            eventBus.emit('message:queued', {
                id: message.id,
                position,
                sessionId,
            });
            return {
                queued: true as const,
                position,
                id: message.id,
            };
        }) as CloudChatBackend['queueMessage'],

        getQueuedMessages: (async (sessionId) =>
            queueBySession.get(sessionId) ?? []) as CloudChatBackend['getQueuedMessages'],

        removeQueuedMessage: (async (sessionId, messageId) => {
            const current = queueBySession.get(sessionId) ?? [];
            const next = current.filter((message) => message.id !== messageId);
            queueBySession.set(sessionId, next);
            eventBus.emit('message:removed', {
                id: messageId,
                sessionId,
            });
            return true;
        }) as CloudChatBackend['removeQueuedMessage'],

        clearMessageQueue: (async (sessionId) => {
            if (typeof sessionId === 'string') {
                const clearedCount = (queueBySession.get(sessionId) ?? []).length;
                queueBySession.delete(sessionId);
                return clearedCount;
            }
            const clearedCount = Array.from(queueBySession.values()).reduce(
                (total, queuedMessages) => total + queuedMessages.length,
                0
            );
            queueBySession.clear();
            return clearedCount;
        }) as CloudChatBackend['clearMessageQueue'],

        cancel: (async (sessionId) => {
            await client.cancelCloudAgentSessionRun(cloudAgentId, sessionId);
            return true;
        }) as CloudChatBackend['cancel'],

        searchMessages: (async (query, options = {} as SearchOptions) => {
            const normalizedQuery = query.trim();
            if (!normalizedQuery) {
                return {
                    results: [],
                    total: 0,
                    hasMore: false,
                    query,
                    options,
                } satisfies SearchResponse;
            }

            const sessionIds = options.sessionId
                ? [options.sessionId]
                : await backend.listSessions();
            const results: SearchResult[] = [];

            for (const sessionId of sessionIds) {
                const history = await backend.getSessionHistory(sessionId);
                history.forEach((message, messageIndex) => {
                    if (options.role && message.role !== options.role) {
                        return;
                    }

                    const searchableText = extractMessageSearchText(message);
                    if (!searchableText.toLowerCase().includes(normalizedQuery.toLowerCase())) {
                        return;
                    }

                    const { matchedText, context } = buildSearchContext(
                        searchableText,
                        normalizedQuery
                    );

                    results.push({
                        sessionId,
                        message,
                        matchedText,
                        context,
                        messageIndex,
                    });
                });
            }

            results.sort((left, right) => {
                const leftTimestamp = left.message.timestamp ?? 0;
                const rightTimestamp = right.message.timestamp ?? 0;
                return rightTimestamp - leftTimestamp;
            });

            const offset = options.offset ?? 0;
            const limit = options.limit ?? 20;
            const pagedResults = results.slice(offset, offset + limit);

            return {
                results: pagedResults,
                total: results.length,
                hasMore: offset + limit < results.length,
                query,
                options,
            } satisfies SearchResponse;
        }) as CloudChatBackend['searchMessages'],

        listPrompts: (async () => ({})) as CloudChatBackend['listPrompts'],
        refreshPrompts: (async () => {}) as CloudChatBackend['refreshPrompts'],
        resolvePrompt: (async () => {
            throw unsupportedCloudFeature('Prompt resolution');
        }) as CloudChatBackend['resolvePrompt'],
        getSystemPrompt: (async () => '') as CloudChatBackend['getSystemPrompt'],
        loadToolkits: (async (toolkits) => ({
            loaded: [...toolkits],
            skipped: [],
        })) as CloudChatBackend['loadToolkits'],
        listResources: (async () => ({})) as CloudChatBackend['listResources'],

        setLogLevel: (async () => {}) as CloudChatBackend['setLogLevel'],
        getAllTools: (async () => ({})) as CloudChatBackend['getAllTools'],
        getEnabledTools: (async () => ({})) as CloudChatBackend['getEnabledTools'],
        getAllMcpTools: (async () => ({})) as CloudChatBackend['getAllMcpTools'],

        setGlobalDisabledTools: ((toolNames) => {
            globalDisabledTools.splice(0, globalDisabledTools.length, ...toolNames);
        }) as CloudChatBackend['setGlobalDisabledTools'],

        setSessionDisabledTools: (async (sessionId, toolNames) => {
            sessionDisabledTools.set(sessionId, [...toolNames]);
        }) as CloudChatBackend['setSessionDisabledTools'],

        setSessionAutoApproveTools: (async (sessionId, toolNames) => {
            sessionAutoApproveTools.set(sessionId, [...toolNames]);
        }) as CloudChatBackend['setSessionAutoApproveTools'],

        getSessionAutoApproveTools: (async (sessionId) => {
            return sessionAutoApproveTools.get(sessionId) ?? [];
        }) as CloudChatBackend['getSessionAutoApproveTools'],

        getMcpServersWithStatus: (() => []) as CloudChatBackend['getMcpServersWithStatus'],
        addMcpServer: (async () => {
            throw unsupportedCloudFeature('MCP management');
        }) as CloudChatBackend['addMcpServer'],
        enableMcpServer: (async () => {
            throw unsupportedCloudFeature('MCP management');
        }) as CloudChatBackend['enableMcpServer'],
        disableMcpServer: (async () => {
            throw unsupportedCloudFeature('MCP management');
        }) as CloudChatBackend['disableMcpServer'],
        removeMcpServer: (async () => {
            throw unsupportedCloudFeature('MCP management');
        }) as CloudChatBackend['removeMcpServer'],
        restartMcpServer: (async () => {
            throw unsupportedCloudFeature('MCP management');
        }) as CloudChatBackend['restartMcpServer'],
        getMcpClients: (() => new Map()) as CloudChatBackend['getMcpClients'],
        getMcpFailedConnections: (() => ({})) as CloudChatBackend['getMcpFailedConnections'],

        getEffectiveConfig: ((sessionId) => {
            const llmConfig = currentLLMConfig(sessionId);
            return {
                runtimeTarget: 'cloud',
                cloudAgentId,
                llm: {
                    provider: llmConfig.provider,
                    model: llmConfig.model,
                    maxOutputTokens: null,
                    temperature: null,
                },
                permissions: {
                    mode: 'cloud',
                },
                sessions: {},
                mcpServers: {},
                prompts: [],
            };
        }) as CloudChatBackend['getEffectiveConfig'],
    };

    return backend;
}

export async function startCloudChatCli(options: StartCloudChatCliOptions): Promise<void> {
    if (!process.stdin.isTTY) {
        throw new Error('Interactive cloud chat requires a TTY.');
    }

    const deployClient = createDeployClient();
    const cloudAgentId = await resolveCloudAgentId(options);
    const initialSessionId = await resolveInitialSessionId(deployClient, cloudAgentId, options);
    const backend = createCloudAgentBackend(deployClient, cloudAgentId);

    try {
        await startInkCliRefactored(backend, initialSessionId, {
            ...(options.initialPrompt ? { initialPrompt: options.initialPrompt } : {}),
        });
    } catch (error) {
        throw new Error(`Cloud chat failed: ${getErrorMessage(error)}`);
    }
}
