import type { AllowedToolsProvider } from './types.js';
import { ToolError } from '../../errors.js';

export class InMemoryAllowedToolsProvider implements AllowedToolsProvider {
    private store: Map<string, Set<string>> = new Map();

    private requireSessionId(sessionId: string | undefined): string {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            throw ToolError.validationFailed(
                'tool_approval_memory',
                'sessionId is required for remembered tool approvals'
            );
        }
        return sessionId;
    }

    private getSet(sessionId: string): Set<string> {
        let set = this.store.get(sessionId);
        if (!set) {
            set = new Set<string>();
            this.store.set(sessionId, set);
        }
        return set;
    }

    async allowTool(toolName: string, sessionId: string): Promise<void> {
        this.getSet(this.requireSessionId(sessionId)).add(toolName);
    }

    async disallowTool(toolName: string, sessionId: string): Promise<void> {
        this.getSet(this.requireSessionId(sessionId)).delete(toolName);
    }

    async isToolAllowed(toolName: string, sessionId: string): Promise<boolean> {
        const bucket = this.store.get(this.requireSessionId(sessionId));
        return Boolean(bucket?.has(toolName));
    }

    async getAllowedTools(sessionId: string): Promise<Set<string>> {
        const bucket = this.store.get(this.requireSessionId(sessionId));
        return new Set(bucket ?? []);
    }
}
