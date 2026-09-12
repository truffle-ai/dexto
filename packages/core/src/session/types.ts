import { z } from 'zod';
import { ContentPartSchema } from '../context/schemas.js';
import type { ContentPart } from '../context/types.js';

export const QueuedMessageSchema: z.ZodType<QueuedMessage> = z.custom<QueuedMessage>(
    (value) =>
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string' &&
        'queuedAt' in value &&
        typeof value.queuedAt === 'number' &&
        'content' in value &&
        Array.isArray(value.content) &&
        value.content.every((part: unknown) => ContentPartSchema.safeParse(part).success),
    { message: 'Expected a Dexto queued message.' }
);

export const QueuedMessagesSchema = z.array(QueuedMessageSchema);

export const CoalescedMessageSchema: z.ZodType<CoalescedMessage> = z
    .object({
        messages: QueuedMessagesSchema,
        combinedContent: z.array(ContentPartSchema),
        firstQueuedAt: z.number(),
        lastQueuedAt: z.number(),
    })
    .strict();

export interface QueuedMessage {
    id: string;
    content: ContentPart[];
    queuedAt: number;
    metadata?: Record<string, unknown>;
    kind?: 'default' | 'background';
}

export interface CoalescedMessage {
    messages: QueuedMessage[];
    combinedContent: ContentPart[];
    firstQueuedAt: number;
    lastQueuedAt: number;
}

/**
 * Queued input restored from storage for a run that no longer exists (interrupted process or
 * evicted session). Held for an explicit resume/discard decision; never executed on its own.
 */
export interface RestoredPendingInput {
    steer: QueuedMessage[];
    followUp: QueuedMessage[];
}
