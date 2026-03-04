import {
    isTextPart,
    safeStringify,
    type DextoAgent,
    type SanitizedToolResult,
    type ShellDisplayData,
    type StreamingEvent,
} from '@dexto/core';

const HEADLESS_TOOL_OUTPUT_MAX_LINES = 20;
const HEADLESS_SECTION_SEPARATOR = '========================================';

type HeadlessToolCallState = {
    toolName: string;
    args: Record<string, unknown>;
    startedAt: number;
};

export type HeadlessRunResult = {
    finalMessage?: string;
    totalTokens?: number;
    fatalError?: Error;
};

function writeHeadlessLine(line: string = ''): void {
    process.stderr.write(`${line}\n`);
}

function writeHeadlessSeparator(): void {
    writeHeadlessLine(HEADLESS_SECTION_SEPARATOR);
}

function writeHeadlessTaggedLine(tag: string, message: string): void {
    writeHeadlessLine(`[${tag}] ${message}`);
}

function writeHeadlessTaggedBlock(tag: string, content: string): void {
    writeHeadlessLine(`[${tag}]`);
    const lines = content.length > 0 ? content.split('\n') : [''];
    for (const line of lines) {
        writeHeadlessLine(`| ${line}`);
    }
}

function formatHeadlessDuration(durationMs: number): string {
    if (durationMs < 1000) {
        return `${Math.round(durationMs)}ms`;
    }
    const seconds = durationMs / 1000;
    if (seconds < 10) {
        return `${seconds.toFixed(2)}s`;
    }
    return `${seconds.toFixed(1)}s`;
}

function formatToolNameForHeadless(toolName: string): string {
    const delimiter = '--';
    const delimiterIndex = toolName.indexOf(delimiter);
    if (delimiterIndex > 0) {
        return `${toolName.slice(0, delimiterIndex)}.${toolName.slice(delimiterIndex + delimiter.length)}`;
    }
    return toolName;
}

function formatToolArgsForHeadless(args: Record<string, unknown>): string {
    if (Object.keys(args).length === 0) {
        return '{}';
    }
    return safeStringify(args);
}

function formatToolInvocationForHeadless(toolName: string, args: Record<string, unknown>): string {
    return `${formatToolNameForHeadless(toolName)}(${formatToolArgsForHeadless(args)})`;
}

function truncateOutputForHeadless(output: string): string {
    const lines = output.split('\n');
    if (lines.length <= HEADLESS_TOOL_OUTPUT_MAX_LINES) {
        return output;
    }
    const omittedLineCount = lines.length - HEADLESS_TOOL_OUTPUT_MAX_LINES;
    return `${lines.slice(0, HEADLESS_TOOL_OUTPUT_MAX_LINES).join('\n')}\n... (${omittedLineCount} more lines)`;
}

function extractSanitizedToolText(sanitized: SanitizedToolResult | undefined): string | undefined {
    if (!sanitized) {
        return undefined;
    }

    const display = sanitized.meta.display;
    if (display?.type === 'shell') {
        const shellDisplay = display as ShellDisplayData;
        const chunks = [shellDisplay.stdout, shellDisplay.stderr].filter((chunk): chunk is string =>
            Boolean(chunk && chunk.trim())
        );
        if (chunks.length > 0) {
            return chunks.join('\n');
        }
    }

    if (display?.type === 'diff') {
        return display.unified;
    }

    if (display?.type === 'search') {
        return safeStringify(display.matches);
    }

    if (display?.type === 'file') {
        return safeStringify(display);
    }

    const textParts = sanitized.content.filter(isTextPart).map((part) => part.text);
    if (textParts.length > 0) {
        return textParts.join('\n');
    }

    return safeStringify(sanitized.content);
}

function extractToolOutputForHeadless(
    event: Extract<StreamingEvent, { name: 'llm:tool-result' }>
): string | undefined {
    if (!event.success && event.error) {
        return event.error;
    }
    return extractSanitizedToolText(event.sanitized);
}

function getTotalTokensFromResponse(
    event: Extract<StreamingEvent, { name: 'llm:response' }>
): number | undefined {
    const usage = event.tokenUsage;
    if (!usage) {
        return undefined;
    }
    if (typeof usage.totalTokens === 'number') {
        return usage.totalTokens;
    }

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const reasoningTokens = usage.reasoningTokens ?? 0;
    const computedTotal = inputTokens + outputTokens + reasoningTokens;

    return computedTotal > 0 ? computedTotal : undefined;
}

async function readPromptFromStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk));
        } else {
            chunks.push(chunk);
        }
    }
    return Buffer.concat(chunks).toString('utf-8');
}

export async function resolveHeadlessPrompt(promptArg?: string): Promise<string> {
    if (promptArg && promptArg !== '-') {
        return promptArg;
    }

    if (!promptArg && process.stdin.isTTY) {
        throw new Error(
            'No prompt provided. Pass a prompt argument (e.g., dexto run "your prompt") or pipe input via stdin.'
        );
    }

    return await readPromptFromStdin();
}

export function printHeadlessMcpStartup(agent: DextoAgent): void {
    const serverStatuses = agent.getMcpServersWithStatus().filter((server) => server.enabled);

    if (serverStatuses.length === 0) {
        writeHeadlessTaggedLine('MCP', 'startup: no servers');
        return;
    }

    const readyServers: string[] = [];
    const failedServers: string[] = [];

    for (const server of serverStatuses) {
        if (server.status === 'connected') {
            readyServers.push(server.name);
            writeHeadlessTaggedLine('MCP', `${server.name} ready`);
            continue;
        }

        failedServers.push(server.name);
        const reason = server.error ? `failed: ${server.error}` : `failed: ${server.status}`;
        writeHeadlessTaggedLine('MCP', `${server.name} ${reason}`);
    }

    const summaryParts: string[] = [];
    if (readyServers.length > 0) {
        summaryParts.push(`ready: ${readyServers.join(', ')}`);
    }
    if (failedServers.length > 0) {
        summaryParts.push(`failed: ${failedServers.join(', ')}`);
    }

    writeHeadlessTaggedLine('MCP', `startup: ${summaryParts.join('; ')}`);
}

export function printHeadlessRunSummary(params: {
    agent: DextoAgent;
    sessionId: string;
    prompt: string;
    agentPath: string;
    cliVersion: string;
}): void {
    const { agent, sessionId, prompt, agentPath, cliVersion } = params;
    const llmConfig = agent.getCurrentLLMConfig(sessionId);

    writeHeadlessSeparator();
    writeHeadlessTaggedLine('RUN', `Dexto CLI v${cliVersion}`);
    writeHeadlessSeparator();
    writeHeadlessLine('[CONFIG]');
    writeHeadlessLine(`workdir: ${process.cwd()}`);
    writeHeadlessLine(`agent: ${agentPath}`);
    writeHeadlessLine(`model: ${llmConfig.model}`);
    writeHeadlessLine(`provider: ${llmConfig.provider}`);
    writeHeadlessLine(`approval: ${agent.config.permissions.mode}`);
    writeHeadlessLine(`session id: ${sessionId}`);
    writeHeadlessSeparator();
    writeHeadlessTaggedBlock('USER', prompt);
}

export async function executeHeadlessRun(
    agent: DextoAgent,
    sessionId: string,
    prompt: string
): Promise<HeadlessRunResult> {
    const toolCallState = new Map<string, HeadlessToolCallState>();
    let anonymousToolCallCounter = 0;
    let finalMessage: string | undefined;
    let totalTokens: number | undefined;
    let fatalError: Error | undefined;

    for await (const event of await agent.stream(prompt, sessionId)) {
        switch (event.name) {
            case 'llm:tool-call': {
                const callKey = event.callId ?? `anonymous-${++anonymousToolCallCounter}`;
                const call = {
                    toolName: event.toolName,
                    args: event.args,
                    startedAt: Date.now(),
                };
                toolCallState.set(callKey, call);
                writeHeadlessTaggedLine(
                    'TOOL',
                    formatToolInvocationForHeadless(call.toolName, call.args)
                );
                break;
            }

            case 'tool:running': {
                const runningCall = toolCallState.get(event.toolCallId);
                if (runningCall) {
                    runningCall.startedAt = Date.now();
                }
                break;
            }

            case 'llm:tool-result': {
                let matchedCallKey: string | undefined = event.callId;
                let matchedCall = matchedCallKey ? toolCallState.get(matchedCallKey) : undefined;

                if (!matchedCall) {
                    const reverseEntries = Array.from(toolCallState.entries()).reverse();
                    const fallback = reverseEntries.find(
                        ([, call]) => call.toolName === event.toolName
                    );
                    if (fallback) {
                        matchedCallKey = fallback[0];
                        matchedCall = fallback[1];
                    }
                }

                const toolName = matchedCall?.toolName ?? event.toolName;
                const args = matchedCall?.args ?? {};
                const invocation = formatToolInvocationForHeadless(toolName, args);
                const durationText = matchedCall
                    ? ` in ${formatHeadlessDuration(Date.now() - matchedCall.startedAt)}`
                    : '';
                const statusTag = event.success ? 'TOOL:OK' : 'TOOL:ERR';

                writeHeadlessTaggedLine(statusTag, `${invocation}${durationText}`);
                const output = extractToolOutputForHeadless(event);
                if (output && output.trim().length > 0) {
                    writeHeadlessTaggedBlock('TOOL:OUT', truncateOutputForHeadless(output));
                }

                if (matchedCallKey) {
                    toolCallState.delete(matchedCallKey);
                }
                break;
            }

            case 'llm:response': {
                finalMessage = event.content;
                totalTokens = getTotalTokensFromResponse(event);
                break;
            }

            case 'llm:unsupported-input': {
                writeHeadlessTaggedLine('WARNING', event.errors.join('; '));
                break;
            }

            case 'llm:error': {
                if (!event.recoverable) {
                    fatalError = event.error;
                    writeHeadlessTaggedLine('ERROR', event.error.message);
                }
                break;
            }

            case 'run:complete': {
                if (event.finishReason === 'error' && event.error) {
                    fatalError = event.error;
                    writeHeadlessTaggedLine('ERROR', event.error.message);
                }
                break;
            }

            default:
                break;
        }
    }

    const result: HeadlessRunResult = {};
    if (finalMessage !== undefined) {
        result.finalMessage = finalMessage;
    }
    if (totalTokens !== undefined) {
        result.totalTokens = totalTokens;
    }
    if (fatalError !== undefined) {
        result.fatalError = fatalError;
    }
    return result;
}

export function printHeadlessAssistantResponse(message: string, totalTokens?: number): void {
    writeHeadlessSeparator();
    writeHeadlessTaggedBlock('DEXTO', message);
    if (typeof totalTokens === 'number') {
        writeHeadlessTaggedLine('TOKENS', new Intl.NumberFormat('en-US').format(totalTokens));
    }
}

export function writeFinalMessageToStdout(message: string): void {
    if (message.endsWith('\n')) {
        process.stdout.write(message);
        return;
    }
    process.stdout.write(`${message}\n`);
}

export function writeHeadlessError(message: string): void {
    writeHeadlessTaggedLine('ERROR', message);
}
