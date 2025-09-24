import { logger } from '../logger/index.js';
import type {
    HookHandler,
    HookName,
    HookPayloadMap,
    HookResult,
    RegisterOptions,
} from './types.js';

type HandlerEntry<T> = {
    id: string;
    priority: number;
    once: boolean;
    handler: HookHandler<T>;
};

export class HookManager {
    private handlers: {
        [K in HookName]: HandlerEntry<HookPayloadMap[K]>[];
    } = {
        beforeInput: [],
        beforeToolCall: [],
        afterToolResult: [],
        beforeResponse: [],
    };

    use<K extends HookName>(
        name: K,
        handler: HookHandler<HookPayloadMap[K]>,
        options?: RegisterOptions
    ) {
        const entry: HandlerEntry<HookPayloadMap[K]> = {
            id: options?.id ?? `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            priority: options?.priority ?? 0,
            once: options?.once ?? false,
            handler,
        };
        const list = this.handlers[name] as HandlerEntry<HookPayloadMap[K]>[];
        list.push(entry);
        list.sort((a, b) => b.priority - a.priority);
        return entry.id;
    }

    has(name: HookName): boolean {
        return (this.handlers[name] as HandlerEntry<any>[]).length > 0;
    }

    remove(name: HookName, id: string) {
        const list = this.handlers[name];
        const idx = list.findIndex((h) => h.id === id);
        if (idx >= 0) list.splice(idx, 1);
    }

    async run<K extends HookName>(
        name: K,
        payload: HookPayloadMap[K]
    ): Promise<{ payload: HookPayloadMap[K]; canceled: boolean; responseOverride?: string }> {
        const list = [...(this.handlers[name] as HandlerEntry<HookPayloadMap[K]>[])];

        let current = { ...payload } as HookPayloadMap[K];
        for (const entry of list) {
            try {
                const res = await entry.handler(current);
                if (res && typeof res === 'object') {
                    const result = res as HookResult<HookPayloadMap[K]>;
                    if (result.modify) {
                        current = { ...current, ...result.modify };
                    }
                    if (result.cancel) {
                        if (entry.once) this.remove(name, entry.id);
                        const ret: {
                            payload: HookPayloadMap[K];
                            canceled: boolean;
                            responseOverride?: string;
                        } = {
                            payload: current,
                            canceled: true,
                        };
                        if (result.responseOverride !== undefined) {
                            ret.responseOverride = result.responseOverride;
                        }
                        return ret;
                    }
                }
                if (entry.once) this.remove(name, entry.id);
            } catch (err) {
                logger.error(
                    `Hook '${name}' handler threw error: ${err instanceof Error ? err.message : String(err)}`
                );
                return { payload: current, canceled: true };
            }
        }
        return { payload: current, canceled: false };
    }
}
