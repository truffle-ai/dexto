import { describe, it, expect } from 'vitest';
import { truncateStringOutput, truncateToolResult } from './tool-output-truncator.js';
import { SanitizedToolResult } from '../../context/types.js';

describe('tool-output-truncator', () => {
    describe('truncateStringOutput', () => {
        it('should not truncate if output is within limit', () => {
            const output = 'short output';
            const result = truncateStringOutput(output, { maxChars: 100 });
            expect(result.truncated).toBe(false);
            expect(result.output).toBe(output);
            expect(result.originalLength).toBe(output.length);
        });

        it('should truncate if output exceeds limit', () => {
            const output = 'long output that exceeds the limit';
            const maxChars = 10;
            const result = truncateStringOutput(output, { maxChars });
            expect(result.truncated).toBe(true);
            expect(result.output).toContain('[Output truncated');
            expect(result.output.startsWith('long outpu')).toBe(true);
            expect(result.originalLength).toBe(output.length);
        });

        it('should use default limit if not provided', () => {
            // Use input significantly larger than default limit (120,000)
            // so the truncation saves more chars than the appended message adds
            const output = 'a'.repeat(150000);
            const result = truncateStringOutput(output);
            expect(result.truncated).toBe(true);
            // Output should be ~120,000 + truncation message (~104 chars) = ~120,104
            // which is less than original 150,000
            expect(result.output.length).toBeLessThan(output.length);
            expect(result.output).toContain('[Output truncated');
        });
    });

    describe('truncateToolResult', () => {
        it('should truncate text parts in SanitizedToolResult', () => {
            const longText = 'a'.repeat(200);
            const toolResult: SanitizedToolResult = {
                content: [
                    { type: 'text', text: longText },
                    { type: 'image', image: 'data:image/png;base64,...' },
                ],
                meta: { toolName: 'test', toolCallId: '123', success: true },
            };

            const result = truncateToolResult(toolResult, { maxChars: 100 });

            const firstPart = result.content[0];
            expect(firstPart).toBeDefined();
            if (firstPart) {
                expect(firstPart.type).toBe('text');
            }

            if (firstPart && firstPart.type === 'text') {
                expect(firstPart.text).toContain('[Output truncated');
                expect(firstPart.text.length).toBeLessThan(longText.length);
            }

            // Should preserve other parts
            expect(result.content[1]).toEqual(toolResult.content[1]);
        });

        it('should not modify result if no truncation needed', () => {
            const toolResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'short' }],
                meta: { toolName: 'test', toolCallId: '123', success: true },
            };

            const result = truncateToolResult(toolResult, { maxChars: 100 });
            expect(result).toEqual(toolResult);
        });
    });
});
