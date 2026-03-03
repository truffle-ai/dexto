/**
 * MarkdownText Component
 *
 * Renders markdown text with terminal-appropriate styling.
 * Handles both inline markdown (bold, code, italic) and block elements (headers, code blocks, lists).
 *
 * Uses wrap-ansi for proper word wrapping to avoid mid-word splits.
 * Streaming-safe: incomplete markdown tokens won't match regex patterns,
 * so they render as plain text until complete.
 */

import React, { memo, useMemo } from 'react';
import { Text, Box, useStdout } from 'ink';
import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { highlight, supportsLanguage } from 'cli-highlight';

// ============================================================================
// Inline Markdown Parsing
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

// ============================================================================
// ANSI String Conversion (for wrap-ansi compatibility)
// ============================================================================

/**
 * Convert parsed markdown segments to an ANSI-escaped string.
 * This allows wrap-ansi to properly handle styled text while word-wrapping.
 */
function segmentsToAnsi(segments: InlineSegment[], defaultColor: string): string {
    const colorFn = getChalkColor(defaultColor);

    return segments
        .map((segment) => {
            switch (segment.type) {
                case 'bold':
                    return colorFn.bold(segment.content);
                case 'code':
                    return chalk.cyan(segment.content);
                case 'italic':
                    return chalk.gray(segment.content);
                case 'strikethrough':
                    return colorFn.strikethrough(segment.content);
                case 'link':
                    return colorFn(segment.content) + chalk.blue(` (${segment.url})`);
                case 'url':
                    return chalk.blue(segment.content);
                default:
                    return colorFn(segment.content);
            }
        })
        .join('');
}

/**
 * Get chalk color function from color name
 */
function getChalkColor(color: string): typeof chalk {
    switch (color) {
        case 'white':
            return chalk.white;
        case 'gray':
            return chalk.gray;
        case 'blue':
            return chalk.blue;
        case 'cyan':
            return chalk.cyan;
        case 'green':
            return chalk.green;
        case 'yellow':
            return chalk.rgb(255, 165, 0);
        case 'orange':
            return chalk.rgb(255, 165, 0);
        case 'red':
            return chalk.red;
        case 'magenta':
            return chalk.green;
        default:
            return chalk.white;
    }
}

// ============================================================================
// Wrapped Paragraph Component (uses wrap-ansi for proper word wrapping)
// ============================================================================

interface WrappedParagraphProps {
    text: string;
    defaultColor: string;
    bulletPrefix?: string;
    isFirstParagraph?: boolean;
}

/**
 * Renders a paragraph with proper word wrapping using wrap-ansi.
 * Handles bullet prefix with continuation line indentation.
 */
const WrappedParagraphInternal: React.FC<WrappedParagraphProps> = ({
    text,
    defaultColor,
    bulletPrefix,
    isFirstParagraph = false,
}) => {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;

    const wrappedLines = useMemo(() => {
        // Parse markdown and convert to ANSI string
        const segments = parseInlineMarkdown(text);
        const ansiString = segmentsToAnsi(segments, defaultColor);

        // Calculate available width - always account for bullet indent since all lines get it
        const prefixWidth = bulletPrefix ? stringWidth(bulletPrefix) : 0;
        const availableWidth = Math.max(20, terminalWidth - prefixWidth);

        // Word-wrap the ANSI string
        const wrapped = wrapAnsi(ansiString, availableWidth, {
            hard: false, // Don't break in the middle of words
            wordWrap: true, // Enable word wrapping
            trim: false, // Don't trim whitespace
        });

        return wrapped.split('\n');
    }, [text, defaultColor, bulletPrefix, isFirstParagraph, terminalWidth]);

    // Calculate indent for continuation lines (spaces to align with first line content)
    // All lines get indentation when bulletPrefix is provided, for consistent left margin
    const indentSpaces = bulletPrefix ? ' '.repeat(stringWidth(bulletPrefix)) : '';

    return (
        <>
            {wrappedLines.map((line, i) => {
                const isFirstLine = i === 0;
                // First line of first paragraph gets bullet, all other lines get space indent
                const prefix =
                    isFirstLine && isFirstParagraph && bulletPrefix ? bulletPrefix : indentSpaces;

                return (
                    <Box key={i}>
                        <Text>
                            {prefix}
                            {line}
                        </Text>
                    </Box>
                );
            })}
        </>
    );
};

const WrappedParagraph = memo(WrappedParagraphInternal);

// ============================================================================
// Legacy RenderInline (for headers and other non-wrapped content)
// ============================================================================

interface RenderInlineProps {
    text: string;
    defaultColor?: string;
    /** Apply bold styling to all text segments (used for headers) */
    bold?: boolean;
}

/**
 * Renders inline markdown segments with appropriate styling.
 * Used for headers and other content that doesn't need word wrapping.
 */
const RenderInlineInternal: React.FC<RenderInlineProps> = ({
    text,
    defaultColor = 'white',
    bold: baseBold = false,
}) => {
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
                            <Text key={i} bold={baseBold} color="cyan">
                                {segment.content}
                            </Text>
                        );
                    case 'italic':
                        return (
                            <Text key={i} bold={baseBold} color="gray">
                                {segment.content}
                            </Text>
                        );
                    case 'strikethrough':
                        return (
                            <Text key={i} bold={baseBold} strikethrough color={defaultColor}>
                                {segment.content}
                            </Text>
                        );
                    case 'link':
                        return (
                            <Text key={i} bold={baseBold} color={defaultColor}>
                                {segment.content}
                                <Text color="blue"> ({segment.url})</Text>
                            </Text>
                        );
                    case 'url':
                        return (
                            <Text key={i} bold={baseBold} color="blue">
                                {segment.content}
                            </Text>
                        );
                    default:
                        return (
                            <Text key={i} bold={baseBold} color={defaultColor}>
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
    /** Optional prefix for first line (e.g., "⏺ " for assistant messages) */
    bulletPrefix?: string;
}

/**
 * Main MarkdownText component.
 * Handles block-level elements (headers, code blocks, lists) and delegates
 * paragraph rendering to WrappedParagraph for proper word wrapping.
 */
const MarkdownTextInternal: React.FC<MarkdownTextProps> = ({
    children,
    color = 'white',
    bulletPrefix,
}) => {
    if (!children) return null;

    const defaultColor = color;
    const lines = children.split('\n');
    let isFirstContentLine = true; // Track first actual content for bullet prefix

    // Regex patterns for block elements
    const headerRegex = /^(#{1,6})\s+(.*)$/;
    const codeFenceRegex = /^(`{3,}|~{3,})(\w*)$/;
    const ulItemRegex = /^(\s*)([-*+])\s+(.*)$/;
    const olItemRegex = /^(\s*)(\d+)\.\s+(.*)$/;
    // CommonMark allows spaces between HR characters (e.g., "- - -" or "* * *")
    const hrRegex = /^(\s*[-*_]\s*){3,}$/;

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
            // Per CommonMark spec, closing fence must use same character and be at least as long
            if (
                fenceMatch &&
                fenceMatch[1] &&
                codeBlockFence[0] &&
                fenceMatch[1][0] === codeBlockFence[0] &&
                fenceMatch[1].length >= codeBlockFence.length
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
                    <Text color="gray">{'─'.repeat(40)}</Text>
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
                    marker="-"
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

        // Regular paragraph line - use WrappedParagraph for proper word wrapping
        const usePrefix = isFirstContentLine && bulletPrefix;
        blocks.push(
            <WrappedParagraph
                key={key}
                text={line}
                defaultColor={defaultColor}
                {...(bulletPrefix && { bulletPrefix })}
                isFirstParagraph={usePrefix ? true : false}
            />
        );
        if (usePrefix) {
            isFirstContentLine = false;
        }
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

    // Wrap in column layout
    return <Box flexDirection="column">{blocks}</Box>;
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
            <RenderInline text={text} defaultColor={headerColor} bold />
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

/**
 * List item with proper word wrapping using wrap-ansi.
 * Continuation lines are indented to align with the first line content.
 */
const RenderListItemInternal: React.FC<RenderListItemProps> = ({
    indent,
    marker,
    text,
    defaultColor,
}) => {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;

    const paddingLeft = Math.floor(indent / 2);
    const markerWithSpace = `${marker} `;
    const markerWidth = stringWidth(markerWithSpace);

    const wrappedLines = useMemo(() => {
        // Parse markdown and convert to ANSI string
        const segments = parseInlineMarkdown(text);
        const ansiString = segmentsToAnsi(segments, defaultColor);

        // Available width = terminal - padding - marker
        const availableWidth = Math.max(20, terminalWidth - paddingLeft - markerWidth);

        // Word-wrap the ANSI string
        const wrapped = wrapAnsi(ansiString, availableWidth, {
            hard: false,
            wordWrap: true,
            trim: false,
        });

        return wrapped.split('\n');
    }, [text, defaultColor, terminalWidth, paddingLeft, markerWidth]);

    const continuationIndent = ' '.repeat(markerWidth);

    return (
        <Box paddingLeft={paddingLeft} flexDirection="column">
            {wrappedLines.map((line, i) => (
                <Box key={i} flexDirection="row">
                    <Text color={defaultColor}>
                        {i === 0 ? markerWithSpace : continuationIndent}
                    </Text>
                    <Text>{line}</Text>
                </Box>
            ))}
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
    // Memoize the highlighted code to avoid re-highlighting on every render
    const highlightedCode = useMemo(() => {
        const code = lines.join('\n');

        // If we have a language and it's supported, use syntax highlighting
        if (language && supportsLanguage(language)) {
            try {
                return highlight(code, { language, ignoreIllegals: true });
            } catch {
                // Fall back to plain cyan if highlighting fails
                return chalk.cyan(code);
            }
        }

        // If no language specified, try auto-detection
        if (!language && code.trim()) {
            try {
                return highlight(code, { ignoreIllegals: true });
            } catch {
                // Fall back to plain cyan if auto-detection fails
                return chalk.cyan(code);
            }
        }

        // Fallback: plain cyan text
        return chalk.cyan(code);
    }, [lines, language]);

    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            {language && <Text color="gray">{language}</Text>}
            <Box flexDirection="column" paddingLeft={1}>
                <Text>{highlightedCode}</Text>
                {isPending && <Text color="gray">...</Text>}
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
