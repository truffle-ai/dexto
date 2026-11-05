/**
 * The Signal start screen (DEXTO-2041 screen 1): the wordmark sized to the terminal, the line
 * that says what Dexto is, and what this chat runs on. Notices (an update, agent configs to
 * sync) follow as the first notes of the transcript, not inside the header.
 */
import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { StartupInfo } from '../../state/types.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Wordmark, useCaps, useTone, type Role } from '../../signal/index.js';
import { wordmarkRowsFor } from '../../signal/text.js';

interface SignalHeaderProps {
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
    startupInfo: StartupInfo;
}

const TAGLINE = 'Local agent harness. Cloud when you sign in.';

function NoticeRow({ label, children }: { label: string; children: ReactNode }) {
    const tone = useTone();
    return (
        <Box>
            <Text color={tone('amberDim')}>{'  ▌ '}</Text>
            <Text bold color={tone('amber')}>
                {label.padEnd(8)}
            </Text>
            <Text color={tone('fg')}>{children}</Text>
        </Box>
    );
}

function Field({ label, value, role = 'hi' }: { label: string; value: string; role?: Role }) {
    const tone = useTone();
    return (
        <>
            <Text color={tone('dim')}>{label} </Text>
            <Text color={tone(role)}>{value}</Text>
        </>
    );
}

export function SignalHeader({
    modelName,
    sessionId,
    hasActiveSession,
    startupInfo,
}: SignalHeaderProps) {
    const tone = useTone();
    const { columns, rows } = useTerminalSize();
    // NO_COLOR gets the word, not the drawing.
    const wordmarkRows = useCaps().color === 'none' ? null : wordmarkRowsFor(columns, rows);
    const version = process.env.DEXTO_CLI_VERSION;
    const meta = version === undefined ? 'dexto' : `dexto ${version}`;
    const sep = <Text color={tone('faint')}> · </Text>;
    return (
        <Box flexDirection="column" flexShrink={0} width={columns} paddingTop={1}>
            {wordmarkRows === null ? (
                <Text bold color={tone('hi')}>
                    dexto
                </Text>
            ) : (
                <Wordmark rows={wordmarkRows} />
            )}
            <Box marginTop={1} justifyContent="space-between" flexWrap="wrap">
                <Text color={tone('fg')}>{TAGLINE}</Text>
                <Text color={tone('faint')}>{meta}</Text>
            </Box>
            <Box marginTop={1} flexWrap="wrap">
                <Field label="model" value={modelName} />
                {hasActiveSession && sessionId ? (
                    <>
                        {sep}
                        <Field label="chat" value={sessionId.slice(0, 8)} />
                    </>
                ) : null}
                {sep}
                <Field label="servers" value={String(startupInfo.connectedServers.count)} />
                {sep}
                <Field label="tools" value={String(startupInfo.toolCount)} />
            </Box>
            {startupInfo.failedConnections.length > 0 && (
                <Box>
                    <Text color={tone('redDim')}>{'  ▌ '}</Text>
                    <Text bold color={tone('red')}>
                        {'MCP'.padEnd(8)}
                    </Text>
                    <Text color={tone('fg')}>
                        {`couldn't connect: ${startupInfo.failedConnections.join(', ')}`}
                    </Text>
                </Box>
            )}
            {(startupInfo.updateInfo || startupInfo.needsAgentSync) && (
                <Box marginTop={1} flexDirection="column">
                    {startupInfo.updateInfo && (
                        <NoticeRow label="UPDATE">
                            {`dexto ${startupInfo.updateInfo.latest} is out (you have ${startupInfo.updateInfo.current}) · run `}
                            <Text color={tone('teal')}>{startupInfo.updateInfo.updateCommand}</Text>
                        </NoticeRow>
                    )}
                    {startupInfo.needsAgentSync && (
                        <NoticeRow label="SYNC">
                            {'agent configs have updates · run '}
                            <Text color={tone('teal')}>dexto sync-agents</Text>
                        </NoticeRow>
                    )}
                </Box>
            )}
            <Text> </Text>
        </Box>
    );
}
