/**
 * PromptAddChoice Component
 * Choose between adding a per-agent prompt or a shared prompt
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { PromptAddScope } from '../../state/types.js';

export type PromptAddChoiceResult = PromptAddScope | 'back';

interface PromptAddChoiceProps {
    isVisible: boolean;
    onSelect: (choice: PromptAddChoiceResult) => void;
    onClose: () => void;
}

export interface PromptAddChoiceHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ChoiceItem {
    id: string;
    scope: PromptAddChoiceResult;
    label: string;
    description: string;
    recommended?: boolean;
}

const CHOICES: ChoiceItem[] = [
    {
        id: 'agent',
        scope: 'agent',
        label: 'For this agent only',
        description: 'Stored in agent config directory',
        recommended: true,
    },
    {
        id: 'shared',
        scope: 'shared',
        label: 'For all agents (shared)',
        description: 'Stored in ~/.dexto/commands/',
    },
];

/**
 * PromptAddChoice - select scope for new prompt
 */
const PromptAddChoice = forwardRef<PromptAddChoiceHandle, PromptAddChoiceProps>(
    function PromptAddChoice({ isVisible, onSelect, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Reset selection when becoming visible
        useEffect(() => {
            if (isVisible) {
                setSelectedIndex(0);
            }
        }, [isVisible]);

        // Forward handleInput to BaseSelector
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        // Format item for display
        const formatItem = (item: ChoiceItem, isSelected: boolean) => {
            return (
                <Box>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {item.label}
                    </Text>
                    {item.recommended && (
                        <Text color={isSelected ? 'green' : 'gray'}> (Recommended)</Text>
                    )}
                    <Text color="gray"> · {item.description}</Text>
                </Box>
            );
        };

        // Handle selection
        const handleSelect = (item: ChoiceItem) => {
            onSelect(item.scope);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={CHOICES}
                isVisible={isVisible}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Add Prompt"
                borderColor="yellowBright"
                emptyMessage="No options available"
            />
        );
    }
);

export default PromptAddChoice;
