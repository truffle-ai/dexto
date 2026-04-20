import { context, propagation, type BaggageEntry, type Context } from '@opentelemetry/api';
import {
    getHostRuntimeBaggageEntries,
    isHostRuntimeBaggageKey,
    normalizeHostRuntimeContext,
    type HostRuntimeContext,
} from './host-runtime.js';

export interface AgentRunContext {
    sessionId: string;
    hostRuntime?: HostRuntimeContext | undefined;
    telemetryContext: Context;
}

export function createAgentRunContext(options: {
    sessionId: string;
    hostRuntime?: HostRuntimeContext | undefined;
    parentContext?: Context | undefined;
}): AgentRunContext {
    const hostRuntime = normalizeHostRuntimeContext(options.hostRuntime);
    const parentContext = options.parentContext ?? context.active();
    const existingBaggage = propagation.getBaggage(parentContext);
    const baggageEntries: Record<string, BaggageEntry> = {};

    if (existingBaggage) {
        existingBaggage.getAllEntries().forEach(([key, entry]) => {
            if (isHostRuntimeBaggageKey(key)) {
                return;
            }
            baggageEntries[key] = { ...entry };
        });
    }

    Object.assign(baggageEntries, getHostRuntimeBaggageEntries(hostRuntime));
    baggageEntries.sessionId = { ...baggageEntries.sessionId, value: options.sessionId };

    return Object.freeze({
        sessionId: options.sessionId,
        ...(hostRuntime !== undefined ? { hostRuntime } : {}),
        telemetryContext: propagation.setBaggage(
            parentContext,
            propagation.createBaggage(baggageEntries)
        ),
    });
}
