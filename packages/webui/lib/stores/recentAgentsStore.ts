import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentAgent {
    id: string;
    name: string;
    path: string;
    lastUsed: number;
}

interface RecentAgentsStore {
    recentAgents: RecentAgent[];
    addRecentAgent: (agent: { id: string; name: string; path: string }) => void;
    clearRecentAgents: () => void;
}

const MAX_RECENT_AGENTS = 5;

export const useRecentAgentsStore = create<RecentAgentsStore>()(
    persist(
        (set) => ({
            recentAgents: [],

            addRecentAgent: (agent) =>
                set((state) => {
                    const filtered = state.recentAgents.filter((a) => a.path !== agent.path);
                    const updated: RecentAgent[] = [
                        { ...agent, lastUsed: Date.now() },
                        ...filtered,
                    ].slice(0, MAX_RECENT_AGENTS);

                    return { recentAgents: updated };
                }),

            clearRecentAgents: () => set({ recentAgents: [] }),
        }),
        {
            name: 'dexto:recentAgents',
        }
    )
);
