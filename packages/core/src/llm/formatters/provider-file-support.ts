import type { LLMContext } from '@dexto/llm';
import { matchesAnyMimePattern } from '../../context/utils.js';

/**
 * Media types the AI SDK adapter for each provider actually serializes as a file part.
 *
 * The model registry says what a model can understand; this says what the adapter will send.
 * The two differ (for example, OpenAI models accept "documents" but `@ai-sdk/openai` only sends
 * images and PDFs), and the adapters throw `UnsupportedFunctionalityError` before any request is
 * made for anything else, which fails the whole run.
 *
 * `null` means the adapter does not reject by media type, so no restriction is applied.
 * Text-like files are inlined as text before this check, so they are not listed here.
 */
const IMAGE = 'image/*';
const PDF = 'application/pdf';

const OPENAI_CHAT_MEDIA_TYPES = [IMAGE, PDF, 'audio/wav', 'audio/mpeg', 'audio/mp3'];
const ANTHROPIC_MEDIA_TYPES = [IMAGE, PDF];
const BEDROCK_MEDIA_TYPES = [
    IMAGE,
    PDF,
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/html',
    'text/plain',
    'text/markdown',
];

function getAdapterMediaTypes(context: LLMContext): string[] | null {
    switch (context.provider) {
        // OpenAI Responses API adapter
        case 'openai':
            return [IMAGE, PDF];
        // OpenAI Chat Completions adapter
        case 'minimax':
        case 'glm':
        case 'litellm':
        case 'glama':
        case 'ollama':
            return OPENAI_CHAT_MEDIA_TYPES;
        case 'openai-compatible':
        case 'groq':
        case 'xai':
            return [IMAGE];
        case 'cohere':
            return [IMAGE, 'text/*', 'application/json'];
        // OpenRouter forwards anything that is not an image or audio as a PDF-style file
        case 'openrouter':
        case 'dexto-nova':
            return [IMAGE, 'audio/*', PDF];
        case 'anthropic':
            return ANTHROPIC_MEDIA_TYPES;
        case 'vertex':
            return context.model.includes('claude') ? ANTHROPIC_MEDIA_TYPES : null;
        case 'bedrock':
            return BEDROCK_MEDIA_TYPES;
        default:
            return null;
    }
}

/** Whether the provider's AI SDK adapter can serialize a file part with this media type. */
export function isFileMediaTypeSendable(context: LLMContext, mediaType: string): boolean {
    const allowed = getAdapterMediaTypes(context);
    if (allowed === null) return true;

    const baseMediaType = mediaType.split(';', 1)[0]?.trim() ?? mediaType;
    return matchesAnyMimePattern(baseMediaType, allowed);
}

/**
 * Text that stands in for a file the provider cannot receive, so the model still learns the file
 * exists and can read it with tools.
 */
export function buildUnsendableFileNote(file: { filename?: string; mimeType: string }): string {
    const name = file.filename ? `"${file.filename}"` : 'a file';
    return `[Attached ${name} (${file.mimeType}) was not sent to the model because this provider cannot read that file type directly. Use the available tools to read it, or tell the user.]`;
}
