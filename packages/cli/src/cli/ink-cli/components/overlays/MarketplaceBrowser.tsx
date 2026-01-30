/**
 * MarketplaceBrowser Component
 * Clean, intuitive marketplace browser with two-level navigation
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import {
    listMarketplaces,
    listAllMarketplacePlugins,
    installPluginFromMarketplace,
    getUninstalledDefaults,
    addMarketplace,
    listInstalledPlugins,
    type MarketplaceEntry,
    type MarketplacePlugin,
} from '@dexto/agent-management';
import { logger } from '@dexto/core';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type MarketplaceBrowserAction =
    | { type: 'add-marketplace' }
    | { type: 'install-plugin'; plugin: MarketplacePlugin }
    | { type: 'plugin-installed'; pluginName: string; marketplace: string }
    | { type: 'marketplace-added'; marketplaceName: string };

interface MarketplaceBrowserProps {
    isVisible: boolean;
    onAction: (action: MarketplaceBrowserAction) => void;
    onClose: () => void;
}

export interface MarketplaceBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type BrowserView = 'marketplaces' | 'plugins' | 'scope-select';

type InstallScope = 'user' | 'project';

// List item types
interface BackItem {
    type: 'back';
}

interface MarketplaceItem {
    type: 'marketplace';
    marketplace: MarketplaceEntry;
    pluginCount: number;
}

interface DefaultMarketplaceItem {
    type: 'default-marketplace';
    name: string;
    sourceValue: string;
    sourceType: 'github' | 'git' | 'local';
}

interface AddMarketplaceItem {
    type: 'add-new';
}

interface PluginItem {
    type: 'plugin';
    plugin: MarketplacePlugin;
    isInstalled: boolean;
}

interface ScopeItem {
    type: 'scope';
    scope: InstallScope;
    label: string;
    description: string;
    icon: string;
}

type ListItem =
    | BackItem
    | MarketplaceItem
    | DefaultMarketplaceItem
    | AddMarketplaceItem
    | PluginItem
    | ScopeItem;

/**
 * Get source type icon
 */
function getSourceIcon(type: string): string {
    switch (type) {
        case 'github':
            return '🐙';
        case 'git':
            return '📦';
        case 'local':
            return '📁';
        default:
            return '📦';
    }
}

/**
 * Marketplace browser overlay - clean two-level navigation
 */
interface UninstalledDefault {
    name: string;
    source: { type: 'github' | 'git' | 'local'; value: string };
}

const MarketplaceBrowser = forwardRef<MarketplaceBrowserHandle, MarketplaceBrowserProps>(
    function MarketplaceBrowser({ isVisible, onAction, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [isLoading, setIsLoading] = useState(true);
        const [loadError, setLoadError] = useState<string | null>(null);
        const [view, setView] = useState<BrowserView>('marketplaces');
        const [marketplaces, setMarketplaces] = useState<MarketplaceEntry[]>([]);
        const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
        const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null);
        const [isInstalling, setIsInstalling] = useState(false);
        const [uninstalledDefaults, setUninstalledDefaults] = useState<UninstalledDefault[]>([]);
        const [pendingPlugin, setPendingPlugin] = useState<MarketplacePlugin | null>(null);
        const [installedPluginNames, setInstalledPluginNames] = useState<Set<string>>(new Set());

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

        // Load data when visible
        useEffect(() => {
            if (isVisible) {
                loadMarketplaces();
            }
        }, [isVisible]);

        // Load marketplaces
        const loadMarketplaces = () => {
            setIsLoading(true);
            setLoadError(null);
            setView('marketplaces');
            setSelectedMarketplace(null);
            setSelectedIndex(0);

            try {
                const mktplaces = listMarketplaces();
                setMarketplaces(mktplaces);

                const allPlugins = listAllMarketplacePlugins();
                setPlugins(allPlugins);

                const defaults = getUninstalledDefaults();
                setUninstalledDefaults(defaults);

                const installed = listInstalledPlugins();
                setInstalledPluginNames(new Set(installed.map((p) => p.name.toLowerCase())));
            } catch (error) {
                setLoadError(
                    `Failed to load: ${error instanceof Error ? error.message : String(error)}`
                );
                setMarketplaces([]);
                setPlugins([]);
                setUninstalledDefaults([]);
                setInstalledPluginNames(new Set());
            } finally {
                setIsLoading(false);
            }
        };

        // Show plugins for a marketplace
        const showMarketplacePlugins = (marketplaceName: string) => {
            setSelectedMarketplace(marketplaceName);
            setView('plugins');
            setSelectedIndex(0);
        };

        // Go back to marketplace list
        const goBackToMarketplaces = () => {
            setView('marketplaces');
            setSelectedMarketplace(null);
            setSelectedIndex(0);
        };

        // Show scope selection for a plugin
        const showScopeSelection = (plugin: MarketplacePlugin) => {
            setPendingPlugin(plugin);
            setView('scope-select');
            setSelectedIndex(0);
        };

        // Go back to plugins from scope selection
        const goBackToPlugins = () => {
            setPendingPlugin(null);
            setView('plugins');
            setSelectedIndex(0);
        };

        // Build items based on current view
        const items = useMemo<ListItem[]>(() => {
            if (view === 'marketplaces') {
                const list: ListItem[] = [];

                // Back option first
                list.push({ type: 'back' });

                // Uninstalled default marketplaces (setup prompts)
                for (const def of uninstalledDefaults) {
                    list.push({
                        type: 'default-marketplace',
                        name: def.name,
                        sourceValue: def.source.value,
                        sourceType: def.source.type,
                    });
                }

                // Installed marketplaces
                for (const m of marketplaces) {
                    const pluginCount = plugins.filter((p) => p.marketplace === m.name).length;
                    list.push({
                        type: 'marketplace',
                        marketplace: m,
                        pluginCount,
                    });
                }

                // Add marketplace option
                list.push({ type: 'add-new' });

                return list;
            } else if (view === 'scope-select') {
                // Scope selection view
                const list: ListItem[] = [{ type: 'back' }];

                list.push({
                    type: 'scope',
                    scope: 'user',
                    label: 'Global (user)',
                    description: 'Available in all projects',
                    icon: '🌐',
                });

                list.push({
                    type: 'scope',
                    scope: 'project',
                    label: 'Project only',
                    description: 'Only in current project, can be committed to git',
                    icon: '📁',
                });

                return list;
            } else {
                // Plugins view
                const filteredPlugins = selectedMarketplace
                    ? plugins.filter((p) => p.marketplace === selectedMarketplace)
                    : plugins;

                const list: ListItem[] = [{ type: 'back' }];

                for (const plugin of filteredPlugins) {
                    const isInstalled = installedPluginNames.has(plugin.name.toLowerCase());
                    list.push({
                        type: 'plugin',
                        plugin,
                        isInstalled,
                    });
                }

                return list;
            }
        }, [
            view,
            marketplaces,
            plugins,
            selectedMarketplace,
            uninstalledDefaults,
            installedPluginNames,
        ]);

        // Format item for display
        const formatItem = (item: ListItem, isSelected: boolean) => {
            // Back option
            if (item.type === 'back') {
                const label =
                    view === 'scope-select'
                        ? 'Back to plugins'
                        : view === 'plugins'
                          ? 'Back to marketplaces'
                          : 'Back to menu';
                return (
                    <Box>
                        <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                        <Text color="gray">← </Text>
                        <Text color={isSelected ? 'white' : 'gray'}>{label}</Text>
                    </Box>
                );
            }

            // Scope selection option
            if (item.type === 'scope') {
                return (
                    <Box flexDirection="column">
                        <Box>
                            <Text color={isSelected ? 'cyan' : 'gray'}>
                                {isSelected ? '▸ ' : '  '}
                            </Text>
                            <Text>{item.icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {item.label}
                            </Text>
                        </Box>
                        {isSelected && (
                            <Box marginLeft={4}>
                                <Text color="gray" dimColor>
                                    {item.description}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            }

            // Add marketplace option
            if (item.type === 'add-new') {
                return (
                    <Box>
                        <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                        <Text color={isSelected ? 'green' : 'gray'}>+ </Text>
                        <Text color={isSelected ? 'green' : 'gray'}>Add custom marketplace</Text>
                    </Box>
                );
            }

            // Default (uninstalled) marketplace
            if (item.type === 'default-marketplace') {
                const icon = getSourceIcon(item.sourceType);
                return (
                    <Box flexDirection="column">
                        <Box>
                            <Text color={isSelected ? 'cyan' : 'gray'}>
                                {isSelected ? '▸ ' : '  '}
                            </Text>
                            <Text>{icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {item.name}
                            </Text>
                            <Text color="yellow"> (not installed)</Text>
                        </Box>
                        {isSelected && (
                            <Box marginLeft={4}>
                                <Text color="gray" dimColor>
                                    {item.sourceValue}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            }

            // Installed marketplace
            if (item.type === 'marketplace') {
                const m = item.marketplace;
                const icon = getSourceIcon(m.source.type);

                return (
                    <Box flexDirection="column">
                        <Box>
                            <Text color={isSelected ? 'cyan' : 'gray'}>
                                {isSelected ? '▸ ' : '  '}
                            </Text>
                            <Text>{icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {m.name}
                            </Text>
                            <Text color="gray" dimColor>
                                {' '}
                                ({item.pluginCount} plugins)
                            </Text>
                        </Box>
                        {isSelected && (
                            <Box marginLeft={4}>
                                <Text color="gray" dimColor>
                                    {m.source.value}
                                </Text>
                            </Box>
                        )}
                    </Box>
                );
            }

            // Plugin item
            const p = item.plugin;
            const statusBadge = item.isInstalled ? <Text color="green"> ✓</Text> : null;

            return (
                <Box flexDirection="column">
                    <Box>
                        <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                        <Text color={isSelected ? 'white' : 'gray'}>📦 </Text>
                        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                            {p.name}
                        </Text>
                        {p.version && (
                            <Text color="gray" dimColor>
                                @{p.version}
                            </Text>
                        )}
                        {p.category && (
                            <Text color="magenta" dimColor>
                                {' '}
                                [{p.category}]
                            </Text>
                        )}
                        {statusBadge}
                    </Box>
                    {isSelected && p.description && (
                        <Box marginLeft={4}>
                            <Text color="gray">{p.description}</Text>
                        </Box>
                    )}
                    {isSelected && item.isInstalled && (
                        <Box marginLeft={4}>
                            <Text color="gray" dimColor>
                                Already installed
                            </Text>
                        </Box>
                    )}
                </Box>
            );
        };

        // Handle selection
        const handleSelect = async (item: ListItem) => {
            if (item.type === 'back') {
                if (view === 'scope-select') {
                    goBackToPlugins();
                } else if (view === 'plugins') {
                    goBackToMarketplaces();
                } else {
                    onClose();
                }
                return;
            }

            if (item.type === 'add-new') {
                onAction({ type: 'add-marketplace' });
                return;
            }

            if (item.type === 'default-marketplace' && !isInstalling) {
                setIsInstalling(true);
                try {
                    await addMarketplace(item.sourceValue, { name: item.name });
                    onAction({ type: 'marketplace-added', marketplaceName: item.name });
                    loadMarketplaces();
                } catch (error) {
                    logger.error(
                        `Failed to add marketplace ${item.name}: ${error instanceof Error ? error.message : String(error)}`
                    );
                } finally {
                    setIsInstalling(false);
                }
                return;
            }

            if (item.type === 'marketplace') {
                showMarketplacePlugins(item.marketplace.name);
                return;
            }

            // Show scope selection for plugin
            if (item.type === 'plugin' && !item.isInstalled) {
                showScopeSelection(item.plugin);
                return;
            }

            // Install plugin with selected scope
            if (item.type === 'scope' && pendingPlugin && !isInstalling) {
                setIsInstalling(true);
                try {
                    const result = await installPluginFromMarketplace(
                        `${pendingPlugin.name}@${pendingPlugin.marketplace}`,
                        { scope: item.scope }
                    );
                    setInstalledPluginNames((prev) => {
                        const next = new Set(prev);
                        next.add(result.pluginName.toLowerCase());
                        return next;
                    });
                    onAction({
                        type: 'plugin-installed',
                        pluginName: result.pluginName,
                        marketplace: result.marketplace,
                    });
                    // Go back to plugins view after successful install
                    goBackToPlugins();
                } catch (error) {
                    logger.error(
                        `Failed to install ${pendingPlugin.name}: ${error instanceof Error ? error.message : String(error)}`
                    );
                } finally {
                    setIsInstalling(false);
                }
            }
        };

        // Get title based on view
        const getTitle = () => {
            if (view === 'scope-select' && pendingPlugin) {
                return `Install ${pendingPlugin.name} › Choose Scope`;
            }
            if (view === 'plugins' && selectedMarketplace) {
                return `${selectedMarketplace} › Plugins`;
            }
            return 'Marketplace';
        };

        // Get empty message
        const getEmptyMessage = () => {
            if (loadError) return loadError;
            if (view === 'plugins') return 'No plugins found in this marketplace';
            return 'No marketplaces. Add one to browse plugins.';
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={items}
                isVisible={isVisible}
                isLoading={isLoading || isInstalling}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title={getTitle()}
                borderColor="green"
                emptyMessage={getEmptyMessage()}
                loadingMessage={isInstalling ? 'Installing...' : 'Loading...'}
            />
        );
    }
);

export default MarketplaceBrowser;
