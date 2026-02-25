import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import { HintBar } from '../shared/HintBar.js';

export interface CommandOutputOverlayProps {
    isVisible: boolean;
    title: string;
    content: string;
    onClose: () => void;
}

export interface CommandOutputOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

export const CommandOutputOverlay = forwardRef<
    CommandOutputOverlayHandle,
    CommandOutputOverlayProps
>(function CommandOutputOverlay({ isVisible, title, content, onClose }, ref) {
    const { columns, rows } = useTerminalSize();
    const viewportLines = useMemo(() => {
        return getMaxVisibleItemsForTerminalRows({
            rows,
            hardCap: 20,
            reservedRows: 10,
        });
    }, [rows]);

    const [scrollOffset, setScrollOffset] = useState(0);
    const wrappedLines = useMemo(() => {
        const width = Math.max(20, columns - 2);
        const wrapped = wrapAnsi(content || '', width, {
            hard: true,
            wordWrap: true,
            trim: false,
        });
        return wrapped.length > 0 ? wrapped.split('\n') : [];
    }, [content, columns]);

    const maxScrollOffset = useMemo(() => {
        return Math.max(0, wrappedLines.length - viewportLines);
    }, [wrappedLines.length, viewportLines]);

    useEffect(() => {
        setScrollOffset((prev) => Math.min(maxScrollOffset, Math.max(0, prev)));
    }, [maxScrollOffset]);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) return false;

                if (key.escape) {
                    onClose();
                    return true;
                }

                if (key.upArrow) {
                    setScrollOffset((prev) => Math.max(0, prev - 1));
                    return true;
                }
                if (key.downArrow) {
                    setScrollOffset((prev) => Math.min(maxScrollOffset, prev + 1));
                    return true;
                }

                return true;
            },
        }),
        [isVisible, maxScrollOffset, onClose]
    );

    if (!isVisible) return null;

    const visible = wrappedLines.slice(scrollOffset, scrollOffset + viewportLines);
    const hint = wrappedLines.length > viewportLines ? ['↑↓ scroll', 'Esc close'] : ['Esc close'];

    return (
        <Box flexDirection="column" width={columns}>
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold wrap="truncate-end">
                    {title}
                </Text>
            </Box>

            <Box flexDirection="column" height={viewportLines} marginTop={1}>
                {Array.from({ length: viewportLines }, (_, rowIndex) => {
                    const line = visible[rowIndex];
                    return (
                        <Box key={`line-${rowIndex}`} paddingX={0} paddingY={0}>
                            <Text wrap="truncate-end">{line ?? ' '}</Text>
                        </Box>
                    );
                })}
            </Box>

            <Box paddingX={0} paddingY={0} marginTop={1}>
                <HintBar hints={hint} />
            </Box>
        </Box>
    );
});
