/**
 * SearchRenderer Component
 *
 * Renders search results with file:line format.
 * Used for grep_content and glob_files tool results.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SearchDisplayData } from '@dexto/core';

interface SearchRendererProps {
    /** Search display data from tool result */
    data: SearchDisplayData;
    /** Maximum matches to display before truncating */
    maxMatches?: number;
}

/**
 * Renders search results with file paths and line numbers.
 */
export function SearchRenderer({ data, maxMatches = 10 }: SearchRendererProps) {
    const { pattern, matches, totalMatches, truncated: dataTruncated } = data;
    const displayMatches = matches.slice(0, maxMatches);
    const truncated = dataTruncated || matches.length > maxMatches;

    return (
        <Box flexDirection="column">
            {/* Summary header */}
            <Text color="gray" dimColor>
                {totalMatches} match{totalMatches !== 1 ? 'es' : ''} for "{pattern}"
                {truncated && ' (truncated)'}
            </Text>

            {/* Match results */}
            {displayMatches.map((match, i) => (
                <Box key={i}>
                    <Text color="cyan">{match.file}</Text>
                    {match.line > 0 && (
                        <Text color="gray" dimColor>
                            :{match.line}
                        </Text>
                    )}
                    {match.content && match.file !== match.content && (
                        <Text color="gray" dimColor wrap="truncate">
                            {' '}
                            {match.content.slice(0, 60)}
                            {match.content.length > 60 ? '...' : ''}
                        </Text>
                    )}
                </Box>
            ))}

            {matches.length > maxMatches && (
                <Text color="gray" dimColor>
                    ... ({matches.length - maxMatches} more matches)
                </Text>
            )}
        </Box>
    );
}
