/**
 * Transcript messages on the Signal look: the actor in a left margin, each tool call one
 * fixed-column row. The text stays selectable: no borders or backgrounds around it.
 */
import { Box, Text, useStdout } from 'ink';
import {
    ActorRow,
    StepRow,
    actorMarginWidth,
    glyphText,
    useCaps,
    useTone,
} from '../../signal/index.js';
import type { Message } from '../../state/types.js';
import { faultBlock } from '../../utils/fault-block.js';
import { toolOutput, toolStep } from '../../utils/tool-step.js';
import { MarkdownInsetContext, MarkdownText } from '../shared/MarkdownText.js';
import { SignalDiff } from '../renderers/SignalDiff.js';

function useMargin(): number {
    const { stdout } = useStdout();
    return actorMarginWidth(stdout?.columns ?? 80);
}

export function SignalUserMessage({ content }: { content: string }) {
    const tone = useTone();
    return (
        <Box marginTop={1}>
            <ActorRow actor="you">
                <Text color={tone('hi')}>{content}</Text>
            </ActorRow>
        </Box>
    );
}

interface SignalAgentMessageProps {
    message: Message;
    showReasoning: boolean;
}

export function SignalAgentMessage({ message, showReasoning }: SignalAgentMessageProps) {
    const tone = useTone();
    const margin = useMargin();
    const hasContent = message.content.trim().length > 0;
    const body = (
        <MarkdownInsetContext.Provider value={margin}>
            {showReasoning && message.reasoning ? (
                <Box flexDirection="column" marginBottom={hasContent ? 1 : 0}>
                    <MarkdownText color={tone('dim')}>{message.reasoning}</MarkdownText>
                </Box>
            ) : null}
            {hasContent ? <MarkdownText color={tone('fg')}>{message.content}</MarkdownText> : null}
        </MarkdownInsetContext.Provider>
    );
    // A split message carries on the block above, so only the margin stays.
    if (message.isContinuation) {
        return (
            <Box flexDirection="column" marginLeft={margin}>
                {body}
            </Box>
        );
    }
    return (
        <Box marginTop={1}>
            <ActorRow actor="agent">{body}</ActorRow>
        </Box>
    );
}

export function SignalToolMessage({ message }: { message: Message }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const margin = useMargin();
    const { stdout } = useStdout();
    const step = toolStep(message);
    const display = message.toolDisplayData;
    return (
        <Box flexDirection="column" marginLeft={margin}>
            <StepRow step={step} />
            {toolOutput(message).map((line, i) => (
                <Text key={i} wrap="truncate-end">
                    <Text color={tone('ghost')}>{glyphText('┊ ', glyphs)}</Text>
                    <Text color={tone('red')}>{line}</Text>
                </Text>
            ))}
            {display?.type === 'diff' && (
                <SignalDiff data={display} width={(stdout?.columns ?? 80) - margin} />
            )}
        </Box>
    );
}

/** A system message: a fault, the point where the user stopped the run, or a quiet note. */
export function SignalNote({ message }: { message: Message }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const margin = useMargin();
    if (message.systemKind === 'fault') {
        const fault = faultBlock(message.content);
        return (
            <Box flexDirection="column" marginTop={1} marginLeft={Math.max(0, margin - 2)}>
                <Text>
                    <Text color={tone('red')}>{glyphText('▌ ', glyphs)}</Text>
                    <Text bold color={tone('red')}>
                        FAULT{' '}
                    </Text>
                    <Text bold color={tone('hi')}>
                        {fault.title}
                    </Text>
                </Text>
                {fault.body.map((line, i) => (
                    <Text key={`body-${i}`}>
                        <Text color={tone('redDim')}>{glyphText('▌ ', glyphs)}</Text>
                        <Text color={tone('fg')}>{line}</Text>
                    </Text>
                ))}
                {fault.next.map((line, i) => (
                    <Text key={`next-${i}`}>
                        <Text color={tone('redDim')}>{glyphText('▌ ', glyphs)}</Text>
                        <Text color={tone('dim')}>next </Text>
                        <Text color={tone('amber')}>{line}</Text>
                    </Text>
                ))}
            </Box>
        );
    }
    if (message.systemKind === 'stopped') {
        const at = message.timestamp.toLocaleTimeString([], { hour12: false });
        return (
            <Box marginTop={1} marginLeft={Math.max(0, margin - 2)}>
                <Text>
                    <Text color={tone('hi')}>{glyphText('■ ', glyphs)}</Text>
                    <Text bold color={tone('hi')}>
                        STOPPED{' '}
                    </Text>
                    <Text color={tone('dim')}>
                        {glyphText(`by you at ${at} · type what to do next`, glyphs)}
                    </Text>
                </Text>
            </Box>
        );
    }
    return (
        <Box marginLeft={margin}>
            <Text color={tone('dim')}>{glyphText(`· ${message.content}`, glyphs)}</Text>
        </Box>
    );
}
