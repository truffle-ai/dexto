import { randomUUID } from 'crypto';
import { ErrorScope } from './types.js';
import { ErrorType } from './types.js';
import type { DextoErrorCode } from './types.js';

/**
 * Base error class for all Dexto errors
 * Provides structured error information with scope, type, and recovery guidance
 */
export class DextoError<C = unknown> extends Error {
    public readonly traceId: string;

    constructor(
        public readonly code: DextoErrorCode,
        public readonly scope: ErrorScope,
        public readonly type: ErrorType,
        message: string,
        public readonly context?: C,
        public readonly recovery?: string | string[],
        traceId?: string
    ) {
        super(message);
        this.name = new.target.name;
        this.traceId = traceId || randomUUID();
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
            scope: this.scope,
            type: this.type,
            context: this.context,
            recovery: this.recovery,
            traceId: this.traceId,
        };
    }
}
