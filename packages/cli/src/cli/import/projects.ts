import type { LocalChat } from './transcript.js';

export interface ImportProject {
    readonly root: string;
    readonly chats: LocalChat[];
}

/** Group sessions by their common repository root. Sessions without a known repository are omitted. */
export function groupProjects(chats: readonly LocalChat[]): ImportProject[] {
    const projects = new Map<string, ImportProject>();
    for (const chat of chats) {
        const root = chat.repository?.root;
        if (root == null) continue;
        let project = projects.get(root);
        if (project === undefined) {
            project = { root, chats: [] };
            projects.set(root, project);
        }
        project.chats.push(chat);
    }
    return [...projects.values()];
}
