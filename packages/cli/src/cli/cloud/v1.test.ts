import { describe, expect, it } from 'vitest';
import type { SignInContext } from './command.js';
import { v1Failure } from './v1.js';

// A 403 never reaches the sign-in command, so the context is never read.
const context = {} as unknown as SignInContext;

describe('v1Failure', () => {
    it('reports a 403 feature_flag_denied as not_available, with no fix', () => {
        const failure = v1Failure(
            context,
            403,
            JSON.stringify({
                error: { code: 'feature_flag_denied', message: 'Not turned on for you.' },
            })
        );
        expect(failure).toMatchObject({
            fix: null,
            kind: 'not_available',
            message: 'HTTP 403: Not turned on for you.',
        });
    });

    it('reports any other 403 as needs_permission', () => {
        expect(
            v1Failure(
                context,
                403,
                JSON.stringify({ error: { code: 'forbidden', message: 'No.' } })
            ).kind
        ).toBe('needs_permission');
        expect(v1Failure(context, 403, 'not json').kind).toBe('needs_permission');
    });
});
