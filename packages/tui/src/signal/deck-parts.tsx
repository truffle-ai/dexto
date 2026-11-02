/**
 * Parts of the deck: the trace as Ink rows, and the status (model, context, where the agent
 * runs, branch, credits) as a block beside the trace or a compact row under the input.
 */
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useCaps } from './caps.js';
import { glyphText } from './glyphs.js';
import { useTone } from './tone.js';
import { TRACE_ROLE, fadeColor, traceRows, type TraceCell, type TraceSample } from './trace.js';
import { formatTokens } from './deck-layout.js';
import type { DeckCredits, DeckStatus, DeckWhere } from './components.js';

// ---------------------------------------------------------------- trace

interface TraceViewProps {
    history: readonly TraceSample[];
    width: number;
    height: number;
}

interface Run {
    text: string;
    color: string;
    inverse: boolean;
}

/** Consecutive cells with one colour become one Text, so a row is a handful of nodes. */
function runs(cells: readonly TraceCell[], color: (cell: TraceCell) => string): Run[] {
    const out: Run[] = [];
    for (const cell of cells) {
        const c = color(cell);
        const prev = out[out.length - 1];
        if (prev && prev.color === c && prev.inverse === cell.inverse) prev.text += cell.ch;
        else out.push({ text: cell.ch, color: c, inverse: cell.inverse });
    }
    return out;
}

export function TraceView({ history, width, height }: TraceViewProps) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const background = tone('bg');
    const rows = traceRows(history, Math.max(0, width), height);
    // Fades step in tenths: enough for the eye, and it keeps runs long.
    const color = (cell: TraceCell) =>
        fadeColor(tone(TRACE_ROLE[cell.kind]), background, Math.round(cell.fade * 10) / 10);
    return (
        <Box flexDirection="column" flexShrink={0} width={Math.max(0, width)}>
            {rows.map((row, r) => (
                <Text key={r} wrap="truncate-end">
                    {runs(row, color).map((run, i) =>
                        glyphs === 'ascii' ? (
                            <Text key={i} color={run.color}>
                                {glyphText(run.inverse ? asciiLower(run.text) : run.text, glyphs)}
                            </Text>
                        ) : (
                            <Text key={i} color={run.color} inverse={run.inverse}>
                                {run.text}
                            </Text>
                        )
                    )}
                </Text>
            ))}
        </Box>
    );
}

/** In reverse video ▇ reads as a thin bar at the top; ASCII has no reverse trick, so mark it. */
function asciiLower(text: string): string {
    return text.replace(/[▁▂▃▄]/g, '=').replace(/[▅▆▇]/g, '-');
}

// ---------------------------------------------------------------- status

/** "dexto/" in the cloud colour, the model in the reading colour; own-key providers stay neutral. */
function ModelName({ model }: { model: string }) {
    const tone = useTone();
    const slash = model.indexOf('/');
    if (slash < 0) return <Text color={tone('fg')}>{model}</Text>;
    const provider = model.slice(0, slash);
    return (
        <Text>
            <Text color={tone(provider === 'dexto' ? 'cloud' : 'dim')}>{provider}/</Text>
            <Text color={tone('fg')}>{model.slice(slash + 1)}</Text>
        </Text>
    );
}

function Where({ where }: { where: DeckWhere }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    if (where.kind === 'computer') {
        return <Text color={tone('cloud')}>{glyphText(`◆ ${where.name}`, glyphs)}</Text>;
    }
    return <Text color={tone('teal')}>{glyphText('◇ local', glyphs)}</Text>;
}

function formatUsd(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Credits({ credits, showSpend }: { credits: DeckCredits; showSpend: boolean }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const dot = <Text color={tone('faint')}>{glyphText(' · ', glyphs)}</Text>;
    switch (credits.kind) {
        case 'signed-out':
            return (
                <>
                    {dot}
                    <Text color={tone('dim')}>cloud off</Text>
                </>
            );
        case 'signed-in':
            return (
                <>
                    {dot}
                    <Text color={tone('cloud')}>{glyphText('◆', glyphs)}</Text>
                </>
            );
        case 'out':
            return (
                <>
                    {dot}
                    <Text color={tone('cloud')}>{glyphText('◆ ', glyphs)}</Text>
                    <Text color={tone('red')}>out of credits</Text>
                </>
            );
        case 'balance':
            return (
                <>
                    {dot}
                    <Text color={tone('cloud')}>{glyphText('◆ ', glyphs)}</Text>
                    <Text color={tone('fg')}>{formatUsd(credits.balance)}</Text>
                    {showSpend && credits.spend !== null && credits.spend > 0 && (
                        <Text color={tone('cloud')}>
                            {glyphText(` −${formatUsd(credits.spend)}`, glyphs)}
                        </Text>
                    )}
                </>
            );
    }
}

/** Terminal cells a string takes (CJK is two per character). */
function cells(text: string): number {
    return stringWidth(text);
}

function whereText(where: DeckWhere): string {
    return where.kind === 'computer' ? `◆ ${where.name}` : '◇ local';
}

function spendText(credits: DeckCredits): string {
    return credits.kind === 'balance' && credits.spend !== null && credits.spend > 0
        ? ` −${formatUsd(credits.spend)}`
        : '';
}

/** Credits without this turn's spend. */
function creditsText(credits: DeckCredits): string {
    switch (credits.kind) {
        case 'signed-out':
            return ' · cloud off';
        case 'signed-in':
            return ' · ◆';
        case 'out':
            return ' · ◆ out of credits';
        case 'balance':
            return ` · ◆ ${formatUsd(credits.balance)}`;
    }
}

export interface LaneParts {
    branch: boolean;
    dirty: boolean;
    spend: boolean;
}

/**
 * What fits beside where and credits in `width` columns. Dropped in order: the dirty count,
 * the branch, then this turn's spend. Where the agent runs and the balance always stay.
 */
export function laneParts(status: DeckStatus, width: number): LaneParts {
    const base = cells(whereText(status.where)) + cells(creditsText(status.credits));
    const spend = cells(spendText(status.credits));
    const branch = status.branch === null ? 0 : cells(` ⎇ ${status.branch}`);
    const dirty = status.dirtyFiles > 0 ? cells(` ±${status.dirtyFiles}`) : 0;
    if (base + spend + branch + dirty <= width) {
        return { branch: branch > 0, dirty: dirty > 0, spend: spend > 0 };
    }
    if (base + spend + branch <= width)
        return { branch: branch > 0, dirty: false, spend: spend > 0 };
    if (base + spend <= width) return { branch: false, dirty: false, spend: spend > 0 };
    return { branch: false, dirty: false, spend: false };
}

/** ◇ local ⎇ main ±3 · ◆ $12.84 −$0.31, stepping down per `laneParts`. */
function Lane({ status, width }: { status: DeckStatus; width: number }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const show = laneParts(status, width);
    return (
        <Text wrap="truncate-end">
            <Where where={status.where} />
            {show.branch && status.branch !== null && (
                <Text color={tone('dim')}>{glyphText(` ⎇ ${status.branch}`, glyphs)}</Text>
            )}
            {show.dirty && (
                <Text color={tone('amberDim')}>{glyphText(` ±${status.dirtyFiles}`, glyphs)}</Text>
            )}
            <Credits credits={status.credits} showSpend={show.spend} />
        </Text>
    );
}

/**
 * The model, then context use. Context keeps its room and the model name truncates; when
 * fewer than four columns are left for the model, context shows alone.
 */
function ModelAndContext({
    model,
    context,
    width,
}: {
    model: string;
    context: string | null;
    width: number;
}) {
    const tone = useTone();
    const contextCells = context === null ? 0 : cells(context) + 2;
    const modelWidth = Math.min(cells(model), width - contextCells);
    return (
        <Box width={width} flexShrink={0}>
            {modelWidth >= 4 && (
                <Box width={modelWidth} flexShrink={0}>
                    <Text wrap="truncate-end">
                        <ModelName model={model} />
                    </Text>
                </Box>
            )}
            {context !== null && (
                <Text color={tone('dim')}>{modelWidth >= 4 ? `  ${context}` : context}</Text>
            )}
        </Box>
    );
}

function contextText(status: DeckStatus, withMax: boolean): string | null {
    if (status.contextUsedTokens === null) return null;
    const used = formatTokens(status.contextUsedTokens);
    if (!withMax || status.contextMaxTokens === null) return used;
    return `${used}/${formatTokens(status.contextMaxTokens)}`;
}

/** Mode · readout, model and context, lane: three rows beside the trace. */
export function StatusBlock({
    label,
    labelColor,
    readout,
    status,
    width,
}: {
    label: string;
    labelColor: string;
    readout: string | null;
    status: DeckStatus;
    width: number;
}) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const context = contextText(status, true);
    return (
        <Box flexDirection="column" width={width} flexShrink={0}>
            <Text wrap="truncate-end">
                <Text bold color={labelColor}>
                    {label}
                </Text>
                {readout !== null && (
                    <Text color={tone('dim')}>{glyphText(` · ${readout}`, glyphs)}</Text>
                )}
            </Text>
            <ModelAndContext model={status.model} context={context} width={width} />
            <Lane status={status} width={width} />
        </Box>
    );
}

/** How the compact status row shares its width. */
export interface StatusRowFit {
    /** Columns for model and context; 0 hides them. */
    model: number;
    /** Columns for the lane. */
    lane: number;
}

/**
 * Where the agent runs and the balance always fit, then the notice; model and context take
 * what is left and truncate first, and disappear below four columns.
 */
export function statusRowFit(status: DeckStatus, width: number, noticeWidth: number): StatusRowFit {
    const context = contextText(status, false);
    const natural = cells(status.model) + (context === null ? 0 : cells(context) + 2);
    const laneMin = cells(whereText(status.where)) + cells(creditsText(status.credits));
    const room = width - noticeWidth - laneMin - 2;
    const model = room >= 4 ? Math.min(natural, room) : 0;
    return { model, lane: Math.max(0, width - noticeWidth - (model > 0 ? model + 2 : 0)) };
}

/**
 * Model, context and lane in one row under the input. `notice` leads the row when the band
 * has no room for the readout, so the permission mode stays on screen.
 */
export function StatusRow({
    status,
    width,
    notice,
}: {
    status: DeckStatus;
    width: number;
    notice: { text: string; color: string } | null;
}) {
    const { glyphs } = useCaps();
    const context = contextText(status, false);
    const noticeText = notice === null ? '' : `${glyphText(notice.text, glyphs)}  `;
    const fit = statusRowFit(status, width, cells(noticeText));
    return (
        <Box width={width}>
            {notice !== null && (
                <Box flexShrink={0}>
                    <Text color={notice.color}>{noticeText}</Text>
                </Box>
            )}
            {fit.model > 0 && (
                <Box marginRight={2} flexShrink={0}>
                    <ModelAndContext model={status.model} context={context} width={fit.model} />
                </Box>
            )}
            <Box width={fit.lane} flexShrink={0}>
                <Lane status={status} width={fit.lane} />
            </Box>
        </Box>
    );
}
