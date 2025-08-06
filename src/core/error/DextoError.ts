import { randomUUID } from 'crypto';
import { ErrorScope } from './types.js';
import { ErrorType } from './types.js';
import type { Issue } from './types.js';
import type { DextoErrorCode } from './types.js';
import { logger } from '../logger/index.js';

/**
 * Base error class for all Dexto errors
 * Provides structured error information with scope, type, and recovery guidance
 */
export class DextoError<C = unknown> extends Error {
    public readonly severity: 'error' | 'warning';
    public readonly details: Record<string, unknown> | undefined;
    public readonly issues: Issue<C>[];
    public readonly recovery: string | string[] | undefined;
    public readonly traceId: string;

    constructor(
        public readonly code: DextoErrorCode,
        public readonly scope: ErrorScope,
        public readonly type: ErrorType,
        message: string,
        {
            severity = 'error',
            details,
            issues = [],
            recovery,
            traceId = randomUUID(),
        }: {
            severity?: 'error' | 'warning';
            details?: Record<string, unknown>;
            issues?: Issue<C>[];
            recovery?: string | string[];
            traceId?: string;
        } = {}
    ) {
        super(message);
        this.name = new.target.name;
        this.severity = severity;
        this.details = details;
        this.issues = issues;
        this.recovery = recovery;
        this.traceId = traceId;

        // Optional telemetry hook
        // if (logger.trackException) {
        //     logger.trackException(this);
        // }
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
            scope: this.scope,
            type: this.type,
            severity: this.severity,
            details: this.details,
            issues: this.issues,
            recovery: this.recovery,
            traceId: this.traceId,
        };
    }
}
