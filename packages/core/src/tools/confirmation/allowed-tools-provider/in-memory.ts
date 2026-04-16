import type { AllowedToolsProvider } from './types.js';
import { ToolError } from '../../errors.js';

export class InMemoryAllowedToolsProvider implements AllowedToolsProvider {
    private store: Map<string, Set<string>> = new Map();

    private getSet(sessionId: string | undefined): Set<string> {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            throw ToolError.validationFailed(
                'tool_approval_memory',
                'sessionId is required for remembered tool approvals'
            );
        }

        let set = this.store.get(sessionId);
        if (!set) {
            set = new Set<string>();
            this.store.set(sessionId, set);
        }
        return set;
    }

    async allowTool(toolName: string, sessionId: string): Promise<void> {
        this.getSet(sessionId).add(toolName);
    }

    async disallowTool(toolName: string, sessionId: string): Promise<void> {
        this.getSet(sessionId).delete(toolName);
    }

    async isToolAllowed(toolName: string, sessionId: string): Promise<boolean> {
        return Boolean(this.store.get(sessionId)?.has(toolName));
    }

    async getAllowedTools(sessionId: string): Promise<Set<string>> {
        return new Set(this.getSet(sessionId));
    }
}
