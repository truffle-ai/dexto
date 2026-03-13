/* global ReadableStream */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type {
    JSONSchema7,
    LanguageModelV2,
    LanguageModelV2CallOptions,
    LanguageModelV2CallWarning,
    LanguageModelV2Content,
    LanguageModelV2FinishReason,
    LanguageModelV2StreamPart,
    LanguageModelV2Usage,
} from '@ai-sdk/provider';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { safeStringify } from '../../utils/safe-stringify.js';
import { LLMErrorCode } from '../error-codes.js';
import { LLMError } from '../errors.js';
import { type CodexAuthMode, parseCodexBaseURL } from './codex-base-url.js';

type CodexJsonRpcId = number;
type CodexServerRequestId = number | string;

type CodexFunctionTool = Extract<
    NonNullable<LanguageModelV2CallOptions['tools']>[number],
    { type: 'function' }
>;

type CodexAccount = { type: 'apiKey' } | { type: 'chatgpt'; email: string; planType: string };

type CodexReadAccountResponse = {
    account: CodexAccount | null;
    requiresOpenaiAuth: boolean;
};

type CodexLoginResponse =
    | { type: 'apiKey' }
    | { type: 'chatgpt'; loginId: string; authUrl: string }
    | { type: 'chatgptAuthTokens' };

type CodexLoginParams = { type: 'chatgpt' } | { type: 'apiKey'; apiKey: string };

export type CodexModelInfo = {
    id: string;
    model: string;
    displayName: string;
    description: string;
    hidden: boolean;
    isDefault: boolean;
    supportedReasoningEfforts: string[];
    defaultReasoningEffort: string;
};

export type CodexRateLimitSnapshot = {
    source: 'chatgpt-login';
    usedPercent: number;
    exceeded: boolean;
    limitId?: string;
    limitName?: string;
    resetsAt?: string;
    windowMinutes?: number;
};

type CodexThreadStartResponse = {
    thread: {
        id: string;
    };
};

type CodexTurnStartResponse = {
    turn: {
        id: string;
    };
};

type CodexNotification = {
    method: string;
    params?: unknown;
};

type CodexServerRequest = {
    id: CodexServerRequestId;
    method: string;
    params?: unknown;
};

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: NodeJS.Timeout;
};

type NotificationListener = (message: CodexNotification) => void;
type ServerRequestListener = (message: CodexServerRequest) => void;

type CodexDynamicTool = {
    name: string;
    description?: string;
    inputSchema: JSONSchema7;
};

type CodexDynamicToolCall = {
    threadId: string;
    turnId: string;
    callId: string;
    toolName: string;
    input: string;
};

type CodexClientInfo = {
    name: string;
    title: string;
    version: string;
};

export interface CodexAppServerClientOptions {
    command?: string;
    cwd?: string;
    requestTimeoutMs?: number;
    clientInfo?: CodexClientInfo;
}

const CODEX_PROTOCOL_ERROR_CODE = 'llm_codex_protocol_invalid';
const CODEX_CLIENT_RUNTIME_ERROR_CODE = 'llm_codex_client_runtime';

function createCodexProtocolError(
    message: string,
    context?: Record<string, unknown>
): DextoRuntimeError<Record<string, unknown> | undefined> {
    return new DextoRuntimeError(
        CODEX_PROTOCOL_ERROR_CODE,
        ErrorScope.LLM,
        ErrorType.THIRD_PARTY,
        message,
        context
    );
}

function createCodexClientRuntimeError(
    message: string,
    context?: Record<string, unknown>,
    type: ErrorType = ErrorType.SYSTEM
): DextoRuntimeError<Record<string, unknown> | undefined> {
    return new DextoRuntimeError(
        CODEX_CLIENT_RUNTIME_ERROR_CODE,
        ErrorScope.LLM,
        type,
        message,
        context
    );
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CLIENT_INFO: CodexClientInfo = {
    name: 'dexto',
    title: 'Dexto',
    version: '1.0.0',
};
const CODEX_DEVELOPER_INSTRUCTIONS = [
    'You are providing model responses for a host application.',
    'Treat the provided input as the full conversation transcript.',
    'Use the host-provided dynamic tools when tool use is needed.',
    'Do not use Codex built-in tools, shell commands, file edits, approvals, MCP tools, or ask-user flows.',
    'When you are not calling a tool, answer with the assistant response only.',
].join(' ');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function getNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function getArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : createCodexClientRuntimeError(String(error));
}

function parseCodexAccount(value: unknown): CodexAccount | null {
    if (!isRecord(value)) {
        return null;
    }

    const type = getString(value['type']);
    if (type === 'apiKey') {
        return { type: 'apiKey' };
    }

    if (type !== 'chatgpt') {
        return null;
    }

    const email = getString(value['email']);
    const planType = getString(value['planType']);
    if (!email || !planType) {
        return null;
    }

    return {
        type: 'chatgpt',
        email,
        planType,
    };
}

function parseReadAccountResponse(value: unknown): CodexReadAccountResponse {
    if (!isRecord(value)) {
        throw createCodexProtocolError('Invalid account/read response from Codex', {
            method: 'account/read',
        });
    }

    const requiresOpenaiAuth = getBoolean(value['requiresOpenaiAuth']);
    if (requiresOpenaiAuth === null) {
        throw createCodexProtocolError(
            'Codex account/read response is missing requiresOpenaiAuth',
            {
                method: 'account/read',
            }
        );
    }

    return {
        account: parseCodexAccount(value['account']),
        requiresOpenaiAuth,
    };
}

function parseLoginResponse(value: unknown): CodexLoginResponse {
    if (!isRecord(value)) {
        throw createCodexProtocolError('Invalid account/login/start response from Codex', {
            method: 'account/login/start',
        });
    }

    const type = getString(value['type']);
    if (!type) {
        throw createCodexProtocolError('Codex login response is missing type', {
            method: 'account/login/start',
        });
    }

    if (type === 'apiKey') {
        return { type };
    }

    if (type === 'chatgptAuthTokens') {
        return { type };
    }

    if (type !== 'chatgpt') {
        throw createCodexProtocolError(`Unsupported Codex login response type: ${type}`, {
            method: 'account/login/start',
            type,
        });
    }

    const loginId = getString(value['loginId']);
    const authUrl = getString(value['authUrl']);
    if (!loginId || !authUrl) {
        throw createCodexProtocolError('Codex ChatGPT login response is missing login details', {
            method: 'account/login/start',
        });
    }

    return {
        type,
        loginId,
        authUrl,
    };
}

function parseModelListResponse(value: unknown): {
    data: CodexModelInfo[];
    nextCursor: string | null;
} {
    if (!isRecord(value)) {
        throw createCodexProtocolError('Invalid model/list response from Codex', {
            method: 'model/list',
        });
    }

    const data = getArray(value['data']);
    if (!data) {
        throw createCodexProtocolError('Codex model/list response is missing data', {
            method: 'model/list',
        });
    }

    const models: CodexModelInfo[] = [];
    for (const entry of data) {
        if (!isRecord(entry)) {
            continue;
        }

        const id = getString(entry['id']);
        const model = getString(entry['model']);
        const displayName = getString(entry['displayName']);
        const description = getString(entry['description']);
        const hidden = getBoolean(entry['hidden']);
        const isDefault = getBoolean(entry['isDefault']);
        const defaultReasoningEffort = getString(entry['defaultReasoningEffort']);
        const supportedReasoningEffortsRaw = getArray(entry['supportedReasoningEfforts']);

        if (
            !id ||
            !model ||
            !displayName ||
            description === null ||
            hidden === null ||
            isDefault === null ||
            !defaultReasoningEffort ||
            !supportedReasoningEffortsRaw
        ) {
            continue;
        }

        const supportedReasoningEfforts = supportedReasoningEffortsRaw
            .map((candidate) => getString(candidate))
            .filter((candidate): candidate is string => candidate !== null);

        models.push({
            id,
            model,
            displayName,
            description,
            hidden,
            isDefault,
            supportedReasoningEfforts,
            defaultReasoningEffort,
        });
    }

    return {
        data: models,
        nextCursor: getString(value['nextCursor']),
    };
}

function parseThreadStartResponse(value: unknown): CodexThreadStartResponse {
    if (!isRecord(value) || !isRecord(value['thread'])) {
        throw createCodexProtocolError('Invalid thread/start response from Codex', {
            method: 'thread/start',
        });
    }

    const threadId = getString(value['thread']['id']);
    if (!threadId) {
        throw createCodexProtocolError('Codex thread/start response is missing a thread ID', {
            method: 'thread/start',
        });
    }

    return {
        thread: {
            id: threadId,
        },
    };
}

function parseTurnStartResponse(value: unknown): CodexTurnStartResponse {
    if (!isRecord(value) || !isRecord(value['turn'])) {
        throw createCodexProtocolError('Invalid turn/start response from Codex', {
            method: 'turn/start',
        });
    }

    const turnId = getString(value['turn']['id']);
    if (!turnId) {
        throw createCodexProtocolError('Codex turn/start response is missing a turn ID', {
            method: 'turn/start',
        });
    }

    return {
        turn: {
            id: turnId,
        },
    };
}

function parseRateLimitEntry(value: unknown): CodexRateLimitSnapshot | null {
    if (!isRecord(value)) {
        return null;
    }

    const usedPercent = getNumber(value['usedPercent']);
    if (usedPercent === null) {
        return null;
    }

    const normalizedUsedPercent = Math.max(0, Math.min(100, usedPercent));
    const windowMinutes =
        getNumber(value['windowDurationMins']) ?? getNumber(value['windowMinutes']);
    const limitId = getString(value['limitId']);
    const limitName = getString(value['limitName']);
    const resetsAt = getString(value['resetsAt']);

    return {
        source: 'chatgpt-login',
        usedPercent: normalizedUsedPercent,
        exceeded: normalizedUsedPercent >= 100,
        ...(limitId ? { limitId } : {}),
        ...(limitName ? { limitName } : {}),
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowMinutes !== null ? { windowMinutes } : {}),
    };
}

function collectRateLimitEntries(value: unknown): CodexRateLimitSnapshot[] {
    const entries: CodexRateLimitSnapshot[] = [];
    const directEntry = parseRateLimitEntry(value);
    if (directEntry) {
        entries.push(directEntry);
    }

    if (!isRecord(value)) {
        return entries;
    }

    const rateLimits = getArray(value['rateLimits']);
    if (rateLimits) {
        for (const candidate of rateLimits) {
            const entry = parseRateLimitEntry(candidate);
            if (entry) {
                entries.push(entry);
            }
        }
    }

    const rateLimitsByLimitId = isRecord(value['rateLimitsByLimitId'])
        ? value['rateLimitsByLimitId']
        : null;
    if (rateLimitsByLimitId) {
        for (const candidate of Object.values(rateLimitsByLimitId)) {
            if (Array.isArray(candidate)) {
                for (const item of candidate) {
                    const entry = parseRateLimitEntry(item);
                    if (entry) {
                        entries.push(entry);
                    }
                }
                continue;
            }

            const entry = parseRateLimitEntry(candidate);
            if (entry) {
                entries.push(entry);
            }
        }
    }

    return entries;
}

function pickPrimaryRateLimitSnapshot(value: unknown): CodexRateLimitSnapshot | null {
    const entries = collectRateLimitEntries(value);
    if (entries.length === 0) {
        return null;
    }

    entries.sort((left, right) => {
        if (left.exceeded !== right.exceeded) {
            return left.exceeded ? -1 : 1;
        }

        if (left.usedPercent !== right.usedPercent) {
            return right.usedPercent - left.usedPercent;
        }

        const leftReset = left.resetsAt ? Date.parse(left.resetsAt) : Number.POSITIVE_INFINITY;
        const rightReset = right.resetsAt ? Date.parse(right.resetsAt) : Number.POSITIVE_INFINITY;
        return leftReset - rightReset;
    });

    return entries[0] ?? null;
}

type CodexErrorDetails = {
    message: string | null;
    additionalDetails: string | null;
    errorInfoKeys: string[];
};

function parseCodexErrorDetails(value: unknown): CodexErrorDetails | null {
    if (!isRecord(value)) {
        return null;
    }

    const codexErrorInfo = isRecord(value['codexErrorInfo'])
        ? value['codexErrorInfo']
        : isRecord(value['codex_error_info'])
          ? value['codex_error_info']
          : null;

    return {
        message: getString(value['message']),
        additionalDetails:
            getString(value['additionalDetails']) ?? getString(value['additional_details']),
        errorInfoKeys: codexErrorInfo ? Object.keys(codexErrorInfo) : [],
    };
}

function isUsageLimitError(details: CodexErrorDetails | null): boolean {
    if (!details) {
        return false;
    }

    const normalizedInfoKeys = details.errorInfoKeys.map((key) => key.toLowerCase());
    if (normalizedInfoKeys.includes('usagelimitexceeded')) {
        return true;
    }

    const combinedText =
        `${details.message ?? ''} ${details.additionalDetails ?? ''}`.toLowerCase();
    return (
        combinedText.includes('usage limit') ||
        combinedText.includes('rate limit') ||
        combinedText.includes('quota exceeded') ||
        combinedText.includes('purchase more credits')
    );
}

function buildUsageLimitSnapshot(existing: CodexRateLimitSnapshot | null): CodexRateLimitSnapshot {
    if (!existing) {
        return {
            source: 'chatgpt-login',
            usedPercent: 100,
            exceeded: true,
        };
    }

    return {
        ...existing,
        usedPercent: Math.max(100, existing.usedPercent),
        exceeded: true,
    };
}

function toChatGPTUsageLimitError(
    details: CodexErrorDetails,
    modelId: string,
    snapshot: CodexRateLimitSnapshot | null
): DextoRuntimeError {
    const message = details.message ?? 'You have reached your ChatGPT usage limit.';

    return new DextoRuntimeError(
        LLMErrorCode.RATE_LIMIT_EXCEEDED,
        ErrorScope.LLM,
        ErrorType.RATE_LIMIT,
        message,
        {
            provider: 'openai-compatible',
            model: modelId,
            source: 'chatgpt-login',
            ...(snapshot?.limitId ? { limitId: snapshot.limitId } : {}),
            ...(snapshot?.limitName ? { limitName: snapshot.limitName } : {}),
            ...(snapshot?.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
            ...(snapshot?.windowMinutes !== undefined
                ? { windowMinutes: snapshot.windowMinutes }
                : {}),
            usedPercent: snapshot?.usedPercent ?? 100,
            additionalDetails: details.additionalDetails ?? undefined,
            errorInfoKeys: details.errorInfoKeys,
        },
        [
            'Wait for your ChatGPT usage window to reset, or switch this session to an OpenAI API key.',
            'Use `/model` to move this session onto your API key-backed OpenAI provider.',
        ]
    );
}

function createUsage(): LanguageModelV2Usage {
    return {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
    };
}

function promptMessageToTranscript(message: LanguageModelV2CallOptions['prompt'][number]): string {
    if (message.role === 'system') {
        return `System:\n${message.content}`;
    }

    const parts =
        message.role === 'tool'
            ? message.content.map((part) => {
                  const output = safeStringify(part.output);
                  return `[Tool Result: ${part.toolName}#${part.toolCallId}]\n${output}`;
              })
            : message.content.map((part) => {
                  switch (part.type) {
                      case 'text':
                          return part.text;
                      case 'reasoning':
                          return `[Reasoning]\n${part.text}`;
                      case 'tool-call':
                          return (
                              `[Tool Call: ${part.toolName}#${part.toolCallId}]\n` +
                              `${safeStringify(part.input)}`
                          );
                      case 'tool-result':
                          return (
                              `[Tool Result: ${part.toolName}#${part.toolCallId}]\n` +
                              `${safeStringify(part.output)}`
                          );
                      case 'file': {
                          const url =
                              part.data instanceof URL
                                  ? part.data.toString()
                                  : typeof part.data === 'string' &&
                                      /^(https?:)?\/\//i.test(part.data)
                                    ? part.data
                                    : null;
                          const fileLabel = part.filename ?? part.mediaType;
                          if (url) {
                              return `[File: ${fileLabel}] ${url}`;
                          }
                          return `[File: ${fileLabel}] data omitted`;
                      }
                      default: {
                          const unknownType =
                              isRecord(part) && typeof part['type'] === 'string'
                                  ? part['type']
                                  : 'unknown';
                          return `[Unknown Prompt Part: ${unknownType}]`;
                      }
                  }
              });

    const roleLabel =
        message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'Tool';

    return `${roleLabel}:\n${parts.join('\n')}`;
}

function buildTranscript(prompt: LanguageModelV2CallOptions['prompt']): string {
    return prompt.map((message) => promptMessageToTranscript(message)).join('\n\n');
}

function isFunctionTool(
    tool: NonNullable<LanguageModelV2CallOptions['tools']>[number]
): tool is CodexFunctionTool {
    return tool.type === 'function';
}

function selectCodexFunctionTools(options: LanguageModelV2CallOptions): CodexFunctionTool[] {
    const functionTools = (options.tools ?? []).filter(isFunctionTool);
    const toolChoice = options.toolChoice;

    if (!toolChoice || toolChoice.type === 'auto' || toolChoice.type === 'required') {
        return functionTools;
    }

    if (toolChoice.type === 'none') {
        return [];
    }

    return functionTools.filter((tool) => tool.name === toolChoice.toolName);
}

function buildDynamicTools(options: LanguageModelV2CallOptions): CodexDynamicTool[] {
    return selectCodexFunctionTools(options).map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
    }));
}

function buildWarnings(options: LanguageModelV2CallOptions): LanguageModelV2CallWarning[] {
    const warnings: LanguageModelV2CallWarning[] = [];

    const unsupportedSettings: Array<keyof LanguageModelV2CallOptions> = [
        'maxOutputTokens',
        'temperature',
        'stopSequences',
        'topP',
        'topK',
        'presencePenalty',
        'frequencyPenalty',
        'seed',
    ];

    for (const setting of unsupportedSettings) {
        if (options[setting] !== undefined) {
            warnings.push({
                type: 'unsupported-setting',
                setting,
                details: 'Codex app-server manages this setting internally.',
            });
        }
    }

    if (options.tools) {
        for (const tool of options.tools) {
            if (!isFunctionTool(tool)) {
                warnings.push({
                    type: 'unsupported-tool',
                    tool,
                    details: 'Codex app-server integration only supports host function tools.',
                });
            }
        }
    }

    return warnings;
}

function getRequestedReasoningEffort(options: LanguageModelV2CallOptions): string | null {
    if (!isRecord(options.providerOptions)) {
        return null;
    }

    const openAiCompatibleOptions = options.providerOptions['openaiCompatible'];
    if (!isRecord(openAiCompatibleOptions)) {
        return null;
    }

    const reasoningEffort = getString(openAiCompatibleOptions['reasoningEffort']);
    return reasoningEffort ?? null;
}

function buildDeveloperInstructions(
    options: LanguageModelV2CallOptions,
    dynamicTools: CodexDynamicTool[]
): string {
    const instructions = [CODEX_DEVELOPER_INSTRUCTIONS];

    if (dynamicTools.length > 0) {
        instructions.push(
            'Host-provided dynamic tools are available for this turn. Prefer them over guessing.'
        );

        if (options.toolChoice?.type === 'required') {
            instructions.push(
                'You must call at least one host-provided dynamic tool before your final answer.'
            );
        }
    } else {
        instructions.push('No host-provided dynamic tools are available for this turn.');
    }

    if (options.toolChoice?.type === 'tool') {
        instructions.push(
            `If you need a tool, use only the host tool named "${options.toolChoice.toolName}".`
        );
    }

    if (options.responseFormat?.type === 'json' && !options.responseFormat.schema) {
        instructions.push('Return valid JSON only. Do not wrap it in Markdown fences.');
    }

    return instructions.join(' ');
}

function toCodexFailureMessage(error: unknown, modelId: string): Error {
    if (error instanceof DextoRuntimeError) {
        return error;
    }

    const normalized = normalizeError(error);
    if (normalized.message.includes('spawn codex ENOENT')) {
        return LLMError.missingConfig(
            'openai-compatible',
            'the Codex CLI on PATH (install Codex to use ChatGPT Login in Dexto)'
        );
    }

    const fallbackDetails: CodexErrorDetails = {
        message: normalized.message,
        additionalDetails: null,
        errorInfoKeys: [],
    };
    if (isUsageLimitError(fallbackDetails)) {
        return toChatGPTUsageLimitError(fallbackDetails, modelId, null);
    }

    return LLMError.generationFailed(normalized.message, 'openai-compatible', modelId);
}

function enforceAuthMode(authMode: CodexAuthMode, accountState: CodexReadAccountResponse): void {
    if (!accountState.account) {
        if (accountState.requiresOpenaiAuth) {
            throw LLMError.missingConfig(
                'openai-compatible',
                'Codex authentication (run `codex login` or re-run `dexto setup` and choose ChatGPT Login)'
            );
        }
        return;
    }

    if (authMode === 'auto') {
        return;
    }

    if (authMode === 'chatgpt' && accountState.account.type !== 'chatgpt') {
        throw LLMError.missingConfig(
            'openai-compatible',
            'a ChatGPT-backed Codex login (run `codex logout` and sign in with ChatGPT, or re-run `dexto setup`)'
        );
    }

    if (authMode === 'apikey' && accountState.account.type !== 'apiKey') {
        throw LLMError.missingConfig(
            'openai-compatible',
            'an API key-backed Codex login (run `codex login --with-api-key` or re-run `dexto setup`)'
        );
    }
}

function extractErrorMessage(params: unknown): string | null {
    if (!isRecord(params) || !isRecord(params['error'])) {
        return null;
    }

    return getString(params['error']['message']);
}

function stringifyToolInput(input: unknown): string {
    try {
        const serialized = JSON.stringify(input ?? {});
        return serialized === undefined ? '{}' : serialized;
    } catch {
        return '{}';
    }
}

function parseDynamicToolCallRequest(params: unknown): CodexDynamicToolCall | null {
    if (!isRecord(params)) {
        return null;
    }

    const threadId = getString(params['threadId']);
    const turnId = getString(params['turnId']);
    const callId = getString(params['callId']);
    const toolName = getString(params['tool']);
    if (!threadId || !turnId || !callId || !toolName) {
        return null;
    }

    return {
        threadId,
        turnId,
        callId,
        toolName,
        input: stringifyToolInput(params['arguments']),
    };
}

export class CodexAppServerClient {
    private readonly command: string;
    private readonly cwd?: string | undefined;
    private readonly requestTimeoutMs: number;
    private readonly clientInfo: CodexClientInfo;
    private child: ChildProcessWithoutNullStreams | null = null;
    private reader: Interface | null = null;
    private nextId: CodexJsonRpcId = 1;
    private readonly pending = new Map<CodexJsonRpcId, PendingRequest>();
    private readonly listeners = new Set<NotificationListener>();
    private readonly requestListeners = new Set<ServerRequestListener>();
    private started = false;
    private closed = false;

    private constructor(options: CodexAppServerClientOptions = {}) {
        this.command = options.command ?? 'codex';
        this.cwd = options.cwd;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
    }

    static async create(options: CodexAppServerClientOptions = {}): Promise<CodexAppServerClient> {
        const client = new CodexAppServerClient(options);
        try {
            await client.start();
            return client;
        } catch (error) {
            await client.close().catch(() => undefined);
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.started = false;
        this.rejectPending(createCodexClientRuntimeError('Codex app-server client closed'));
        this.listeners.clear();
        this.requestListeners.clear();

        if (this.reader) {
            this.reader.close();
            this.reader = null;
        }

        const child = this.child;
        this.child = null;

        if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
            return;
        }

        await new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
            child.kill();
        });
    }

    onNotification(listener: NotificationListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    onServerRequest(listener: ServerRequestListener): () => void {
        this.requestListeners.add(listener);
        return () => {
            this.requestListeners.delete(listener);
        };
    }

    async readAccount(refreshToken: boolean = false): Promise<CodexReadAccountResponse> {
        const result = await this.request('account/read', { refreshToken });
        return parseReadAccountResponse(result);
    }

    async logout(): Promise<void> {
        await this.request('account/logout', undefined);
    }

    async startLogin(params: CodexLoginParams): Promise<CodexLoginResponse> {
        const result = await this.request('account/login/start', params);
        return parseLoginResponse(result);
    }

    async waitForLoginCompleted(
        loginId: string | null,
        options: { signal?: AbortSignal; timeoutMs?: number } = {}
    ): Promise<{ loginId: string | null; success: boolean; error: string | null }> {
        const params = await this.waitForNotification(
            'account/login/completed',
            (candidate) => {
                if (!isRecord(candidate)) {
                    return false;
                }

                const candidateLoginId = getString(candidate['loginId']);
                return candidateLoginId === loginId;
            },
            options
        );

        if (!isRecord(params)) {
            throw createCodexProtocolError(
                'Invalid account/login/completed notification from Codex',
                {
                    method: 'account/login/completed',
                }
            );
        }

        const success = getBoolean(params['success']);
        if (success === null) {
            throw createCodexProtocolError('Codex login completion is missing success', {
                method: 'account/login/completed',
            });
        }

        return {
            loginId: getString(params['loginId']),
            success,
            error: getString(params['error']),
        };
    }

    async listModels(): Promise<CodexModelInfo[]> {
        const models: CodexModelInfo[] = [];
        let cursor: string | null = null;

        while (true) {
            const result = await this.request('model/list', {
                includeHidden: false,
                ...(cursor ? { cursor } : {}),
            });
            const parsed = parseModelListResponse(result);
            models.push(...parsed.data);

            if (!parsed.nextCursor) {
                return models;
            }

            cursor = parsed.nextCursor;
        }
    }

    async readRateLimits(): Promise<CodexRateLimitSnapshot | null> {
        const result = await this.request('account/rateLimits/read', undefined);
        return pickPrimaryRateLimitSnapshot(result);
    }

    async startEphemeralThread(params: {
        model: string;
        cwd?: string;
        developerInstructions?: string;
        dynamicTools?: CodexDynamicTool[];
    }): Promise<CodexThreadStartResponse> {
        const result = await this.request('thread/start', {
            model: params.model,
            ...(params.cwd ? { cwd: params.cwd } : {}),
            approvalPolicy: 'untrusted',
            sandbox: 'read-only',
            developerInstructions: params.developerInstructions ?? CODEX_DEVELOPER_INSTRUCTIONS,
            ...(params.dynamicTools && params.dynamicTools.length > 0
                ? { dynamicTools: params.dynamicTools }
                : {}),
            ephemeral: true,
            experimentalRawEvents: false,
            persistExtendedHistory: false,
        });

        return parseThreadStartResponse(result);
    }

    async startTurn(params: {
        threadId: string;
        model: string;
        transcript: string;
        reasoningEffort?: string | null;
        outputSchema?: JSONSchema7;
    }): Promise<CodexTurnStartResponse> {
        const result = await this.request('turn/start', {
            threadId: params.threadId,
            model: params.model,
            input: [
                {
                    type: 'text',
                    text: params.transcript,
                    text_elements: [],
                },
            ],
            ...(params.reasoningEffort ? { effort: params.reasoningEffort } : {}),
            ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}),
        });

        return parseTurnStartResponse(result);
    }

    async waitForNotification(
        method: string,
        predicate?: ((params: unknown) => boolean) | undefined,
        options: { signal?: AbortSignal; timeoutMs?: number } = {}
    ): Promise<unknown> {
        if (this.closed) {
            throw createCodexClientRuntimeError('Codex app-server client is closed');
        }

        const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

        return await new Promise<unknown>((resolve, reject) => {
            let timeout: NodeJS.Timeout | null = null;
            let offAbort: (() => void) | null = null;

            const cleanup = (unsubscribe: () => void) => {
                unsubscribe();
                if (timeout) {
                    clearTimeout(timeout);
                }
                if (offAbort) {
                    offAbort();
                }
            };

            const unsubscribe = this.onNotification((message) => {
                if (message.method !== method) {
                    return;
                }

                if (predicate && !predicate(message.params)) {
                    return;
                }

                cleanup(unsubscribe);
                resolve(message.params);
            });

            timeout = setTimeout(() => {
                cleanup(unsubscribe);
                reject(
                    createCodexClientRuntimeError(
                        `Timed out waiting for Codex notification: ${method}`,
                        { method },
                        ErrorType.TIMEOUT
                    )
                );
            }, timeoutMs);

            if (options.signal) {
                const onAbort = () => {
                    cleanup(unsubscribe);
                    reject(
                        options.signal?.reason instanceof Error
                            ? options.signal.reason
                            : createCodexClientRuntimeError(
                                  'Codex operation aborted',
                                  { method },
                                  ErrorType.USER
                              )
                    );
                };

                if (options.signal.aborted) {
                    onAbort();
                    return;
                }

                options.signal.addEventListener('abort', onAbort, { once: true });
                offAbort = () => options.signal?.removeEventListener('abort', onAbort);
            }
        });
    }

    private async start(): Promise<void> {
        if (this.started) {
            return;
        }

        const child = spawn(this.command, ['app-server'], {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.child = child;
        this.reader = createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        });
        const drainStderr = () => undefined;
        child.stderr.on('data', drainStderr);

        child.on('error', (error) => {
            this.rejectPending(error);
        });

        child.on('exit', (code, signal) => {
            child.stderr.off('data', drainStderr);
            if (!this.closed) {
                this.rejectPending(
                    createCodexClientRuntimeError(
                        `Codex app-server exited unexpectedly (${signal ?? `code ${code ?? 'unknown'}`})`,
                        {
                            ...(code !== null ? { code } : {}),
                            ...(signal !== null ? { signal } : {}),
                        },
                        ErrorType.THIRD_PARTY
                    )
                );
            }
        });

        this.reader.on('line', (line) => {
            this.handleLine(line);
        });

        await this.request('initialize', {
            clientInfo: this.clientInfo,
            capabilities: {
                experimentalApi: true,
            },
        });
        this.notify('initialized', {});
        this.started = true;
    }

    private handleLine(line: string): void {
        if (!line.trim()) {
            return;
        }

        let payload: unknown;
        try {
            payload = JSON.parse(line);
        } catch {
            return;
        }

        if (!isRecord(payload)) {
            return;
        }

        const id = payload['id'];
        const method = getString(payload['method']);

        if ((typeof id === 'number' || typeof id === 'string') && method) {
            const request: CodexServerRequest = {
                id,
                method,
                ...(payload['params'] !== undefined ? { params: payload['params'] } : {}),
            };

            for (const listener of this.requestListeners) {
                listener(request);
            }
            return;
        }

        if (typeof id === 'number') {
            const pending = this.pending.get(id);
            if (!pending) {
                return;
            }

            this.pending.delete(id);
            clearTimeout(pending.timeout);

            if (isRecord(payload['error'])) {
                const message =
                    getString(payload['error']['message']) ?? 'Codex JSON-RPC request failed';
                pending.reject(
                    createCodexClientRuntimeError(message, { id }, ErrorType.THIRD_PARTY)
                );
                return;
            }

            pending.resolve(payload['result']);
            return;
        }

        if (!method) {
            return;
        }

        const notification: CodexNotification = {
            method,
            ...(payload['params'] !== undefined ? { params: payload['params'] } : {}),
        };

        for (const listener of this.listeners) {
            listener(notification);
        }
    }

    private notify(method: string, params: unknown): void {
        this.write({ method, params });
    }

    private async request(method: string, params: unknown): Promise<unknown> {
        if (this.closed) {
            throw createCodexClientRuntimeError('Codex app-server client is closed');
        }

        const id = this.nextId++;

        return await new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    createCodexClientRuntimeError(
                        `Codex request timed out: ${method}`,
                        { method, id },
                        ErrorType.TIMEOUT
                    )
                );
            }, this.requestTimeoutMs);

            this.pending.set(id, {
                resolve,
                reject,
                timeout,
            });

            try {
                this.write({
                    method,
                    id,
                    ...(params !== undefined ? { params } : {}),
                });
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    respondToServerRequest(id: CodexServerRequestId, result: unknown): void {
        this.write({
            id,
            result,
        });
    }

    rejectServerRequest(id: CodexServerRequestId, message: string, code: number = -32601): void {
        this.write({
            id,
            error: {
                code,
                message,
            },
        });
    }

    private write(payload: Record<string, unknown>): void {
        if (!this.child?.stdin.writable) {
            throw createCodexClientRuntimeError('Codex app-server stdin is not writable');
        }

        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    }

    private rejectPending(error: unknown): void {
        const normalized = normalizeError(error);

        for (const [id, pending] of this.pending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(normalized);
            this.pending.delete(id);
        }
    }
}

export function createCodexLanguageModel(options: {
    modelId: string;
    baseURL: string;
    cwd?: string;
    onRateLimitStatus?: (snapshot: CodexRateLimitSnapshot) => void;
}): LanguageModelV2 {
    const parsedBaseURL = parseCodexBaseURL(options.baseURL);
    const authMode = parsedBaseURL?.authMode ?? 'auto';

    async function executeTurn(callOptions: LanguageModelV2CallOptions): Promise<{
        stream: ReadableStream<LanguageModelV2StreamPart>;
        request: { body: unknown };
    }> {
        const warnings = buildWarnings(callOptions);
        const transcript = buildTranscript(callOptions.prompt);
        const reasoningEffort = getRequestedReasoningEffort(callOptions);
        const dynamicTools = buildDynamicTools(callOptions);
        const developerInstructions = buildDeveloperInstructions(callOptions, dynamicTools);
        const outputSchema =
            callOptions.responseFormat?.type === 'json'
                ? callOptions.responseFormat.schema
                : undefined;

        let latestRateLimitSnapshot: CodexRateLimitSnapshot | null = null;
        const emitRateLimitStatus = (snapshot: CodexRateLimitSnapshot | null) => {
            if (!snapshot) {
                return;
            }

            latestRateLimitSnapshot = snapshot;
            options.onRateLimitStatus?.(snapshot);
        };

        let client: CodexAppServerClient | null = null;
        try {
            client = await CodexAppServerClient.create({
                ...(options.cwd ? { cwd: options.cwd } : {}),
            });
            const activeClient = client;
            const account = await activeClient.readAccount(false);
            enforceAuthMode(authMode, account);
            const shouldTrackRateLimits =
                account.account?.type === 'chatgpt' || authMode === 'chatgpt';

            if (shouldTrackRateLimits) {
                void activeClient
                    .readRateLimits()
                    .then((snapshot) => emitRateLimitStatus(snapshot))
                    .catch(() => undefined);
            }

            const thread = await activeClient.startEphemeralThread({
                model: options.modelId,
                ...(options.cwd ? { cwd: options.cwd } : {}),
                developerInstructions,
                dynamicTools,
            });

            const turn = await activeClient.startTurn({
                threadId: thread.thread.id,
                model: options.modelId,
                transcript,
                ...(reasoningEffort ? { reasoningEffort } : {}),
                ...(outputSchema ? { outputSchema } : {}),
            });

            const stream = new ReadableStream<LanguageModelV2StreamPart>({
                start(controller) {
                    let closed = false;
                    let streamStarted = false;
                    let textStarted = false;
                    let textEnded = false;
                    let emittedText = '';
                    let offAbort: (() => void) | null = null;
                    const textPartId = `codex-text-${turn.turn.id}`;

                    const cleanup = () => {
                        if (closed) {
                            return;
                        }

                        closed = true;
                        unsubscribeNotifications();
                        unsubscribeRequests();
                        if (offAbort) {
                            offAbort();
                            offAbort = null;
                        }
                        void activeClient.close();
                    };

                    const ensureStreamStarted = () => {
                        if (streamStarted) {
                            return;
                        }

                        streamStarted = true;
                        controller.enqueue({
                            type: 'stream-start',
                            warnings,
                        });
                    };

                    const endText = () => {
                        if (textStarted && !textEnded) {
                            controller.enqueue({
                                type: 'text-end',
                                id: textPartId,
                            });
                            textEnded = true;
                        }
                    };

                    const finishStream = (
                        finishReason: 'stop' | 'other' | 'error' | 'tool-calls'
                    ) => {
                        ensureStreamStarted();
                        endText();
                        controller.enqueue({
                            type: 'finish',
                            finishReason,
                            usage: createUsage(),
                        });
                        controller.close();
                        cleanup();
                    };

                    const failStream = (error: Error) => {
                        if (closed) {
                            return;
                        }

                        controller.enqueue({
                            type: 'error',
                            error,
                        });
                        cleanup();
                        controller.close();
                    };

                    const failWithTurnError = (
                        details: CodexErrorDetails | null,
                        fallbackMessage: string
                    ) => {
                        if (details && isUsageLimitError(details)) {
                            const snapshot = buildUsageLimitSnapshot(latestRateLimitSnapshot);
                            emitRateLimitStatus(snapshot);
                            failStream(
                                toChatGPTUsageLimitError(details, options.modelId, snapshot)
                            );
                            return;
                        }

                        failStream(
                            LLMError.generationFailed(
                                details?.message ?? fallbackMessage,
                                'openai-compatible',
                                options.modelId
                            )
                        );
                    };

                    const unsubscribeNotifications = activeClient.onNotification((message) => {
                        if (message.method === 'account/rateLimits/updated') {
                            emitRateLimitStatus(pickPrimaryRateLimitSnapshot(message.params));
                            return;
                        }

                        if (message.method === 'item/agentMessage/delta') {
                            if (!isRecord(message.params)) {
                                return;
                            }

                            const threadId = getString(message.params['threadId']);
                            const turnId = getString(message.params['turnId']);
                            const delta = getString(message.params['delta']);

                            if (
                                threadId !== thread.thread.id ||
                                turnId !== turn.turn.id ||
                                delta === null
                            ) {
                                return;
                            }

                            if (!textStarted) {
                                ensureStreamStarted();
                                controller.enqueue({
                                    type: 'text-start',
                                    id: textPartId,
                                });
                                textStarted = true;
                            }

                            emittedText += delta;
                            controller.enqueue({
                                type: 'text-delta',
                                id: textPartId,
                                delta,
                            });
                            return;
                        }

                        if (message.method === 'item/completed') {
                            if (!isRecord(message.params)) {
                                return;
                            }

                            const threadId = getString(message.params['threadId']);
                            const turnId = getString(message.params['turnId']);
                            const item = isRecord(message.params['item'])
                                ? message.params['item']
                                : null;
                            if (threadId !== thread.thread.id || turnId !== turn.turn.id || !item) {
                                return;
                            }

                            if (item['type'] !== 'agentMessage') {
                                return;
                            }

                            const text = getString(item['text']);
                            if (!text) {
                                return;
                            }

                            const missingText = text.startsWith(emittedText)
                                ? text.slice(emittedText.length)
                                : text;

                            if (!textStarted) {
                                ensureStreamStarted();
                                controller.enqueue({
                                    type: 'text-start',
                                    id: textPartId,
                                });
                                textStarted = true;
                            }

                            if (missingText) {
                                emittedText += missingText;
                                controller.enqueue({
                                    type: 'text-delta',
                                    id: textPartId,
                                    delta: missingText,
                                });
                            }
                            return;
                        }

                        if (message.method === 'error') {
                            if (!isRecord(message.params)) {
                                return;
                            }

                            const willRetry = getBoolean(message.params['willRetry']);
                            if (willRetry === true) {
                                return;
                            }

                            const threadId = getString(message.params['threadId']);
                            const turnId = getString(message.params['turnId']);
                            if (threadId !== thread.thread.id || turnId !== turn.turn.id) {
                                return;
                            }

                            const details = parseCodexErrorDetails(
                                isRecord(message.params['error'])
                                    ? message.params['error']
                                    : message.params
                            );
                            failWithTurnError(
                                details,
                                extractErrorMessage(message.params) ?? 'Codex turn failed'
                            );
                            return;
                        }

                        if (message.method === 'turn/completed') {
                            if (!isRecord(message.params)) {
                                return;
                            }

                            const threadId = getString(message.params['threadId']);
                            const turnInfo = isRecord(message.params['turn'])
                                ? message.params['turn']
                                : null;
                            const turnId = turnInfo ? getString(turnInfo['id']) : null;
                            const status = turnInfo ? getString(turnInfo['status']) : null;

                            if (
                                threadId !== thread.thread.id ||
                                turnId !== turn.turn.id ||
                                status === null
                            ) {
                                return;
                            }

                            if (status === 'failed') {
                                const details =
                                    turnInfo && isRecord(turnInfo['error'])
                                        ? parseCodexErrorDetails(turnInfo['error'])
                                        : null;
                                failWithTurnError(details, 'Codex turn failed');
                                return;
                            }

                            finishStream(status === 'completed' ? 'stop' : 'other');
                        }
                    });

                    const unsubscribeRequests = activeClient.onServerRequest((request) => {
                        if (request.method !== 'item/tool/call') {
                            activeClient.rejectServerRequest(
                                request.id,
                                `Codex request "${request.method}" is not supported because Dexto executes tools and approvals itself.`
                            );
                            return;
                        }

                        const toolCall = parseDynamicToolCallRequest(request.params);
                        if (
                            !toolCall ||
                            toolCall.threadId !== thread.thread.id ||
                            toolCall.turnId !== turn.turn.id
                        ) {
                            activeClient.rejectServerRequest(
                                request.id,
                                'Received an invalid Codex dynamic tool call payload.'
                            );
                            return;
                        }

                        ensureStreamStarted();
                        endText();
                        controller.enqueue({
                            type: 'tool-input-start',
                            id: toolCall.callId,
                            toolName: toolCall.toolName,
                        });
                        controller.enqueue({
                            type: 'tool-input-delta',
                            id: toolCall.callId,
                            delta: toolCall.input,
                        });
                        controller.enqueue({
                            type: 'tool-input-end',
                            id: toolCall.callId,
                        });
                        controller.enqueue({
                            type: 'tool-call',
                            toolCallId: toolCall.callId,
                            toolName: toolCall.toolName,
                            input: toolCall.input,
                        });
                        finishStream('tool-calls');
                    });

                    if (callOptions.abortSignal) {
                        const onAbort = () => {
                            failStream(
                                callOptions.abortSignal?.reason instanceof Error
                                    ? callOptions.abortSignal.reason
                                    : createCodexClientRuntimeError(
                                          'Codex generation aborted',
                                          { modelId: options.modelId },
                                          ErrorType.USER
                                      )
                            );
                        };

                        if (callOptions.abortSignal.aborted) {
                            onAbort();
                            return;
                        }

                        callOptions.abortSignal.addEventListener('abort', onAbort, { once: true });
                        offAbort = () =>
                            callOptions.abortSignal?.removeEventListener('abort', onAbort);
                    }
                },
                cancel() {
                    void activeClient.close();
                },
            });

            return {
                stream,
                request: {
                    body: {
                        provider: 'codex-app-server',
                        model: options.modelId,
                        transcript,
                        dynamicTools: dynamicTools.map((tool) => tool.name),
                    },
                },
            };
        } catch (error) {
            await client?.close().catch(() => undefined);
            const mappedError = toCodexFailureMessage(error, options.modelId);
            if (
                mappedError instanceof DextoRuntimeError &&
                mappedError.code === LLMErrorCode.RATE_LIMIT_EXCEEDED
            ) {
                emitRateLimitStatus(buildUsageLimitSnapshot(latestRateLimitSnapshot));
            }
            throw mappedError;
        }
    }

    return {
        specificationVersion: 'v2',
        provider: 'codex-app-server',
        modelId: options.modelId,
        supportedUrls: {},
        async doGenerate(callOptions) {
            const execution = await executeTurn(callOptions);
            const reader = execution.stream.getReader();
            const content: LanguageModelV2Content[] = [];
            let text = '';
            let finishReason: LanguageModelV2FinishReason = 'other';

            const flushText = () => {
                if (!text) {
                    return;
                }

                content.push({
                    type: 'text',
                    text,
                });
                text = '';
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                if (value.type === 'text-delta') {
                    text += value.delta;
                } else if (value.type === 'tool-call') {
                    flushText();
                    content.push({
                        type: 'tool-call',
                        toolCallId: value.toolCallId,
                        toolName: value.toolName,
                        input: value.input,
                    });
                } else if (value.type === 'error') {
                    throw toCodexFailureMessage(value.error, options.modelId);
                } else if (value.type === 'finish') {
                    finishReason = value.finishReason;
                }
            }

            flushText();

            return {
                content,
                finishReason,
                usage: createUsage(),
                warnings: buildWarnings(callOptions),
                request: execution.request,
            };
        },
        async doStream(callOptions) {
            return await executeTurn(callOptions);
        },
    };
}
