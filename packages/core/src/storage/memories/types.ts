import type { Memory } from '../../memory/types.js';

export interface MemoryStore {
    create(input: { memory: Memory }): Promise<void>;
    get(input: { id: string }): Promise<Memory | undefined>;
    update(input: { memory: Memory }): Promise<void>;
    delete(input: { id: string }): Promise<void>;
    list(): Promise<Memory[]>;
}
