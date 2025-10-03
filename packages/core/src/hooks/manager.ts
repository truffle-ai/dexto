import { logger } from '../logger/index.js';
import type {
    HookHandler,
    HookName,
    HookNotice,
    HookPayloadMap,
    HookResult,
    RegisterOptions,
    HookRunResult,
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
    ): Promise<HookRunResult<HookPayloadMap[K]>> {
        const list = [...(this.handlers[name] as HandlerEntry<HookPayloadMap[K]>[])];

        let current = { ...payload } as HookPayloadMap[K];
        let notices: HookNotice[] | undefined;
        for (const entry of list) {
            try {
                const res = await entry.handler(current);
                if (res && typeof res === 'object') {
                    const result = res as HookResult<HookPayloadMap[K]>;
                    if (result.notices && result.notices.length > 0) {
                        notices = notices ? [...notices, ...result.notices] : [...result.notices];
                    }
                    if (result.modify) {
                        current = { ...current, ...result.modify };
                    }
                    if (result.cancel) {
                        if (entry.once) this.remove(name, entry.id);
                        return {
                            payload: current,
                            canceled: true,
                            ...(result.responseOverride !== undefined && {
                                responseOverride: result.responseOverride,
                            }),
                            ...(notices && { notices }),
                        };
                    }
                }
                if (entry.once) this.remove(name, entry.id);
            } catch (err) {
                logger.error(
                    `Hook '${name}' handler threw error: ${err instanceof Error ? err.message : String(err)}`
                );
                return { payload: current, canceled: true, ...(notices && { notices }) };
            }
        }
        return { payload: current, canceled: false, ...(notices && { notices }) };
    }
}
