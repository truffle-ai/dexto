import { context as otlpContext, propagation, trace } from '@opentelemetry/api';
import type { BaggageEntry, Context, Tracer } from '@opentelemetry/api';
import type { OtelConfiguration } from './schemas.js';

export type TelemetryShutdownHandler = () => Promise<void>;

export type TelemetryRegistrationOptions = {
    config?: OtelConfiguration | undefined;
    initialized?: boolean | undefined;
    shutdown?: TelemetryShutdownHandler | undefined;
};

type TelemetryInstanceOptions = {
    initialized: boolean;
    shutdown?: TelemetryShutdownHandler | undefined;
};

export type BrowserTelemetryInstance = Pick<
    Telemetry,
    'forceFlush' | 'isInitialized' | 'name' | 'shutdown' | 'tracer'
>;

function isGlobalTelemetryLike(value: unknown): value is BrowserTelemetryInstance {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return (
        typeof Reflect.get(value, 'forceFlush') === 'function' &&
        typeof Reflect.get(value, 'isInitialized') === 'function' &&
        typeof Reflect.get(value, 'name') === 'string' &&
        typeof Reflect.get(value, 'shutdown') === 'function' &&
        Reflect.get(value, 'tracer') !== undefined
    );
}

export class Telemetry {
    public tracer: Tracer;
    name: string;
    private _isInitialized: boolean;
    private _shutdownHandler?: TelemetryShutdownHandler | undefined;
    private static _initPromise?: Promise<BrowserTelemetryInstance> | undefined;

    private constructor(config: OtelConfiguration, options: TelemetryInstanceOptions) {
        const serviceName = config.serviceName ?? 'dexto-service';
        const tracerName = config.tracerName ?? serviceName;

        this.name = serviceName;
        this.tracer = trace.getTracer(tracerName);
        this._shutdownHandler = options.shutdown;
        this._isInitialized = options.initialized;
    }

    static async registerGlobal(
        options: TelemetryRegistrationOptions = {}
    ): Promise<BrowserTelemetryInstance> {
        const existing = Telemetry.getGlobalInstance();
        if (existing !== undefined) {
            return existing;
        }

        if (Telemetry._initPromise !== undefined) {
            return Telemetry._initPromise;
        }

        Telemetry._initPromise = Promise.resolve().then(() => {
            const current = Telemetry.getGlobalInstance();
            if (current !== undefined) {
                return current;
            }

            const telemetry = new Telemetry(options.config ?? {}, {
                initialized: options.initialized ?? true,
                ...(options.shutdown !== undefined && { shutdown: options.shutdown }),
            });
            Telemetry.setGlobalInstance(telemetry);
            return telemetry;
        });

        return Telemetry._initPromise;
    }

    static getActiveSpan() {
        return trace.getActiveSpan();
    }

    static get(): BrowserTelemetryInstance {
        const telemetry = Telemetry.getGlobalInstance();
        if (telemetry === undefined) {
            throw new Error('Telemetry not initialized. Call Telemetry.registerGlobal() first.');
        }
        return telemetry;
    }

    static hasGlobalInstance(): boolean {
        return Telemetry.getGlobalInstance() !== undefined;
    }

    static async shutdownGlobal(): Promise<void> {
        const telemetry = Telemetry.getGlobalInstance();
        if (telemetry !== undefined) {
            await telemetry.shutdown();
        }
        Telemetry.setGlobalInstance(undefined);
        Telemetry._initPromise = undefined;
    }

    static setBaggage(baggage: Record<string, BaggageEntry>, ctx: Context = otlpContext.active()) {
        const currentBaggage = Object.fromEntries(
            propagation.getBaggage(ctx)?.getAllEntries() ?? []
        );
        return propagation.setBaggage(
            ctx,
            propagation.createBaggage({
                ...currentBaggage,
                ...baggage,
            })
        );
    }

    static withContext<T>(ctx: Context, fn: () => T): T {
        return otlpContext.with(ctx, fn);
    }

    public isInitialized(): boolean {
        return this._isInitialized;
    }

    public async forceFlush(): Promise<void> {
        const provider = trace.getTracerProvider();
        const forceFlush = Reflect.get(provider, 'forceFlush');
        if (typeof forceFlush === 'function') {
            await Reflect.apply(forceFlush, provider, []);
        }
    }

    public async shutdown(): Promise<void> {
        try {
            await this._shutdownHandler?.();
        } finally {
            this._isInitialized = false;
            this._shutdownHandler = undefined;
            Telemetry.setGlobalInstance(undefined);
            Telemetry._initPromise = undefined;
        }
    }

    private static getGlobalInstance(): BrowserTelemetryInstance | undefined {
        const telemetry = Reflect.get(globalThis, '__TELEMETRY__');
        return isGlobalTelemetryLike(telemetry) ? telemetry : undefined;
    }

    private static setGlobalInstance(telemetry: Telemetry | undefined): void {
        if (telemetry === undefined) {
            Reflect.deleteProperty(globalThis, '__TELEMETRY__');
            return;
        }
        Reflect.set(globalThis, '__TELEMETRY__', telemetry);
    }
}
