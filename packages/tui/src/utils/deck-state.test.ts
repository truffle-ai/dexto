import { describe, expect, it } from 'vitest';
import {
    deckCredits,
    deckMode,
    deckModelId,
    deckReadout,
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
        expect(deckMode({ ...idle, isProcessing: true, isCancelling: true })).toBe('stop');
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
        configuredMode: 'manual',
    };

    it('is null for manual approvals', () => {
        expect(permissionLabel(none)).toBeNull();
    });

    it('shows an agent configured to auto-approve, with no session override', () => {
        expect(permissionLabel({ ...none, configuredMode: 'auto-approve' })).toBe('auto-approve');
    });

    it('puts session overrides first', () => {
        const configured = { ...none, configuredMode: 'auto-approve' };
        expect(permissionLabel({ ...configured, planModeActive: true })).toBe('plan mode');
        expect(permissionLabel({ ...configured, autoApproveEdits: true })).toBe('accept edits');
        expect(permissionLabel({ ...none, bypassPermissions: true })).toBe('auto-approve');
        expect(permissionLabel({ ...configured, isShellMode: true })).toBe('shell mode');
    });
});
