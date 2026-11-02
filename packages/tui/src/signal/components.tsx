/**
 * Signal kit parts. The prop types here are the contract the deck, transcript and view owners
 * build against; the bodies are first cuts that later work replaces in place.
 */
import type { ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useCaps } from './caps.js';
import { cutLines } from './cut.js';
import { tone, type Role } from './tone.js';

// ---------------------------------------------------------------- wordmark

export interface WordmarkProps {
    /** Height in rows. The wordmark picks the largest drawing that fits. */
    rows: number;
    /** Light the mark in travelling rings (the agent is thinking). */
    pulse?: boolean;
}

/** The Dexto wordmark: the mark in teal, the word in the reading colour. */
export function Wordmark({ rows }: WordmarkProps) {
    return (
        <Box flexDirection="column" height={Math.max(1, rows)} flexShrink={0}>
            <Text bold>
                <Text color={tone('teal')}>◢ </Text>
                <Text color={tone('hi')}>dexto</Text>
            </Text>
        </Box>
    );
}

// ---------------------------------------------------------------- cut type

export interface CutTextProps {
    text: string;
    role?: Role;
}

/** A title in cut type, 3 rows tall. ASCII terminals get the plain word. */
export function CutText({ text, role = 'hi' }: CutTextProps) {
    const caps = useCaps();
    if (caps.glyphs === 'ascii') {
        return (
            <Box height={3} flexShrink={0}>
                <Text bold color={tone(role)}>
                    {text.toUpperCase()}
                </Text>
            </Box>
        );
    }
    return (
        <Box flexDirection="column" flexShrink={0}>
            {cutLines(text).map((line, i) => (
                <Text key={i} color={tone(role)}>
                    {line}
                </Text>
            ))}
        </Box>
    );
}

// ---------------------------------------------------------------- deck

export type DeckMode =
    | 'idle'
    | 'think'
    | 'stream'
    | 'tool'
    | 'cloud'
    | 'wait'
    | 'fault'
    | 'stop'
    | 'steer'
    | 'offline'
    | 'handoff'
    | 'attached'
    | 'done';

/** The word the deck shows for each mode, and its role. */
export const DECK_MODES: Readonly<Record<DeckMode, { label: string; role: Role }>> = {
    idle: { label: 'READY', role: 'tealDim' },
    think: { label: 'THINKING', role: 'teal' },
    stream: { label: 'STREAMING', role: 'teal' },
    tool: { label: 'WORKING', role: 'teal' },
    cloud: { label: 'CLOUD', role: 'cloud' },
    wait: { label: 'NEEDS YOU', role: 'amber' },
    fault: { label: 'FAULT', role: 'red' },
    stop: { label: 'STOPPED', role: 'dim' },
    steer: { label: 'STEERING', role: 'amber' },
    offline: { label: 'LOCAL ONLY', role: 'dim' },
    handoff: { label: 'HANDING OFF', role: 'cloud' },
    attached: { label: 'ATTACHED', role: 'cloud' },
    done: { label: 'DONE', role: 'tealDim' },
};

/** Where the agent runs: this machine, or a named Dexto cloud computer. */
export type DeckWhere = { kind: 'local' } | { kind: 'computer'; name: string };

/** Dexto credits as the status line shows them. */
export type DeckCredits =
    | { kind: 'signed-out' }
    | { kind: 'balance'; balance: number; spend: number | null }
    | { kind: 'out' };

export interface DeckStatus {
    /** Model id as the user picked it, e.g. "dexto/sonnet-5.5" or "anthropic/claude-…". */
    model: string;
    contextUsedTokens: number | null;
    contextMaxTokens: number | null;
    where: DeckWhere;
    branch: string | null;
    dirtyFiles: number;
    credits: DeckCredits;
}

export interface DeckState {
    mode: DeckMode;
    /** Short live readout beside the mode, e.g. "paused 0:14" or "diff · 2 files". */
    readout: string | null;
    status: DeckStatus;
}

export interface DeckProps {
    state: DeckState;
    /** An approval or question, drawn between the band and the input. */
    gate?: ReactNode;
    /** The input row. */
    children: ReactNode;
}

/** The slim band under the transcript: wordmark, live trace, status; then gate and input. */
export function Deck({ state, gate, children }: DeckProps) {
    const mode = DECK_MODES[state.mode];
    return (
        <Box flexDirection="column">
            <Box>
                <Wordmark rows={1} pulse={state.mode === 'think'} />
                <Text> </Text>
                <Text bold color={tone(mode.role)}>
                    {mode.label}
                </Text>
                {state.readout !== null && <Text color={tone('dim')}> · {state.readout}</Text>}
                <Text color={tone('dim')}> · {state.status.model}</Text>
            </Box>
            {gate}
            {children}
        </Box>
    );
}

// ---------------------------------------------------------------- transcript rows

export type ActorKind = 'you' | 'agent' | 'cloud';

const ACTOR_ROLE: Readonly<Record<ActorKind, Role>> = { you: 'hi', agent: 'teal', cloud: 'cloud' };
const ACTOR_LABEL: Readonly<Record<ActorKind, string>> = {
    you: 'YOU',
    agent: 'AGENT',
    cloud: 'CLOUD',
};

/** Margin width: an 8-column ship's-log margin at 64 columns and up, a glyph below that. */
export function actorMarginWidth(columns: number): number {
    return columns >= 64 ? 8 : 2;
}

export interface ActorRowProps {
    actor: ActorKind;
    /** Overrides the actor's default label (a teammate's name, a cloud agent's name). */
    label?: string;
    children: ReactNode;
}

/** A transcript block with the actor in the left margin. */
export function ActorRow({ actor, label, children }: ActorRowProps) {
    const { stdout } = useStdout();
    const margin = actorMarginWidth(stdout.columns || 80);
    const role = ACTOR_ROLE[actor];
    const head = margin >= 8 ? (label ?? ACTOR_LABEL[actor]) : actor === 'you' ? '›' : '▪';
    return (
        <Box>
            <Box width={margin} flexShrink={0}>
                <Text bold color={tone(role)} wrap="truncate-end">
                    {margin >= 8 ? ` ${head}` : head}
                </Text>
            </Box>
            <Box flexDirection="column" flexGrow={1}>
                {children}
            </Box>
        </Box>
    );
}

export type StepState = 'ok' | 'run' | 'fail' | 'deny' | 'skip' | 'queue' | 'stop' | 'wait' | 'ask';

export interface Step {
    state: StepState;
    /** Upper-case verb, up to 7 cells: READ, EDIT, RUN, SEARCH… */
    verb: string;
    target: string;
    /** "+12 −3", "staging database"; +N and −N are coloured. */
    detail: string | null;
    /** Elapsed time, already formatted ("0.4s"). */
    time: string | null;
    /** Ran on Dexto cloud. */
    cloud: boolean;
}

const STEP_WORD: Readonly<Partial<Record<StepState, string>>> = {
    fail: 'FAIL',
    deny: 'DENIED',
    wait: 'NEEDS YOU',
    ask: 'ASKING',
    skip: 'SKIPPED',
    queue: 'QUEUED',
    stop: 'STOPPED',
};

function stepRole(step: Step): Role {
    if (step.state === 'fail') return 'red';
    if (step.state === 'deny' || step.state === 'wait' || step.state === 'ask') return 'amber';
    if (step.cloud) return 'cloud';
    if (step.state === 'queue' || step.state === 'skip') return 'faint';
    return 'teal';
}

function stepGlyph(step: Step): string {
    if (step.cloud) return '◆';
    if (step.state === 'run' || step.state === 'wait' || step.state === 'ask') return '▸';
    if (step.state === 'skip' || step.state === 'queue') return '▫';
    return '▪';
}

function DetailText({ detail }: { detail: string }) {
    return (
        <>
            {detail.split(/(\+\d+|−\d+)/).map((part, i) => {
                const role: Role = /^\+\d/.test(part) ? 'add' : /^−\d/.test(part) ? 'del' : 'dim';
                return (
                    <Text key={i} color={tone(role)}>
                        {part}
                    </Text>
                );
            })}
        </>
    );
}

export interface StepRowProps {
    step: Step;
}

/** One tool call as one fixed-column row: glyph · VERB · target · detail · time · state word. */
export function StepRow({ step }: StepRowProps) {
    const role = stepRole(step);
    const quiet = step.state === 'queue' || step.state === 'skip';
    const word = STEP_WORD[step.state];
    return (
        <Box>
            <Box width={2} flexShrink={0}>
                <Text color={tone(role)}>{stepGlyph(step)}</Text>
            </Box>
            <Box width={8} flexShrink={0}>
                <Text bold color={tone(quiet ? 'dim' : step.cloud ? 'cloud' : 'hi')}>
                    {step.verb}
                </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
                <Text color={tone(quiet ? 'dim' : 'fg')} wrap="truncate-end">
                    {step.target}
                </Text>
            </Box>
            {step.detail !== null && (
                <Box flexShrink={2} marginLeft={1}>
                    <Text wrap="truncate-end">
                        <DetailText detail={step.detail} />
                    </Text>
                </Box>
            )}
            {step.time !== null && (
                <Box flexShrink={0} marginLeft={1}>
                    <Text color={tone('faint')}>{step.time}</Text>
                </Box>
            )}
            {word !== undefined && (
                <Box flexShrink={0} marginLeft={2}>
                    <Text bold color={tone(role)}>
                        {word}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

// ---------------------------------------------------------------- gates

export interface GateFrameProps {
    /** e.g. "NEEDS YOU · RUN A COMMAND" or "QUESTION · How long…". */
    title: string;
    /** amber: waiting on you. red: a fault you must act on. */
    role?: 'amber' | 'red';
    /** Key hints for the bottom edge, "⏎ answer · esc let it decide". */
    hint?: string;
    children: ReactNode;
}

/** The frame around anything that waits on the user: approvals, questions, steer. */
export function GateFrame({ title, role = 'amber', hint, children }: GateFrameProps) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={tone(role)} paddingX={1}>
            <Text bold color={tone(role)}>
                {title}
            </Text>
            {children}
            {hint !== undefined && <Text color={tone('dim')}>{hint}</Text>}
        </Box>
    );
}
