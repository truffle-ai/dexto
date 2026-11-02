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
import { toolOutput, toolStep } from '../../utils/tool-step.js';
import { MarkdownInsetContext, MarkdownText } from '../shared/MarkdownText.js';
import { DiffInsetContext } from '../renderers/diff-shared.js';
import { DiffRenderer } from '../renderers/index.js';

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
                <DiffInsetContext.Provider value={margin}>
                    <DiffRenderer data={display} />
                </DiffInsetContext.Provider>
            )}
        </Box>
    );
}
