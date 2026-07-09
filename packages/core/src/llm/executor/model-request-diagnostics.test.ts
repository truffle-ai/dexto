import type { SharedV2ProviderOptions } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { ToolSet } from '../../tools/types.js';
import {
    createModelRequestDiagnostics,
    modelRequestDiagnosticAttributes,
} from './model-request-diagnostics.js';

const tools: ToolSet = {
    read_file: {
        description: 'Read a file',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
            },
            required: ['path'],
        },
    },
};

describe('model request diagnostics', () => {
    it('summarizes request size and media payloads without storing the request body', () => {
        const inlineImagePayload = 'aGVsbG8=';
        const inlineFilePayload = 'Zm9vYmFy';
        const messages = [
            { role: 'system', content: 'system prompt' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'turn text' },
                    {
                        type: 'image',
                        image: `data:image/png;base64,${inlineImagePayload}`,
                        mediaType: 'image/png',
                    },
                    {
                        type: 'image',
                        image: new URL('https://example.com/screenshot.png'),
                        mediaType: 'image/png',
                    },
                    {
                        type: 'file',
                        data: inlineFilePayload,
                        filename: 'notes.txt',
                        mediaType: 'text/plain',
                    },
                    {
                        type: 'file',
                        data: new Uint8Array([1, 2, 3, 4]),
                        filename: 'raw.bin',
                        mediaType: 'application/octet-stream',
                    },
                ],
            },
            {
                role: 'assistant',
                content: [
                    { type: 'reasoning', text: 'scratchpad' },
                    { type: 'text', text: 'answer' },
                ],
            },
        ] satisfies ModelMessage[];
        const providerOptions: SharedV2ProviderOptions = {
            openai: { reasoningEffort: 'high' },
        };

        const diagnostics = createModelRequestDiagnostics({
            compacted: true,
            estimatedInputTokens: 1234,
            formattedMessages: messages,
            model: 'gpt-5',
            preparedHistoryCount: 7,
            preparedHistoryStats: {
                originalCount: 10,
                filteredCount: 7,
                prunedToolCount: 1,
            },
            provider: 'openai',
            providerOptions,
            reasoning: {
                reasoningBudgetTokens: 2048,
                reasoningVariant: 'high',
            },
            streaming: true,
            systemPrompt: 'hotel config',
            toolDefinitions: tools,
        });

        expect(diagnostics.formattedMessageCount).toBe(3);
        expect(diagnostics.preparedHistoryOriginalCount).toBe(10);
        expect(diagnostics.preparedHistoryFilteredCount).toBe(7);
        expect(diagnostics.preparedHistoryPrunedToolCount).toBe(1);
        expect(diagnostics.formattedMessagesJsonBytes).toBeGreaterThan(
            inlineImagePayload.length + inlineFilePayload.length
        );
        expect(diagnostics.maxFormattedMessageJsonBytes).toBeGreaterThan(0);
        expect(diagnostics.systemPromptBytes).toBe(12);
        expect(diagnostics.toolCount).toBe(1);
        expect(diagnostics.toolDefinitionsJsonBytes).toBeGreaterThan(0);
        expect(diagnostics.providerOptionsJsonBytes).toBeGreaterThan(0);
        expect(diagnostics.reasoningJsonBytes).toBeGreaterThan(0);
        expect(diagnostics.serializationErrorCount).toBe(0);

        expect(diagnostics.imagePartCount).toBe(2);
        expect(diagnostics.inlineImagePartCount).toBe(1);
        expect(diagnostics.inlineImagePayloadChars).toBe(inlineImagePayload.length);
        expect(diagnostics.inlineImagePayloadDecodedBytes).toBe(5);
        expect(diagnostics.maxInlineImagePayloadChars).toBe(inlineImagePayload.length);
        expect(diagnostics.remoteMediaPartCount).toBe(1);

        expect(diagnostics.filePartCount).toBe(2);
        expect(diagnostics.inlineFilePartCount).toBe(1);
        expect(diagnostics.inlineFilePayloadChars).toBe(inlineFilePayload.length);
        expect(diagnostics.inlineFilePayloadDecodedBytes).toBe(6);
        expect(diagnostics.maxInlineFilePayloadChars).toBe(inlineFilePayload.length);
        expect(diagnostics.binaryMediaPartCount).toBe(1);
        expect(diagnostics.binaryMediaBytes).toBe(4);

        expect(diagnostics.textPartCount).toBe(4);
        expect(diagnostics.textChars).toBe(38);
    });

    it('flattens diagnostics into OpenTelemetry span attributes', () => {
        const diagnostics = createModelRequestDiagnostics({
            compacted: false,
            estimatedInputTokens: 42,
            formattedMessages: [],
            model: 'claude-test',
            preparedHistoryCount: 0,
            preparedHistoryStats: {
                originalCount: 0,
                filteredCount: 0,
                prunedToolCount: 0,
            },
            provider: 'anthropic',
            providerOptions: undefined,
            reasoning: undefined,
            streaming: false,
            systemPrompt: '',
            toolDefinitions: {},
        });

        const attributes = modelRequestDiagnosticAttributes(diagnostics);

        expect(attributes['llm.model']).toBe('claude-test');
        expect(attributes['llm.provider']).toBe('anthropic');
        expect(attributes['context.estimated_input_tokens']).toBe(42);
        expect(attributes['model_request.formatted_message_count']).toBe(0);
        expect(attributes['model_request.formatted_messages_json_bytes']).toBe(2);
        expect(attributes['model_request.compacted']).toBe(false);
        expect(attributes['model_request.streaming']).toBe(false);
        expect(attributes['model_request.tool_count']).toBe(0);
        expect(attributes['model_request.serialization_error_count']).toBe(0);
        expect(attributes).not.toHaveProperty('model_request.reasoning_variant');
        expect(attributes).not.toHaveProperty('model_request.reasoning_budget_tokens');
    });
});
