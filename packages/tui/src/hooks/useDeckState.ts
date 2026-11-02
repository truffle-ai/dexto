/**
 * Gathers the Signal deck's state from the CLI: what the agent is doing, a short readout,
 * and the status line (model, context, branch, credits).
 */
import { useEffect, useRef, useState } from 'react';
import type { CodexRateLimitSnapshot } from '@dexto/core';
import type { TuiAgentBackend } from '../agent-backend.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { DeckState } from '../signal/index.js';
import type { Message, UIState } from '../state/types.js';
import { resolveChatGPTRateLimitHint } from '../utils/chatgpt-rate-limit.js';
import { displayedReasoningVariant } from '../utils/reasoning-variant.js';
import {
    deckCredits,
    deckMode,
    deckModelId,
    deckReadout,
    nextTurnBaseline,
    permissionLabel,
    type TurnBaseline,
} from '../utils/deck-state.js';
import { useContextStats } from './useContextStats.js';
import { useDextoAccount, useDextoCreditBalance } from './useDextoCredits.js';
import { useElapsedTime } from './useElapsedTime.js';
import { useGitDirtyFiles } from './useGitDirtyFiles.js';
import { useTokenCounter } from './useTokenCounter.js';

export interface DeckStateInput {
    agent: TuiAgentBackend;
    sessionId: string | null;
    modelName: string;
    ui: UIState;
    approval: ApprovalRequest | null;
    pendingMessages: readonly Message[];
    steerCount: number;
    branch: string | null;
    cwd: string;
    isShellMode: boolean;
    chatgptRateLimitStatus: CodexRateLimitSnapshot | null;
}

/** Whether the last run ended on an error; reset when the next run starts. */
function useLastRunFailed(
    agent: TuiAgentBackend,
    sessionId: string | null,
    isProcessing: boolean
): boolean {
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (isProcessing) setFailed(false);
    }, [isProcessing]);
    // A failure belongs to its session: switching sessions clears it.
    useEffect(() => {
        setFailed(false);
    }, [sessionId]);
    useEffect(() => {
        const controller = new AbortController();
        agent.on(
            'run:complete',
            (payload: { sessionId?: string; finishReason: string }) => {
                if (payload.sessionId && payload.sessionId !== sessionId) return;
                setFailed(payload.finishReason === 'error');
            },
            { signal: controller.signal }
        );
        return () => controller.abort();
    }, [agent, sessionId]);
    return failed;
}

export function useDeckState(input: DeckStateInput): DeckState {
    const { agent, sessionId, ui, approval } = input;
    const [, setLlmTick] = useState(0);
    const llmConfig = sessionId ? agent.getCurrentLLMConfig(sessionId) : null;

    const lastRunFailed = useLastRunFailed(agent, sessionId, ui.isProcessing);
    const mode = deckMode({
        isProcessing: ui.isProcessing,
        isCancelling: ui.isCancelling,
        isThinking: ui.isThinking,
        isCompacting: ui.isCompacting,
        awaitingUser: approval !== null,
        toolRunning: input.pendingMessages.some(
            (m) => m.role === 'tool' && m.toolStatus === 'running'
        ),
        steerCount: input.steerCount,
        lastRunFailed,
    });

    const working = ui.isProcessing && approval === null && !ui.copyModeEnabled;
    const run = useElapsedTime({ isActive: working, intervalMs: 1000 });
    const wait = useElapsedTime({ isActive: approval !== null, intervalMs: 1000 });
    const { formatted: tokens } = useTokenCounter({ agent, isActive: working });
    const readout = deckReadout(mode, {
        elapsed: mode === 'wait' ? wait.formatted : run.formatted,
        tokens,
        compacting: ui.isCompacting,
        steerCount: input.steerCount,
        permission: permissionLabel({
            isShellMode: input.isShellMode,
            planModeActive: ui.planModeActive,
            autoApproveEdits: ui.autoApproveEdits,
            bypassPermissions: ui.bypassPermissions,
            configuredMode: agent.getEffectiveConfig(sessionId ?? undefined).permissions.mode,
        }),
        reasoning: displayedReasoningVariant(llmConfig),
        rateLimitHint: resolveChatGPTRateLimitHint(
            llmConfig,
            input.chatgptRateLimitStatus,
            'short'
        ),
    });

    const context = useContextStats(agent, sessionId, () => setLlmTick((prev) => prev + 1));
    // Login and logout run in overlays: re-check the account whenever one opens or closes.
    const account = useDextoAccount(agent, ui.activeOverlay);
    const balance = useDextoCreditBalance(
        agent,
        sessionId,
        account,
        ui.activeOverlay === 'insufficient-credits'
    );
    // The balance when the current turn started, so the status line can show what it spent.
    const turnBaseline = useRef<TurnBaseline>({
        sessionId,
        account,
        isProcessing: false,
        balance: null,
    });
    turnBaseline.current = nextTurnBaseline(turnBaseline.current, {
        sessionId,
        account,
        isProcessing: ui.isProcessing,
        balance,
    });
    const dirtyFiles = useGitDirtyFiles(agent, input.cwd);

    return {
        mode,
        readout,
        status: {
            model: deckModelId(llmConfig?.provider ?? null, llmConfig?.model ?? input.modelName),
            contextUsedTokens: context?.usedTokens ?? null,
            contextMaxTokens: context?.maxTokens ?? null,
            where: { kind: 'local' },
            branch: input.branch,
            dirtyFiles,
            credits: deckCredits({
                signedIn: account !== null,
                balance,
                turnStartBalance: turnBaseline.current.balance,
            }),
        },
    };
}
