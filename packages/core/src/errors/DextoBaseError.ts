/**
 * Generate a trace ID without Node builtins. `crypto.randomUUID` only exists in secure browser
 * contexts, so fall back to a v4 UUID from `getRandomValues`, then to a non-cryptographic ID,
 * so constructing an error never throws.
 */
function generateTraceId(): string {
    const webCrypto: typeof globalThis.crypto | undefined = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === 'function') {
        return webCrypto.randomUUID();
    }
    if (typeof webCrypto?.getRandomValues === 'function') {
        const bytes = webCrypto.getRandomValues(new Uint8Array(16));
        bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
        bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Abstract base class for all Dexto errors
 * Provides common functionality like trace ID generation and JSON serialization
 */
export abstract class DextoBaseError extends Error {
    public readonly traceId: string;

    constructor(message: string, traceId?: string) {
        super(message);
        this.traceId = traceId || generateTraceId();
        // Ensure the name is set to the actual class name
        this.name = this.constructor.name;
    }

    /**
     * Convert error to JSON representation
     * Must be implemented by subclasses
     */
    abstract toJSON(): Record<string, any>;
}
