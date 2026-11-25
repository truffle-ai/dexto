import { describe, expect, it } from 'vitest';
import {
    deckCollapsed,
    deckCredits,
    deckMode,
    deckModelId,
    deckReadout,
    keepsTurnSpend,
    nextTurnBaseline,
    permissionLabel,
    type DeckActivity,
} from './deck-state.js';

const idle: DeckActivity = {
    isProcessing: false,
    isCancelling: false,
    isThinking: false,
    isCompacting: false,
    awaitingUser: false,
    toolRunning: false,
    steerCount: 0,
    lastRunFailed: false,
};

describe('deckMode', () => {
    it('is READY when nothing runs', () => {
        expect(deckMode(idle)).toBe('idle');
    });

    it('is FAULT after a run that failed, until the next one starts', () => {
        expect(deckMode({ ...idle, lastRunFailed: true })).toBe('fault');
        expect(deckMode({ ...idle, lastRunFailed: true, isProcessing: true })).toBe('stream');
    });

    it('puts waiting on you above everything the agent is doing', () => {
        const busy = { ...idle, isProcessing: true, isThinking: true, toolRunning: true };
        expect(deckMode({ ...busy, awaitingUser: true })).toBe('wait');
    });

    it('shows STOPPED while a cancel lands', () => {
        // Escape sets isCancelling and clears isProcessing together.
        expect(deckMode({ ...idle, isCancelling: true })).toBe('stop');
        expect(deckMode({ ...idle, isCancelling: true, lastRunFailed: true })).toBe('stop');
    });

    it('shows STEERING while a steer waits for the current step', () => {
        expect(deckMode({ ...idle, isProcessing: true, toolRunning: true, steerCount: 1 })).toBe(
            'steer'
        );
    });

    it('tells thinking, tools and streaming apart', () => {
        const run = { ...idle, isProcessing: true };
        expect(deckMode({ ...run, isThinking: true })).toBe('think');
        expect(deckMode({ ...run, toolRunning: true })).toBe('tool');
        expect(deckMode({ ...run, isCompacting: true })).toBe('tool');
        expect(deckMode(run)).toBe('stream');
    });
});

describe('deckReadout', () => {
    const base = {
        elapsed: '12s',
        tokens: '1.9K tokens',
        compacting: false,
        steerCount: 0,
        permission: null,
        reasoning: null,
        rateLimitHint: null,
    };

    it('reads tokens and time while the agent works', () => {
        expect(deckReadout('stream', base)).toBe('1.9K tokens · 12s');
        expect(deckReadout('think', { ...base, tokens: '' })).toBe('12s');
    });

    it('says what it is doing when it compacts', () => {
        expect(deckReadout('tool', { ...base, compacting: true })).toBe('compacting · 12s');
    });

    it('counts queued steers', () => {
        expect(deckReadout('steer', { ...base, steerCount: 2 })).toBe('2 steers queued');
    });

    it('leads with the permission mode during a run, since Shift+Tab still changes it', () => {
        const auto = { ...base, permission: 'full access' };
        expect(deckReadout('stream', auto)).toBe('full access · 1.9K tokens · 12s');
        expect(deckReadout('tool', { ...auto, compacting: true })).toBe(
            'full access · compacting · 12s'
        );
        expect(deckReadout('steer', { ...auto, steerCount: 1 })).toBe(
            'full access · 1 steer queued'
        );
    });

    it('shows how long it has waited on you', () => {
        expect(deckReadout('wait', base)).toBe('paused 12s');
    });

    it('shows the permission mode, then a rate-limit hint, when idle', () => {
        expect(deckReadout('idle', base)).toBeNull();
        expect(deckReadout('idle', { ...base, permission: 'plan mode' })).toBe('plan mode');
        expect(
            deckReadout('idle', { ...base, permission: 'plan mode', rateLimitHint: '91% used' })
        ).toBe('plan mode · 91% used');
    });

    it('puts the usage warning before the reasoning variant, since the end truncates first', () => {
        expect(
            deckReadout('idle', {
                ...base,
                permission: 'full access',
                reasoning: 'medium',
                rateLimitHint: 'cap 95%',
            })
        ).toBe('full access · cap 95% · r:medium');
    });

    it('shows the reasoning variant when idle, so Tab has visible feedback', () => {
        expect(deckReadout('idle', { ...base, reasoning: 'high' })).toBe('r:high');
        expect(deckReadout('idle', { ...base, permission: 'plan mode', reasoning: 'low' })).toBe(
            'plan mode · r:low'
        );
    });
});

describe('deckModelId', () => {
    it('names Dexto models dexto/… and own-key models by provider', () => {
        expect(deckModelId('dexto-nova', 'anthropic/claude-sonnet-4.5')).toBe(
            'dexto/anthropic/claude-sonnet-4.5'
        );
        expect(deckModelId('openai', 'gpt-5')).toBe('openai/gpt-5');
        expect(deckModelId(null, 'gpt-5')).toBe('gpt-5');
    });
});

describe('deckCredits', () => {
    it('is signed out without an account', () => {
        expect(deckCredits({ signedIn: false, balance: null, turnStartBalance: null })).toEqual({
            kind: 'signed-out',
        });
    });

    it('is out at or below zero', () => {
        expect(deckCredits({ signedIn: true, balance: 0, turnStartBalance: null })).toEqual({
            kind: 'out',
        });
    });

    it('reports what this turn spent', () => {
        expect(deckCredits({ signedIn: true, balance: 12.5, turnStartBalance: 12.81 })).toEqual({
            kind: 'balance',
            balance: 12.5,
            spend: 0.31,
        });
        expect(deckCredits({ signedIn: true, balance: 12.5, turnStartBalance: 12.5 })).toEqual({
            kind: 'balance',
            balance: 12.5,
            spend: null,
        });
    });
});

describe('permissionLabel', () => {
    const none = {
        isShellMode: false,
        planModeActive: false,
        autoApproveEdits: false,
        bypassPermissions: false,
        configuredMode: 'asks-you',
    };

    it('is null when Dexto asks you', () => {
        expect(permissionLabel(none)).toBeNull();
    });

    it('shows an agent configured for Full access, with no session override', () => {
        expect(permissionLabel({ ...none, configuredMode: 'full-access' })).toBe('full access');
    });

    it('names the session mode first and keeps configured auto-approval beside it', () => {
        const configured = { ...none, configuredMode: 'full-access' };
        expect(permissionLabel({ ...configured, planModeActive: true })).toBe(
            'plan mode · full access'
        );
        expect(permissionLabel({ ...configured, autoApproveEdits: true })).toBe(
            'accept edits · full access'
        );
        expect(permissionLabel({ ...none, autoApproveEdits: true })).toBe('accept edits');
        expect(permissionLabel({ ...none, bypassPermissions: true })).toBe('full access');
        expect(permissionLabel({ ...configured, isShellMode: true })).toBe(
            'shell mode · full access'
        );
    });
});

describe('keepsTurnSpend', () => {
    it('keeps the spend when the first turn creates its session', () => {
        expect(keepsTurnSpend(null, 's1')).toBe(true);
    });

    it('clears the spend on a switch to another session', () => {
        expect(keepsTurnSpend('s1', 's2')).toBe(false);
        expect(keepsTurnSpend('s1', null)).toBe(false);
    });
});

describe('nextTurnBaseline', () => {
    const before = { sessionId: 's1', account: 'ada', isProcessing: false, balance: 12.84 };
    const now = { sessionId: 's1', account: 'ada', isProcessing: false, balance: 12.5 };

    it('takes the balance when a turn starts and holds it through the turn', () => {
        const started = nextTurnBaseline(before, { ...now, isProcessing: true });
        expect(started.balance).toBe(12.5);
        const later = nextTurnBaseline(started, { ...now, isProcessing: true, balance: 12.1 });
        expect(later.balance).toBe(12.5);
    });

    it('keeps the baseline while the first turn creates its session', () => {
        const prev = { sessionId: null, account: 'ada', isProcessing: true, balance: 12.84 };
        const next = nextTurnBaseline(prev, { ...now, isProcessing: true });
        expect(next).toEqual({
            sessionId: 's1',
            account: 'ada',
            isProcessing: true,
            balance: 12.84,
        });
    });

    it('clears the baseline on a session switch', () => {
        expect(nextTurnBaseline(before, { ...now, sessionId: 's2' }).balance).toBeNull();
    });

    it('clears the baseline on sign-out, so it never carries to another account', () => {
        expect(nextTurnBaseline(before, { ...now, account: null }).balance).toBeNull();
    });

    it('clears the baseline when another account signs in without a sign-out', () => {
        expect(nextTurnBaseline(before, { ...now, account: 'grace' }).balance).toBeNull();
    });
});

describe('deckCollapsed', () => {
    it('collapses under focused overlays, which budget for the whole screen', () => {
        expect(deckCollapsed('model-selector')).toBe(true);
    });

    it('stays up with no overlay and under inline ones', () => {
        expect(deckCollapsed('none')).toBe(false);
        expect(deckCollapsed('slash-autocomplete')).toBe(false);
    });
});
