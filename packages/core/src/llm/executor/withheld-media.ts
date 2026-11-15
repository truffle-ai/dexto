import { APICallError, type ModelMessage, type ToolResultPart } from 'ai';

/**
 * Whether the provider refused the request itself (HTTP 400). A refusal like this is caused by
 * what the request carries, so sending the same history again fails the same way.
 */
export function isRejectedModelRequest(error: unknown): boolean {
    return APICallError.isInstance(error) && error.statusCode === 400;
}

function withheldMediaText(label: 'Image' | 'File'): string {
    return `[${label} withheld: the model provider rejected the request that carried it]`;
}

function mediaLabel(mediaType: string): 'Image' | 'File' {
    return mediaType.startsWith('image/') ? 'Image' : 'File';
}

/**
 * The request's messages with every user and tool-result image or file replaced by a text
 * placeholder, or null when no message carries media.
 */
export function withholdRequestMedia(messages: ModelMessage[]): ModelMessage[] | null {
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
                            part.type === 'image' ? 'Image' : mediaLabel(part.mediaType)
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
                                    text: withheldMediaText(mediaLabel(item.mediaType)),
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
