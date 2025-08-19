import { DextoBaseError } from './DextoBaseError.js';
import { ErrorScope } from './types.js';
import { ErrorType } from './types.js';
import type { DextoErrorCode } from './types.js';

/**
 * Runtime error class for single-issue errors
 * Provides structured error information with scope, type, and recovery guidance
 */
export class DextoRuntimeError<C = unknown> extends DextoBaseError {
    constructor(
        public readonly code: DextoErrorCode,
        public readonly scope: ErrorScope,
        public readonly type: ErrorType,
        message: string,
        public readonly context?: C,
        public readonly recovery?: string | string[],
        traceId?: string
    ) {
        super(message, traceId);
        this.name = 'DextoRuntimeError';
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
