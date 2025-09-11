import { randomUUID } from 'crypto';

/**
 * Abstract base class for all Dexto errors
 * Provides common functionality like trace ID generation and JSON serialization
 */
export abstract class DextoBaseError extends Error {
    public readonly traceId: string;

    constructor(message: string, traceId?: string) {
        super(message);
        this.traceId = traceId || randomUUID();
        // Ensure the name is set to the actual class name
        this.name = this.constructor.name;
    }

    /**
     * Convert error to JSON representation
     * Must be implemented by subclasses
     */
    abstract toJSON(): Record<string, any>;
}
