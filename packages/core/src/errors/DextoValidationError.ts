import { DextoBaseError } from './DextoBaseError.js';
import type { Issue } from './types.js';

/**
 * Validation error class for handling multiple validation issues
 * Similar to ZodError, provides first-class access to all validation issues
 */
export class DextoValidationError extends DextoBaseError {
    public readonly issues: Issue[];

    constructor(issues: Issue[]) {
        const message = DextoValidationError.formatMessage(issues);
        super(message);
        this.name = 'DextoValidationError';
        this.issues = issues;
    }

    /**
     * Format multiple issues into a readable error message
     */
    private static formatMessage(issues: Issue[]): string {
        if (issues.length === 0) {
            return 'Validation failed';
        }

        if (issues.length === 1) {
            return issues[0]!.message; // We know it exists after length check
        }

        const errors = issues.filter((i) => i.severity === 'error');
        const warnings = issues.filter((i) => i.severity === 'warning');

        const parts: string[] = [];
        if (errors.length > 0) {
            parts.push(`${errors.length} error${errors.length > 1 ? 's' : ''}`);
        }
        if (warnings.length > 0) {
            parts.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
        }

        return `Validation failed with ${parts.join(' and ')}`;
    }

    /**
     * Get only error-severity issues
     */
    get errors(): Issue[] {
        return this.issues.filter((i) => i.severity === 'error');
    }

    /**
     * Get only warning-severity issues
     */
    get warnings(): Issue[] {
        return this.issues.filter((i) => i.severity === 'warning');
    }

    /**
     * Check if there are any error-severity issues
     */
    hasErrors(): boolean {
        return this.errors.length > 0;
    }

    /**
     * Check if there are any warning-severity issues
     */
    hasWarnings(): boolean {
        return this.warnings.length > 0;
    }

    /**
     * Get the first error-severity issue (if any)
     * Useful for getting the primary error when multiple exist
     */
    get firstError(): Issue | undefined {
        return this.errors[0];
    }

    /**
     * Get the first warning-severity issue (if any)
     */
    get firstWarning(): Issue | undefined {
        return this.warnings[0];
    }

    /**
     * Format issues for display
     * Returns an object with categorized issues for easy logging
     */
    format(): { errors: string[]; warnings: string[] } {
        return {
            errors: this.errors.map((e) => `[${e.code}] ${e.message}`),
            warnings: this.warnings.map((w) => `[${w.code}] ${w.message}`),
        };
    }

    /**
     * Convert to JSON representation
     */
    toJSON(): Record<string, any> {
        return {
            name: this.name,
            message: this.message,
            issues: this.issues,
            traceId: this.traceId,
            errorCount: this.errors.length,
            warningCount: this.warnings.length,
        };
    }
}
