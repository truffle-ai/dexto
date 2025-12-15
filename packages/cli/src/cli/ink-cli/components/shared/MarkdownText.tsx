/**
 * MarkdownText Component
 *
 * Renders markdown text with terminal-appropriate styling.
 * Handles both inline markdown (bold, code, italic) and block elements (headers, code blocks, lists).
 *
 * Streaming-safe: incomplete markdown tokens won't match regex patterns,
 * so they render as plain text until complete.
 */

import React, { memo } from 'react';
import { Text, Box } from 'ink';

// ============================================================================
// Inline Markdown Rendering
// ============================================================================

interface InlineSegment {
    type: 'text' | 'bold' | 'code' | 'italic' | 'strikethrough' | 'link' | 'url';
    content: string;
    url?: string; // For links
}

/**
 * Parse inline markdown and return segments.
 * Uses a single regex to find all inline patterns, processes in order.
 */
function parseInlineMarkdown(text: string): InlineSegment[] {
    // Early return for plain text without markdown indicators
    if (!/[*_~`\[<]|https?:\/\//.test(text)) {
        return [{ type: 'text', content: text }];
    }

    const segments: InlineSegment[] = [];
    let lastIndex = 0;

    // Combined regex for all inline patterns
    // Order matters: longer/more specific patterns first
    const inlineRegex =
        /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<]+)/g;

    let match;
    while ((match = inlineRegex.exec(text)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }

        const fullMatch = match[0];

        // Determine the type and extract content
        if (fullMatch.startsWith('**') && fullMatch.endsWith('**') && fullMatch.length > 4) {
            // Bold: **text**
            segments.push({ type: 'bold', content: fullMatch.slice(2, -2) });
        } else if (fullMatch.startsWith('__') && fullMatch.endsWith('__') && fullMatch.length > 4) {
            // Bold: __text__
            segments.push({ type: 'bold', content: fullMatch.slice(2, -2) });
        } else if (fullMatch.startsWith('`') && fullMatch.endsWith('`') && fullMatch.length > 2) {
            // Inline code: `code`
            segments.push({ type: 'code', content: fullMatch.slice(1, -1) });
        } else if (fullMatch.startsWith('~~') && fullMatch.endsWith('~~') && fullMatch.length > 4) {
            // Strikethrough: ~~text~~
            segments.push({ type: 'strikethrough', content: fullMatch.slice(2, -2) });
        } else if (fullMatch.startsWith('*') && fullMatch.endsWith('*') && fullMatch.length > 2) {
            // Italic: *text*
            segments.push({ type: 'italic', content: fullMatch.slice(1, -1) });
        } else if (fullMatch.startsWith('_') && fullMatch.endsWith('_') && fullMatch.length > 2) {
            // Italic: _text_
            segments.push({ type: 'italic', content: fullMatch.slice(1, -1) });
        } else if (
            fullMatch.startsWith('[') &&
            fullMatch.includes('](') &&
            fullMatch.endsWith(')')
        ) {
            // Link: [text](url)
            const linkMatch = fullMatch.match(/\[([^\]]+)\]\(([^)]+)\)/);
            if (linkMatch && linkMatch[1] && linkMatch[2]) {
                segments.push({ type: 'link', content: linkMatch[1], url: linkMatch[2] });
            } else {
                segments.push({ type: 'text', content: fullMatch });
            }
        } else if (/^https?:\/\//.test(fullMatch)) {
            // Raw URL
            segments.push({ type: 'url', content: fullMatch });
        } else {
            // Fallback: render as plain text
            segments.push({ type: 'text', content: fullMatch });
        }

        lastIndex = inlineRegex.lastIndex;
    }

    // Add remaining text after last match
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return segments;
}

interface RenderInlineProps {
    text: string;
    defaultColor?: string;
}

/**
 * Renders inline markdown segments with appropriate styling.
 */
const RenderInlineInternal: React.FC<RenderInlineProps> = ({ text, defaultColor = 'white' }) => {
    const segments = parseInlineMarkdown(text);

    return (
        <>
            {segments.map((segment, i) => {
                switch (segment.type) {
                    case 'bold':
                        return (
                            <Text key={i} bold color={defaultColor}>
                                {segment.content}
                            </Text>
                        );
                    case 'code':
                        return (
                            <Text key={i} color="cyan">
                                {segment.content}
                            </Text>
                        );
                    case 'italic':
                        return (
                            <Text key={i} dimColor color={defaultColor}>
                                {segment.content}
                            </Text>
                        );
                    case 'strikethrough':
                        return (
                            <Text key={i} strikethrough color={defaultColor}>
                                {segment.content}
                            </Text>
                        );
                    case 'link':
                        return (
                            <Text key={i} color={defaultColor}>
                                {segment.content}
                                <Text color="blue"> ({segment.url})</Text>
                            </Text>
                        );
                    case 'url':
                        return (
                            <Text key={i} color="blue">
                                {segment.content}
                            </Text>
                        );
                    default:
                        return (
                            <Text key={i} color={defaultColor}>
                                {segment.content}
                            </Text>
                        );
                }
            })}
        </>
    );
};

const RenderInline = memo(RenderInlineInternal);

// ============================================================================
// Block-level Markdown Rendering
// ============================================================================

interface MarkdownTextProps {
    children: string;
    /** Default text color */
    color?: string;
}

/**
 * Main MarkdownText component.
 * Handles block-level elements (headers, code blocks, lists) and delegates
 * inline rendering to RenderInline.
 */
const MarkdownTextInternal: React.FC<MarkdownTextProps> = ({ children, color = 'white' }) => {
    if (!children) return null;

    const defaultColor = color;
    const lines = children.split('\n');

    // Regex patterns for block elements
    const headerRegex = /^(#{1,6})\s+(.*)$/;
    const codeFenceRegex = /^(`{3,}|~{3,})(\w*)$/;
    const ulItemRegex = /^(\s*)([-*+])\s+(.*)$/;
    const olItemRegex = /^(\s*)(\d+)\.\s+(.*)$/;
    const hrRegex = /^[-*_]{3,}$/;

    const blocks: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];
    let codeBlockLang = '';
    let codeBlockFence = '';

    lines.forEach((line, index) => {
        const key = `line-${index}`;
        const trimmedLine = line.trim();

        // Handle code block state
        if (inCodeBlock) {
            const fenceMatch = trimmedLine.match(codeFenceRegex);
            if (
                fenceMatch &&
                fenceMatch[1] &&
                codeBlockFence[0] &&
                fenceMatch[1].startsWith(codeBlockFence[0])
            ) {
                // End of code block
                blocks.push(
                    <RenderCodeBlock key={key} lines={codeBlockLines} language={codeBlockLang} />
                );
                inCodeBlock = false;
                codeBlockLines = [];
                codeBlockLang = '';
                codeBlockFence = '';
            } else {
                codeBlockLines.push(line);
            }
            return;
        }

        // Check for code fence start
        const codeFenceMatch = trimmedLine.match(codeFenceRegex);
        if (codeFenceMatch && codeFenceMatch[1]) {
            inCodeBlock = true;
            codeBlockFence = codeFenceMatch[1];
            codeBlockLang = codeFenceMatch[2] || '';
            return;
        }

        // Headers
        const headerMatch = line.match(headerRegex);
        if (headerMatch && headerMatch[1] && headerMatch[2] !== undefined) {
            const level = headerMatch[1].length;
            const headerText = headerMatch[2];
            blocks.push(<RenderHeader key={key} level={level} text={headerText} />);
            return;
        }

        // Horizontal rule
        if (hrRegex.test(trimmedLine)) {
            blocks.push(
                <Box key={key}>
                    <Text dimColor>{'─'.repeat(40)}</Text>
                </Box>
            );
            return;
        }

        // Unordered list
        const ulMatch = line.match(ulItemRegex);
        if (ulMatch && ulMatch[1] !== undefined && ulMatch[3] !== undefined) {
            const indent = ulMatch[1].length;
            const itemText = ulMatch[3];
            blocks.push(
                <RenderListItem
                    key={key}
                    indent={indent}
                    marker="•"
                    text={itemText}
                    defaultColor={defaultColor}
                />
            );
            return;
        }

        // Ordered list
        const olMatch = line.match(olItemRegex);
        if (olMatch && olMatch[1] !== undefined && olMatch[2] && olMatch[3] !== undefined) {
            const indent = olMatch[1].length;
            const number = olMatch[2];
            const itemText = olMatch[3];
            blocks.push(
                <RenderListItem
                    key={key}
                    indent={indent}
                    marker={`${number}.`}
                    text={itemText}
                    defaultColor={defaultColor}
                />
            );
            return;
        }

        // Empty line - add spacing
        if (trimmedLine.length === 0) {
            blocks.push(<Box key={key} height={1} />);
            return;
        }

        // Regular paragraph line with inline markdown
        blocks.push(
            <Box key={key}>
                <Text wrap="wrap" color={defaultColor}>
                    <RenderInline text={line} defaultColor={defaultColor} />
                </Text>
            </Box>
        );
    });

    // Handle unclosed code block (streaming case)
    if (inCodeBlock && codeBlockLines.length > 0) {
        blocks.push(
            <RenderCodeBlock
                key="code-pending"
                lines={codeBlockLines}
                language={codeBlockLang}
                isPending
            />
        );
    }

    return <>{blocks}</>;
};

// ============================================================================
// Helper Components
// ============================================================================

interface RenderHeaderProps {
    level: number;
    text: string;
}

const RenderHeaderInternal: React.FC<RenderHeaderProps> = ({ level, text }) => {
    // Color based on header level
    const headerColors: Record<number, string> = {
        1: 'blue',
        2: 'cyan',
        3: 'white',
        4: 'gray',
        5: 'gray',
        6: 'gray',
    };
    const headerColor = headerColors[level] || 'white';

    return (
        <Box marginTop={level <= 2 ? 1 : 0}>
            <Text bold color={headerColor}>
                <RenderInline text={text} defaultColor={headerColor} />
            </Text>
        </Box>
    );
};

const RenderHeader = memo(RenderHeaderInternal);

interface RenderListItemProps {
    indent: number;
    marker: string;
    text: string;
    defaultColor: string;
}

const RenderListItemInternal: React.FC<RenderListItemProps> = ({
    indent,
    marker,
    text,
    defaultColor,
}) => {
    const paddingLeft = Math.floor(indent / 2);

    return (
        <Box paddingLeft={paddingLeft} flexDirection="row">
            <Text color={defaultColor}>{marker} </Text>
            <Box flexGrow={1}>
                <Text wrap="wrap" color={defaultColor}>
                    <RenderInline text={text} defaultColor={defaultColor} />
                </Text>
            </Box>
        </Box>
    );
};

const RenderListItem = memo(RenderListItemInternal);

interface RenderCodeBlockProps {
    lines: string[];
    language: string;
    isPending?: boolean;
}

const RenderCodeBlockInternal: React.FC<RenderCodeBlockProps> = ({
    lines,
    language,
    isPending,
}) => {
    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            {language && (
                <Text dimColor color="gray">
                    {language}
                </Text>
            )}
            <Box flexDirection="column" paddingLeft={1}>
                {lines.map((line, i) => (
                    <Text key={i} color="yellow">
                        {line}
                    </Text>
                ))}
                {isPending && (
                    <Text dimColor color="gray">
                        ...
                    </Text>
                )}
            </Box>
        </Box>
    );
};

const RenderCodeBlock = memo(RenderCodeBlockInternal);

// ============================================================================
// Exports
// ============================================================================

export const MarkdownText = memo(MarkdownTextInternal);

// Also export inline renderer for use in other components
export { RenderInline, parseInlineMarkdown };
