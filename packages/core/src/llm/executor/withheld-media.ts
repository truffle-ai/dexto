import { APICallError, type ModelMessage, type ToolResultPart } from 'ai';

/**
 * Whether the provider refused the request itself (HTTP 400). A refusal like this is caused by
 * what the request carries, so sending the same history again fails the same way.
 */
export function isRejectedModelRequest(error: unknown): boolean {
    return APICallError.isInstance(error) && error.statusCode === 400;
}

/** A provider saying the media itself could not be opened, in each provider's wording. */
const DAMAGED_MEDIA_PATTERN =
    /badly formatted|corrupt|malformed|damaged|truncated|(?:could not|couldn't|unable to)(?: be)? (?:read|pars|process|decod)|invalid (?:pdf|file|image)/iu;

/** Why the provider refused the request, as far as its error says: the media is damaged, or unknown. */
type RejectionCause = 'damaged' | 'unknown';

/**
 * The error names no item, so "damaged" is said only of a request's one media item: with several,
 * the good ones (earlier screenshots still in the request, say) would be called damaged too.
 */
function rejectionCause(error: unknown, mediaCount: number): RejectionCause {
    if (mediaCount !== 1 || !APICallError.isInstance(error)) return 'unknown';
    return DAMAGED_MEDIA_PATTERN.test(`${error.message}\n${error.responseBody ?? ''}`)
        ? 'damaged'
        : 'unknown';
}

/**
 * The note that stands in for the media. A damaged file says so, or the model asks the person to
 * send the same broken file again. The provider's own words are never quoted into the prompt.
 */
function withheldMediaText(label: 'Image' | 'File', cause: RejectionCause): string {
    return cause === 'damaged'
        ? `[${label} not read: the model provider could not open it because it is damaged or not a valid file. Tell the person the ${label.toLowerCase()} looks damaged and could not be read; sending the same ${label.toLowerCase()} again will not help, so ask for a fresh export or its text.]`
        : `[${label} withheld: the model provider rejected the request that carried it]`;
}

function mediaLabel(mediaType: string): 'Image' | 'File' {
    return mediaType.startsWith('image/') ? 'Image' : 'File';
}

/**
 * The request's messages with every user and tool-result image or file replaced by a text
 * placeholder that says why, as far as the provider's `error` tells, or null when no message
 * carries media.
 */
export function withholdRequestMedia(
    messages: ModelMessage[],
    error: unknown
): ModelMessage[] | null {
    const cause = rejectionCause(error, countMedia(messages));
    let withheld = false;
    const result = messages.map((message): ModelMessage => {
        if (message.role === 'user' && Array.isArray(message.content)) {
            return {
                ...message,
                content: message.content.map((part) => {
                    if (part.type === 'text') return part;
                    withheld = true;
                    return {
                        type: 'text',
                        text: withheldMediaText(
                            part.type === 'image' ? 'Image' : mediaLabel(part.mediaType),
                            cause
                        ),
                    };
                }),
            };
        }
        if (message.role === 'tool') {
            return {
                ...message,
                content: message.content.map((part): ToolResultPart => {
                    if (part.output.type !== 'content') return part;
                    return {
                        ...part,
                        output: {
                            type: 'content',
                            value: part.output.value.map((item) => {
                                if (item.type === 'text') return item;
                                withheld = true;
                                return {
                                    type: 'text',
                                    text: withheldMediaText(mediaLabel(item.mediaType), cause),
                                };
                            }),
                        },
                    };
                }),
            };
        }
        return message;
    });
    return withheld ? result : null;
}

function countMedia(messages: ModelMessage[]): number {
    let count = 0;
    for (const message of messages) {
        if (message.role === 'user' && Array.isArray(message.content)) {
            count += message.content.filter((part) => part.type !== 'text').length;
        } else if (message.role === 'tool') {
            for (const part of message.content) {
                if (part.output.type !== 'content') continue;
                count += part.output.value.filter((item) => item.type !== 'text').length;
            }
        }
    }
    return count;
}
