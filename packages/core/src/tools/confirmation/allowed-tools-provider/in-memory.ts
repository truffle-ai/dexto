import type { AllowedToolsProvider } from './types.js';

export class InMemoryAllowedToolsProvider implements AllowedToolsProvider {
    /**
     * Map key is sessionId (undefined => global approvals). Value is a set of
     * approved tool names.
     */
    private store: Map<string | undefined, Set<string>> = new Map();

    constructor(initialGlobal?: Set<string>) {
        if (initialGlobal) {
            this.store.set(undefined, new Set(initialGlobal));
        }
    }

    private getSet(sessionId?: string): Set<string> {
        const key = sessionId ?? undefined;
        let set = this.store.get(key);
        if (!set) {
            set = new Set<string>();
            this.store.set(key, set);
        }
        return set;
    }

    async allowTool(toolName: string, sessionId?: string): Promise<void> {
        this.getSet(sessionId).add(toolName);
    }

    async disallowTool(toolName: string, sessionId?: string): Promise<void> {
        this.getSet(sessionId).delete(toolName);
    }

    async isToolAllowed(toolName: string, sessionId?: string): Promise<boolean> {
        const scopedSet = this.store.get(sessionId ?? undefined);
        const globalSet = this.store.get(undefined);
        return Boolean(scopedSet?.has(toolName) || globalSet?.has(toolName));
    }

    async getAllowedTools(sessionId?: string): Promise<Set<string>> {
        return new Set(this.getSet(sessionId));
    }
}
