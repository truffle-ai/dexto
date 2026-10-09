import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { SessionApproval } from '@dexto/core';
import type { TuiAgentBackend } from '../../agent-backend.js';
import type { UIState } from '../../state/types.js';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { formatApprovalScope } from '../../utils/approvalScope.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

type PermissionMode = 'defaults' | 'edits' | 'auto';
type PermissionOption =
    | { kind: 'mode'; value: PermissionMode; label: string }
    | { kind: 'grant'; approval: SessionApproval; label: string };

interface PermissionsSelectorProps {
    agent: TuiAgentBackend;
    sessionId: string | null;
    ui: UIState;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    onClose: () => void;
}

export interface PermissionsSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

export const PermissionsSelector = forwardRef<PermissionsSelectorHandle, PermissionsSelectorProps>(
    function PermissionsSelector({ agent, sessionId, ui, setUi, onClose }, ref) {
        const selectorRef = useRef<BaseSelectorHandle>(null);
        const [grants, setGrants] = useState<SessionApproval[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(
            ui.bypassPermissions ? 2 : ui.autoApproveEdits ? 1 : 0
        );
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const mode = ui.bypassPermissions ? 'auto' : ui.autoApproveEdits ? 'edits' : 'defaults';

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input, key) => selectorRef.current?.handleInput(input, key) ?? false,
            }),
            []
        );

        useEffect(() => {
            let active = true;
            async function load() {
                try {
                    const approvals =
                        sessionId && agent.getSessionApprovals
                            ? await agent.getSessionApprovals(sessionId)
                            : [];
                    if (active) setGrants(approvals);
                } catch (cause) {
                    if (active) setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                    if (active) setIsLoading(false);
                }
            }
            void load();
            return () => {
                active = false;
            };
        }, [agent, sessionId]);

        const options: PermissionOption[] = [
            { kind: 'mode', value: 'defaults', label: 'Agent defaults' },
            { kind: 'mode', value: 'edits', label: 'Accept edits for this session' },
            { kind: 'mode', value: 'auto', label: 'Auto-approve for this session' },
            ...grants.map(
                (approval): PermissionOption => ({
                    kind: 'grant',
                    approval,
                    label: `Revoke ${formatApprovalScope(approval)}`,
                })
            ),
        ];

        async function select(option: PermissionOption) {
            if (option.kind === 'mode') {
                setUi((previous) => ({
                    ...previous,
                    autoApproveEdits: option.value === 'edits',
                    bypassPermissions: option.value === 'auto',
                    planModeActive: false,
                    planModeInitialized: false,
                }));
                onClose();
                return;
            }
            if (!sessionId || !agent.revokeSessionApproval) return;
            setIsLoading(true);
            setError(null);
            try {
                await agent.revokeSessionApproval(sessionId, option.approval);
                setGrants((previous) =>
                    previous.filter(
                        (grant) =>
                            grant.kind !== option.approval.kind ||
                            grant.value !== option.approval.value
                    )
                );
                setSelectedIndex(0);
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
                setIsLoading(false);
            }
        }

        return (
            <Box flexDirection="column">
                <Text color="gray">
                    Agent policy:{' '}
                    {agent.getEffectiveConfig(sessionId ?? undefined).permissions.mode}
                </Text>
                <Text color="gray">
                    Mode applies to this TUI session. Remembered grants also apply when this
                    conversation resumes.
                </Text>
                {error && <Text color="red">{error}</Text>}
                <BaseSelector
                    ref={selectorRef}
                    items={options}
                    isVisible={true}
                    isLoading={isLoading}
                    selectedIndex={selectedIndex}
                    onSelectIndex={setSelectedIndex}
                    onSelect={(option) => {
                        void select(option);
                    }}
                    onClose={onClose}
                    title="Session permissions"
                    formatItem={(option, selected) => (
                        <Text color={selected ? 'cyan' : 'white'}>
                            {option.kind === 'mode' && option.value === mode ? '● ' : '  '}
                            {option.label}
                        </Text>
                    )}
                />
                {grants.length === 0 && !isLoading && (
                    <Text color="gray">No remembered user grants.</Text>
                )}
            </Box>
        );
    }
);
