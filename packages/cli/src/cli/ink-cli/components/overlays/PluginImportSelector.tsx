/**
 * PluginImportSelector Component
 * Lists Claude Code plugins available for import
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { listClaudeCodePlugins, importClaudeCodePlugin } from '@dexto/agent-management';
import { logger } from '@dexto/core';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface PluginImportSelectorProps {
    isVisible: boolean;
    onImport: (pluginName: string, pluginPath: string) => void;
    onClose: () => void;
}

export interface PluginImportSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface LocalPluginItem {
    name: string;
    version: string | undefined;
    description: string | undefined;
    path: string;
    isImported: boolean;
}

/**
 * Plugin import selector - lists Claude Code plugins that can be imported
 */
const PluginImportSelector = forwardRef<PluginImportSelectorHandle, PluginImportSelectorProps>(
    function PluginImportSelector({ isVisible, onImport, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

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

        const [plugins, setPlugins] = useState<LocalPluginItem[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [isLoading, setIsLoading] = useState(true);
        const [loadError, setLoadError] = useState<string | null>(null);

        // Load Claude Code plugins when visible
        useEffect(() => {
            if (isVisible) {
                setIsLoading(true);
                setLoadError(null);
                try {
                    const claudePlugins = listClaudeCodePlugins();
                    // Filter to only show non-imported plugins and map to our local type
                    const notImported = claudePlugins
                        .filter((p) => !p.isImported)
                        .map(
                            (p): LocalPluginItem => ({
                                name: p.name,
                                version: p.version,
                                description: p.description,
                                path: p.path,
                                isImported: p.isImported,
                            })
                        );
                    setPlugins(notImported);
                } catch (error) {
                    setPlugins([]);
                    setLoadError(
                        `Failed to load plugins: ${error instanceof Error ? error.message : String(error)}`
                    );
                } finally {
                    setIsLoading(false);
                    setSelectedIndex(0);
                }
            }
        }, [isVisible]);

        // Format plugin for display
        const formatItem = (plugin: LocalPluginItem, isSelected: boolean) => {
            return (
                <Box flexDirection="column">
                    <Box>
                        <Text>📦 </Text>
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {plugin.name}
                        </Text>
                        <Text color={isSelected ? 'white' : 'gray'}>
                            @{plugin.version || 'unknown'}
                        </Text>
                    </Box>
                    {plugin.description && (
                        <Box marginLeft={2}>
                            <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                                {plugin.description}
                            </Text>
                        </Box>
                    )}
                    {isSelected && (
                        <Box marginLeft={2}>
                            <Text color="gray" dimColor>
                                {plugin.path}
                            </Text>
                        </Box>
                    )}
                </Box>
            );
        };

        // Handle selection - import the plugin
        const handleSelect = async (plugin: LocalPluginItem) => {
            try {
                await importClaudeCodePlugin(plugin.name);
                onImport(plugin.name, plugin.path);
            } catch (error) {
                logger.error(
                    `PluginImportSelector.handleSelect failed to import ${plugin.name}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={plugins}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Import Claude Code Plugin"
                borderColor="green"
                emptyMessage={loadError || 'No Claude Code plugins available to import'}
            />
        );
    }
);

export default PluginImportSelector;
