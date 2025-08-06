/**
 * Core issue types used by both Result pattern and DextoError
 * Moved here to avoid circular dependencies
 */

import type { DextoErrorCode } from './codes.js';

/** Severity of an issue */
export type Severity = 'error' | 'warning';

/** Generic issue type for validation results */

export interface Issue<C = unknown> {
    code: DextoErrorCode;
    message: string;
    path?: Array<string | number>;
    severity: Severity;
    context?: C;
}
