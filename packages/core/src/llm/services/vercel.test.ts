import { context } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';
import { ensureRunContextMatchesServiceSession } from './vercel.js';

describe('ensureRunContextMatchesServiceSession', () => {
    it('returns the service session id when the run context matches', () => {
        expect(
            ensureRunContextMatchesServiceSession('session-1', {
                sessionId: 'session-1',
                telemetryContext: context.active(),
            })
        ).toBe('session-1');
    });

    it('throws a typed error when the run context session does not match', () => {
        expect(() =>
            ensureRunContextMatchesServiceSession('session-1', {
                sessionId: 'session-2',
                telemetryContext: context.active(),
            })
        ).toThrowError(
            expect.objectContaining({
                code: LLMErrorCode.GENERATION_FAILED,
                scope: ErrorScope.LLM,
                type: ErrorType.SYSTEM,
            })
        );
    });
});
