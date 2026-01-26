/**
 * MarketplaceBrowser Component
 * Browse plugin marketplaces and install plugins
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

type BrowserView = 'marketplaces' | 'plugins';

interface MarketplaceListItem {
    type: 'marketplace';
    marketplace: MarketplaceEntry;
}

interface PluginListItem {
    type: 'plugin';
    plugin: MarketplacePlugin;
}

interface AddMarketplaceItem {
    type: 'add-new';
}

interface BackItem {
    type: 'back';
}

interface DefaultMarketplaceItem {
    type: 'default-marketplace';
    name: string;
    sourceValue: string;
    sourceType: 'github' | 'git' | 'local';
}

type ListItem =
    | MarketplaceListItem
    | PluginListItem
    | AddMarketplaceItem
    | BackItem
    | DefaultMarketplaceItem;

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
 * Marketplace browser overlay
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

                // Also load all plugins for quick access
                const allPlugins = listAllMarketplacePlugins();
                setPlugins(allPlugins);

                // Load uninstalled default marketplaces
                const defaults = getUninstalledDefaults();
                setUninstalledDefaults(defaults);

                // Load installed plugins to show status
                const installed = listInstalledPlugins();
                setInstalledPluginNames(new Set(installed.map((p) => p.name.toLowerCase())));
            } catch (error) {
                setLoadError(
                    `Failed to load marketplaces: ${error instanceof Error ? error.message : String(error)}`
                );
                setMarketplaces([]);
                setPlugins([]);
                setUninstalledDefaults([]);
                setInstalledPluginNames(new Set());
            } finally {
                setIsLoading(false);
            }
        };

        // Load plugins for a specific marketplace
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

        // Build items based on current view
        const items = useMemo<ListItem[]>(() => {
            if (view === 'marketplaces') {
                const list: ListItem[] = [];

                // Add uninstalled default marketplaces first (with setup prompt)
                for (const def of uninstalledDefaults) {
                    list.push({
                        type: 'default-marketplace' as const,
                        name: def.name,
                        sourceValue: def.source.value,
                        sourceType: def.source.type,
                    });
                }

                // Add installed marketplaces
                list.push(
                    ...marketplaces.map((m) => ({
                        type: 'marketplace' as const,
                        marketplace: m,
                    }))
                );

                // Add "Add marketplace" option
                list.push({ type: 'add-new' as const });

                return list;
            } else {
                // Plugins view
                const filteredPlugins = selectedMarketplace
                    ? plugins.filter((p) => p.marketplace === selectedMarketplace)
                    : plugins;

                const list: ListItem[] = filteredPlugins.map((p) => ({
                    type: 'plugin' as const,
                    plugin: p,
                }));

                // Add back option at the top
                list.unshift({ type: 'back' as const });

                return list;
            }
        }, [view, marketplaces, plugins, selectedMarketplace, uninstalledDefaults]);

        // Format item for display
        const formatItem = (item: ListItem, isSelected: boolean) => {
            if (item.type === 'add-new') {
                return (
                    <Box>
                        <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                            + Add marketplace
                        </Text>
                    </Box>
                );
            }

            if (item.type === 'back') {
                return (
                    <Box>
                        <Text color={isSelected ? 'yellow' : 'gray'} bold={isSelected}>
                            {'<'} Back to marketplaces
                        </Text>
                    </Box>
                );
            }

            if (item.type === 'default-marketplace') {
                const icon = getSourceIcon(item.sourceType);
                return (
                    <Box flexDirection="column">
                        <Box>
                            <Text>{icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {item.name}
                            </Text>
                            <Text color="yellow"> (not installed)</Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text color="gray" dimColor>
                                {item.sourceValue}
                            </Text>
                        </Box>
                        {isSelected && (
                            <Box marginLeft={2}>
                                <Text color="green">Press Enter to install this marketplace</Text>
                            </Box>
                        )}
                    </Box>
                );
            }

            if (item.type === 'marketplace') {
                const m = item.marketplace;
                const pluginCount = plugins.filter((p) => p.marketplace === m.name).length;
                const icon = getSourceIcon(m.source.type);

                return (
                    <Box flexDirection="column">
                        <Box>
                            <Text>{icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {m.name}
                            </Text>
                            <Text color="gray"> ({pluginCount} plugins)</Text>
                        </Box>
                        {isSelected && (
                            <Box marginLeft={2}>
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
            const isInstalled = installedPluginNames.has(p.name.toLowerCase());
            return (
                <Box flexDirection="column">
                    <Box>
                        <Text>📦 </Text>
                        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                            {p.name}
                        </Text>
                        {p.version && <Text color="gray">@{p.version}</Text>}
                        {p.category && <Text color="magenta"> [{p.category}]</Text>}
                        {isInstalled && <Text color="green"> (installed)</Text>}
                    </Box>
                    {p.description && (
                        <Box marginLeft={2}>
                            <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                                {p.description}
                            </Text>
                        </Box>
                    )}
                    {isSelected && !isInstalled && (
                        <Box marginLeft={2}>
                            <Text color="green" dimColor>
                                Press Enter to install
                            </Text>
                        </Box>
                    )}
                    {isSelected && isInstalled && (
                        <Box marginLeft={2}>
                            <Text color="gray" dimColor>
                                Already installed - use /plugin to manage
                            </Text>
                        </Box>
                    )}
                </Box>
            );
        };

        // Handle selection
        const handleSelect = async (item: ListItem) => {
            if (item.type === 'add-new') {
                onAction({ type: 'add-marketplace' });
                return;
            }

            if (item.type === 'back') {
                goBackToMarketplaces();
                return;
            }

            if (item.type === 'default-marketplace' && !isInstalling) {
                // Install the default marketplace
                setIsInstalling(true);
                try {
                    await addMarketplace(item.sourceValue, { name: item.name });
                    onAction({ type: 'marketplace-added', marketplaceName: item.name });
                    // Reload to show the newly installed marketplace
                    loadMarketplaces();
                } catch (error) {
                    logger.error(
                        `MarketplaceBrowser.handleSelect failed to add marketplace ${item.name}: ${error instanceof Error ? error.message : String(error)}`
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

            // Install plugin (skip if already installed)
            if (item.type === 'plugin' && !isInstalling) {
                const isAlreadyInstalled = installedPluginNames.has(item.plugin.name.toLowerCase());
                if (isAlreadyInstalled) {
                    // Already installed, do nothing (user can manage via /plugin)
                    return;
                }

                setIsInstalling(true);
                try {
                    const result = await installPluginFromMarketplace(
                        `${item.plugin.name}@${item.plugin.marketplace}`
                    );
                    // Update installed plugins set
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
                } catch (error) {
                    logger.error(
                        `MarketplaceBrowser.handleSelect failed to install ${item.plugin.name}: ${error instanceof Error ? error.message : String(error)}`
                    );
                } finally {
                    setIsInstalling(false);
                }
            }
        };

        // Get title based on view
        const getTitle = () => {
            if (view === 'plugins' && selectedMarketplace) {
                return `Plugins - ${selectedMarketplace}`;
            }
            return 'Plugin Marketplace';
        };

        // Get empty message based on view
        const getEmptyMessage = () => {
            if (loadError) return loadError;
            if (view === 'plugins') return 'No plugins found in this marketplace';
            return 'No marketplaces registered. Add one to get started.';
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
            />
        );
    }
);

export default MarketplaceBrowser;
