/**
 * Signal kit parts. The prop types here are the contract the deck, transcript and view owners
 * build against; the bodies are first cuts that later work replaces in place.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, measureElement, useStdout, type DOMElement } from 'ink';
import { useAnimationTick } from '../hooks/useAnimationTick.js';
import { useCaps } from './caps.js';
import { glyphText } from './glyphs.js';
import { cutLines } from './cut.js';
import { useTone, type Role } from './tone.js';
import { deckLayout } from './deck-layout.js';
import { StatusBlock, StatusRow, TraceView } from './deck-parts.js';
import { traceKind } from './trace.js';
import { useTrace } from './use-trace.js';
import { pickWordmark, pulseInk, wordmarkTier } from './wordmark.js';

// ---------------------------------------------------------------- wordmark

export interface WordmarkProps {
    /** Height in rows. The wordmark picks the largest drawing that fits. */
    rows: number;
    /** Light the mark in travelling rings (the agent is thinking). */
    pulse?: boolean;
}

const WORDMARK_INK: Readonly<Record<string, Role>> = { m: 'teal', f: 'tealDim', w: 'hi' };
/** Ticks of the shared 80 ms animation clock per pulse cycle (1.2 s). */
const PULSE_CYCLE_TICKS = 15;

/** Cells of one row grouped into runs of the same ink, so each run is one <Text>. */
function inkRuns(text: string, ink: string): { ink: string; text: string }[] {
    const glyphs = Array.from(text);
    const runs: { ink: string; text: string }[] = [];
    glyphs.forEach((glyph, c) => {
        const letter = ink[c] ?? ' ';
        const last = runs[runs.length - 1];
        if (last !== undefined && last.ink === letter) last.text += glyph;
        else runs.push({ ink: letter, text: glyph });
    });
    return runs;
}

/** The Dexto logo: the mark in teal (thin arcs dimmer), the word in the reading colour. */
export function Wordmark({ rows, pulse = false }: WordmarkProps) {
    const tone = useTone();
    const caps = useCaps();
    const art = pickWordmark(wordmarkTier(caps), Math.max(1, rows));
    const animate = pulse && caps.motion === 'full';
    const tick = useAnimationTick({ enabled: animate, intervalMs: 80 });
    const ink = animate ? pulseInk(art, tick / PULSE_CYCLE_TICKS) : art.ink;
    return (
        <Box flexDirection="column" flexShrink={0}>
            {art.text.map((line, r) => (
                <Text key={r} wrap="truncate-end">
                    {inkRuns(line, ink[r] ?? '').map((run, i) => {
                        const role = WORDMARK_INK[run.ink];
                        return role === undefined ? (
                            run.text
                        ) : (
                            <Text key={i} color={tone(role)}>
                                {run.text}
                            </Text>
                        );
                    })}
                </Text>
            ))}
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
    const tone = useTone();
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
    /** Signed in; balance not known yet (loading, or the request failed). */
    | { kind: 'signed-in' }
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

/**
 * The slim band under the transcript: wordmark, live trace, status; then gate and input.
 * It steps down with width (see `deckLayout`): 4 rows wide, 5 in the middle, 4 when bare.
 */
export function Deck({ state, gate, children }: DeckProps) {
    const tone = useTone();
    const caps = useCaps();
    const { stdout } = useStdout();
    // Re-render on resize ourselves rather than relying on a parent to.
    const [columns, setColumns] = useState(stdout.columns || 80);
    useEffect(() => {
        const onResize = () => setColumns(stdout.columns || 80);
        stdout.on('resize', onResize);
        return () => {
            stdout.off('resize', onResize);
        };
    }, [stdout]);
    const wordmarkColumns = pickWordmark(wordmarkTier(caps), 3).cols + 3;
    const layout = deckLayout(columns, wordmarkColumns);
    const bare = layout.band === 'bare';
    const mode = DECK_MODES[state.mode];
    const kind = traceKind(state.mode);

    // The trace takes what the wordmark and status block leave. Measured after layout, since
    // the wordmark's width depends on the drawing it picks; the first frame uses an estimate.
    const traceRef = useRef<DOMElement>(null);
    const [measured, setMeasured] = useState<number | null>(null);
    useEffect(() => {
        if (traceRef.current === null) return;
        const { width } = measureElement(traceRef.current);
        if (width !== measured) setMeasured(width);
    });
    const estimate =
        columns -
        (bare ? 0 : wordmarkColumns) -
        (layout.blockWidth > 0 ? layout.blockWidth + 4 : 0);
    const traceWidth = measured ?? Math.max(4, estimate);
    const history = useTrace(kind, traceWidth);

    return (
        <Box flexDirection="column" flexShrink={0}>
            <Box height={layout.bandRows} flexShrink={0}>
                {!bare && (
                    <Box marginLeft={1} marginRight={2} flexShrink={0}>
                        <Wordmark rows={3} pulse={state.mode === 'think'} />
                    </Box>
                )}
                <Box
                    ref={traceRef}
                    flexDirection="column"
                    flexGrow={1}
                    flexShrink={1}
                    overflow="hidden"
                >
                    {layout.band === 'mid' && (
                        <Box justifyContent="flex-end" height={1}>
                            <Text wrap="truncate-end">
                                <Text bold color={tone(mode.role)}>
                                    {mode.label}
                                </Text>
                                {state.readout !== null && (
                                    <Text color={tone('dim')}>
                                        {glyphText(` · ${state.readout}`, caps.glyphs)}
                                    </Text>
                                )}
                            </Text>
                        </Box>
                    )}
                    {layout.band === 'wide' && <Box height={1} />}
                    <TraceView history={history} width={traceWidth} height={2} />
                </Box>
                {layout.band === 'wide' && (
                    <Box marginLeft={3} marginRight={1} flexShrink={0}>
                        <StatusBlock
                            label={mode.label}
                            labelColor={tone(mode.role)}
                            readout={state.readout}
                            status={state.status}
                            width={layout.blockWidth}
                        />
                    </Box>
                )}
            </Box>
            {gate}
            {children}
            {layout.statusRow && (
                <StatusRow
                    status={state.status}
                    width={columns}
                    notice={
                        bare && state.readout !== null
                            ? { text: state.readout, color: tone(mode.role) }
                            : null
                    }
                />
            )}
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
    const tone = useTone();
    const { glyphs } = useCaps();
    const { stdout } = useStdout();
    const margin = actorMarginWidth(stdout.columns || 80);
    const role = ACTOR_ROLE[actor];
    const head = margin >= 8 ? (label ?? ACTOR_LABEL[actor]) : actor === 'you' ? '›' : '▪';
    return (
        <Box>
            <Box width={margin} flexShrink={0}>
                <Text bold color={tone(role)} wrap="truncate-end">
                    {glyphText(margin >= 8 ? ` ${head}` : head, glyphs)}
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
    const tone = useTone();
    const { glyphs } = useCaps();
    return (
        <>
            {detail.split(/(\+\d+|−\d+)/).map((part, i) => {
                const role: Role = /^\+\d/.test(part) ? 'add' : /^−\d/.test(part) ? 'del' : 'dim';
                return (
                    <Text key={i} color={tone(role)}>
                        {glyphText(part, glyphs)}
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
    const tone = useTone();
    const role = stepRole(step);
    const quiet = step.state === 'queue' || step.state === 'skip';
    const word = STEP_WORD[step.state];
    const { glyphs } = useCaps();
    return (
        <Box>
            <Box width={2} flexShrink={0}>
                <Text color={tone(role)}>{glyphText(stepGlyph(step), glyphs)}</Text>
            </Box>
            <Box width={8} flexShrink={0}>
                <Text bold color={tone(quiet ? 'dim' : step.cloud ? 'cloud' : 'hi')}>
                    {step.verb}
                </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
                <Text color={tone(quiet ? 'dim' : 'fg')} wrap="truncate-end">
                    {glyphText(step.target, glyphs)}
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
                    <Text color={tone('faint')}>{glyphText(step.time, glyphs)}</Text>
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
    const tone = useTone();
    const { glyphs } = useCaps();
    return (
        <Box
            flexDirection="column"
            borderStyle={glyphs === 'ascii' ? 'classic' : 'round'}
            borderColor={tone(role)}
            paddingX={1}
        >
            <Text bold color={tone(role)}>
                {glyphText(title, glyphs)}
            </Text>
            {children}
            {hint !== undefined && <Text color={tone('dim')}>{glyphText(hint, glyphs)}</Text>}
        </Box>
    );
}
