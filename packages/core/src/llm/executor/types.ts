import { TokenUsage } from '../types.js';

export interface ExecutorResult {
    stepCount: number;
    usage: TokenUsage | null;
    finishReason: string;
}

export interface StreamProcessorResult {
    finishReason: string;
    usage: TokenUsage | null;
}

export interface ToolState {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    output?: string;
}
