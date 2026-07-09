import type { SharedV2ProviderOptions } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import type { ReasoningVariant } from '@dexto/llm';
import type { PreparedHistoryResult } from '../../context/manager.js';
import type { ToolSet } from '../../tools/types.js';

export type ModelRequestDiagnostics = {
    readonly binaryMediaBytes: number;
    readonly binaryMediaPartCount: number;
    readonly compacted: boolean;
    readonly estimatedInputTokens: number;
    readonly filePartCount: number;
    readonly formattedMessageCount: number;
    readonly formattedMessagesJsonBytes: number;
    readonly imagePartCount: number;
    readonly inlineFilePayloadChars: number;
    readonly inlineFilePayloadDecodedBytes: number;
    readonly inlineFilePartCount: number;
    readonly inlineImagePayloadChars: number;
    readonly inlineImagePayloadDecodedBytes: number;
    readonly inlineImagePartCount: number;
    readonly maxFormattedMessageJsonBytes: number;
    readonly maxInlineFilePayloadChars: number;
    readonly maxInlineImagePayloadChars: number;
    readonly model: string;
    readonly preparedHistoryCount: number;
    readonly preparedHistoryFilteredCount: number;
    readonly preparedHistoryOriginalCount: number;
    readonly preparedHistoryPrunedToolCount: number;
    readonly provider: string;
    readonly providerOptionsJsonBytes: number;
    readonly reasoningBudgetTokens?: number;
    readonly reasoningJsonBytes: number;
    readonly reasoningVariant?: ReasoningVariant;
    readonly remoteMediaPartCount: number;
    readonly resourceMediaPartCount: number;
    readonly serializationErrorCount: number;
    readonly streaming: boolean;
    readonly systemPromptBytes: number;
    readonly textChars: number;
    readonly textPartCount: number;
    readonly toolCount: number;
    readonly toolDefinitionsJsonBytes: number;
};

export type ModelRequestDiagnosticAttributes = Record<string, string | number | boolean>;

export function createModelRequestDiagnostics(input: {
    compacted: boolean;
    estimatedInputTokens: number;
    formattedMessages: readonly ModelMessage[];
    model: string;
    preparedHistoryCount: number;
    preparedHistoryStats: PreparedHistoryResult['stats'];
    provider: string;
    providerOptions: SharedV2ProviderOptions | undefined;
    reasoning:
        | {
              reasoningVariant?: ReasoningVariant;
              reasoningBudgetTokens?: number;
          }
        | undefined;
    streaming: boolean;
    systemPrompt: string;
    toolDefinitions: ToolSet;
}): ModelRequestDiagnostics {
    const messageJson = measureMessagesJson(input.formattedMessages);
    const toolJson = safeJsonUtf8Bytes(input.toolDefinitions);
    const providerOptionsJson = safeJsonUtf8Bytes(input.providerOptions);
    const reasoningJson = safeJsonUtf8Bytes(input.reasoning);
    const media = summarizeModelMessageMedia(input.formattedMessages);

    return {
        ...media,
        compacted: input.compacted,
        estimatedInputTokens: input.estimatedInputTokens,
        formattedMessageCount: input.formattedMessages.length,
        formattedMessagesJsonBytes: messageJson.bytes,
        maxFormattedMessageJsonBytes: messageJson.maxMessageBytes,
        model: input.model,
        preparedHistoryCount: input.preparedHistoryCount,
        preparedHistoryFilteredCount: input.preparedHistoryStats.filteredCount,
        preparedHistoryOriginalCount: input.preparedHistoryStats.originalCount,
        preparedHistoryPrunedToolCount: input.preparedHistoryStats.prunedToolCount,
        provider: input.provider,
        providerOptionsJsonBytes: providerOptionsJson.bytes,
        ...(input.reasoning?.reasoningBudgetTokens === undefined
            ? {}
            : { reasoningBudgetTokens: input.reasoning.reasoningBudgetTokens }),
        reasoningJsonBytes: reasoningJson.bytes,
        ...(input.reasoning?.reasoningVariant === undefined
            ? {}
            : { reasoningVariant: input.reasoning.reasoningVariant }),
        serializationErrorCount:
            messageJson.errorCount +
            toolJson.errorCount +
            providerOptionsJson.errorCount +
            reasoningJson.errorCount,
        streaming: input.streaming,
        systemPromptBytes: utf8ByteLength(input.systemPrompt),
        toolCount: Object.keys(input.toolDefinitions).length,
        toolDefinitionsJsonBytes: toolJson.bytes,
    };
}

export function modelRequestDiagnosticAttributes(
    diagnostics: ModelRequestDiagnostics
): ModelRequestDiagnosticAttributes {
    return {
        'context.estimated_input_tokens': diagnostics.estimatedInputTokens,
        'llm.model': diagnostics.model,
        'llm.provider': diagnostics.provider,
        'model_request.binary_media_bytes': diagnostics.binaryMediaBytes,
        'model_request.binary_media_part_count': diagnostics.binaryMediaPartCount,
        'model_request.compacted': diagnostics.compacted,
        'model_request.file_part_count': diagnostics.filePartCount,
        'model_request.formatted_message_count': diagnostics.formattedMessageCount,
        'model_request.formatted_messages_json_bytes': diagnostics.formattedMessagesJsonBytes,
        'model_request.image_part_count': diagnostics.imagePartCount,
        'model_request.inline_file_payload_chars': diagnostics.inlineFilePayloadChars,
        'model_request.inline_file_payload_decoded_bytes':
            diagnostics.inlineFilePayloadDecodedBytes,
        'model_request.inline_file_part_count': diagnostics.inlineFilePartCount,
        'model_request.inline_image_payload_chars': diagnostics.inlineImagePayloadChars,
        'model_request.inline_image_payload_decoded_bytes':
            diagnostics.inlineImagePayloadDecodedBytes,
        'model_request.inline_image_part_count': diagnostics.inlineImagePartCount,
        'model_request.max_formatted_message_json_bytes': diagnostics.maxFormattedMessageJsonBytes,
        'model_request.max_inline_file_payload_chars': diagnostics.maxInlineFilePayloadChars,
        'model_request.max_inline_image_payload_chars': diagnostics.maxInlineImagePayloadChars,
        'model_request.prepared_history_count': diagnostics.preparedHistoryCount,
        'model_request.prepared_history_filtered_count': diagnostics.preparedHistoryFilteredCount,
        'model_request.prepared_history_original_count': diagnostics.preparedHistoryOriginalCount,
        'model_request.prepared_history_pruned_tool_count':
            diagnostics.preparedHistoryPrunedToolCount,
        'model_request.provider_options_json_bytes': diagnostics.providerOptionsJsonBytes,
        ...(diagnostics.reasoningBudgetTokens === undefined
            ? {}
            : {
                  'model_request.reasoning_budget_tokens': diagnostics.reasoningBudgetTokens,
              }),
        'model_request.reasoning_json_bytes': diagnostics.reasoningJsonBytes,
        ...(diagnostics.reasoningVariant === undefined
            ? {}
            : {
                  'model_request.reasoning_variant': diagnostics.reasoningVariant,
              }),
        'model_request.remote_media_part_count': diagnostics.remoteMediaPartCount,
        'model_request.resource_media_part_count': diagnostics.resourceMediaPartCount,
        'model_request.serialization_error_count': diagnostics.serializationErrorCount,
        'model_request.streaming': diagnostics.streaming,
        'model_request.system_prompt_bytes': diagnostics.systemPromptBytes,
        'model_request.text_chars': diagnostics.textChars,
        'model_request.text_part_count': diagnostics.textPartCount,
        'model_request.tool_count': diagnostics.toolCount,
        'model_request.tool_definitions_json_bytes': diagnostics.toolDefinitionsJsonBytes,
    };
}

type JsonMeasurement = {
    readonly bytes: number;
    readonly errorCount: number;
};

type MessageJsonMeasurement = JsonMeasurement & {
    readonly maxMessageBytes: number;
};

type MediaSummary = {
    binaryMediaBytes: number;
    binaryMediaPartCount: number;
    filePartCount: number;
    imagePartCount: number;
    inlineFilePayloadChars: number;
    inlineFilePayloadDecodedBytes: number;
    inlineFilePartCount: number;
    inlineImagePayloadChars: number;
    inlineImagePayloadDecodedBytes: number;
    inlineImagePartCount: number;
    maxInlineFilePayloadChars: number;
    maxInlineImagePayloadChars: number;
    remoteMediaPartCount: number;
    resourceMediaPartCount: number;
    textChars: number;
    textPartCount: number;
};

function measureMessagesJson(messages: readonly ModelMessage[]): MessageJsonMeasurement {
    let bodyBytes = 0;
    let errorCount = 0;
    let maxMessageBytes = 0;

    for (const message of messages) {
        const measurement = safeJsonUtf8Bytes(message);
        bodyBytes += measurement.bytes;
        errorCount += measurement.errorCount;
        maxMessageBytes = Math.max(maxMessageBytes, measurement.bytes);
    }

    return {
        bytes: messages.length === 0 ? 2 : bodyBytes + messages.length + 1,
        errorCount,
        maxMessageBytes,
    };
}

function safeJsonUtf8Bytes(value: unknown): JsonMeasurement {
    if (value === undefined) {
        return { bytes: 0, errorCount: 0 };
    }

    try {
        return {
            bytes: utf8ByteLength(JSON.stringify(value, diagnosticJsonReplacer) ?? ''),
            errorCount: 0,
        };
    } catch {
        return { bytes: 0, errorCount: 1 };
    }
}

function diagnosticJsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { diagnosticType: 'Uint8Array', byteLength: value.byteLength };
    }

    if (value instanceof ArrayBuffer) {
        return { diagnosticType: 'ArrayBuffer', byteLength: value.byteLength };
    }

    return value;
}

function summarizeModelMessageMedia(messages: readonly ModelMessage[]): MediaSummary {
    const summary: MediaSummary = {
        binaryMediaBytes: 0,
        binaryMediaPartCount: 0,
        filePartCount: 0,
        imagePartCount: 0,
        inlineFilePayloadChars: 0,
        inlineFilePayloadDecodedBytes: 0,
        inlineFilePartCount: 0,
        inlineImagePayloadChars: 0,
        inlineImagePayloadDecodedBytes: 0,
        inlineImagePartCount: 0,
        maxInlineFilePayloadChars: 0,
        maxInlineImagePayloadChars: 0,
        remoteMediaPartCount: 0,
        resourceMediaPartCount: 0,
        textChars: 0,
        textPartCount: 0,
    };

    for (const message of messages) {
        summarizeContent(message.content, summary);
    }

    return summary;
}

function summarizeContent(content: unknown, summary: MediaSummary): void {
    if (typeof content === 'string') {
        summary.textPartCount += 1;
        summary.textChars += content.length;
        return;
    }

    if (!Array.isArray(content)) {
        return;
    }

    for (const part of content) {
        if (!isRecord(part) || typeof part.type !== 'string') {
            continue;
        }

        switch (part.type) {
            case 'text':
            case 'reasoning':
                summarizeTextLikePart(part, summary);
                break;
            case 'image':
                summary.imagePartCount += 1;
                summarizeMediaPayload(part.image, 'image', summary);
                break;
            case 'file':
                summary.filePartCount += 1;
                summarizeMediaPayload(part.data, 'file', summary);
                break;
            case 'resource':
            case 'ui-resource':
                summary.resourceMediaPartCount += 1;
                break;
        }
    }
}

function summarizeTextLikePart(part: Record<string, unknown>, summary: MediaSummary): void {
    if (typeof part.text !== 'string') {
        return;
    }

    summary.textPartCount += 1;
    summary.textChars += part.text.length;
}

function summarizeMediaPayload(
    payload: unknown,
    kind: 'file' | 'image',
    summary: MediaSummary
): void {
    if (payload instanceof URL || isRemoteUrlString(payload)) {
        summary.remoteMediaPartCount += 1;
        return;
    }

    if (typeof payload === 'string') {
        summarizeInlinePayload(payload, kind, summary);
        return;
    }

    const binaryBytes = getBinaryByteLength(payload);
    if (binaryBytes !== undefined) {
        summary.binaryMediaPartCount += 1;
        summary.binaryMediaBytes += binaryBytes;
    }
}

function summarizeInlinePayload(
    payload: string,
    kind: 'file' | 'image',
    summary: MediaSummary
): void {
    const payloadChars = extractInlinePayload(payload).length;
    const decodedBytes = estimateBase64DecodedBytes(payload);

    if (kind === 'image') {
        summary.inlineImagePartCount += 1;
        summary.inlineImagePayloadChars += payloadChars;
        summary.inlineImagePayloadDecodedBytes += decodedBytes;
        summary.maxInlineImagePayloadChars = Math.max(
            summary.maxInlineImagePayloadChars,
            payloadChars
        );
        return;
    }

    summary.inlineFilePartCount += 1;
    summary.inlineFilePayloadChars += payloadChars;
    summary.inlineFilePayloadDecodedBytes += decodedBytes;
    summary.maxInlineFilePayloadChars = Math.max(summary.maxInlineFilePayloadChars, payloadChars);
}

function extractInlinePayload(payload: string): string {
    const trimmed = payload.trim();
    const dataUriMatch = /^data:[^,]*,(.*)$/is.exec(trimmed);
    return (dataUriMatch?.[1] ?? trimmed).replace(/\s/g, '');
}

function estimateBase64DecodedBytes(payload: string): number {
    const normalized = extractInlinePayload(payload);
    if (normalized.length === 0) {
        return 0;
    }

    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function getBinaryByteLength(value: unknown): number | undefined {
    if (value instanceof Uint8Array) {
        return value.byteLength;
    }

    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }

    return undefined;
}

function isRemoteUrlString(value: unknown): value is string {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function utf8ByteLength(value: string): number {
    let bytes = 0;

    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        if (codePoint === undefined) {
            continue;
        }

        if (codePoint <= 0x7f) {
            bytes += 1;
        } else if (codePoint <= 0x7ff) {
            bytes += 2;
        } else if (codePoint <= 0xffff) {
            bytes += 3;
        } else {
            bytes += 4;
            index += 1;
        }
    }

    return bytes;
}
