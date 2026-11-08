import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import * as context from './index.js';

const PNG_1X1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('@dexto/core/context', () => {
    it("gives a host the model's view of a tool result, its images as image parts", async () => {
        const sanitized = await context.sanitizeToolResult(
            {
                ok: true,
                content: [
                    { type: 'text', text: 'Observed the screen.' },
                    { type: 'image', image: PNG_1X1, mimeType: 'image/png' },
                ],
            },
            { toolName: 'capabilities_call', toolCallId: 'call-1', success: true },
            createMockLogger()
        );

        expect(sanitized.content).toEqual([
            { type: 'text', text: 'Observed the screen.' },
            { type: 'image', image: PNG_1X1, mimeType: 'image/png' },
        ]);
    });
});
