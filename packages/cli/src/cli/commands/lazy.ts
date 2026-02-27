// Lazy command wrappers to avoid loading all command modules at CLI startup.
// Each wrapper imports only the required command module on first use.

export type { CreateAppOptions } from './create-app.js';
export type { CLISetupOptionsInput } from './setup.js';
export type { InstallCommandOptions } from './install.js';
export type { UninstallCommandOptions } from './uninstall.js';
export type { ImageInstallCommandOptionsInput } from './image.js';
export type { ListAgentsCommandOptionsInput } from './list-agents.js';
export type { SyncAgentsCommandOptions } from './sync-agents.js';
export type {
    PluginListCommandOptionsInput,
    PluginInstallCommandOptionsInput,
    MarketplaceListCommandOptionsInput,
    MarketplaceInstallCommandOptionsInput,
} from './plugin.js';

type CreateDextoProjectFn = typeof import('./create-app.js').createDextoProject;
export async function createDextoProject(
    ...args: Parameters<CreateDextoProjectFn>
): Promise<Awaited<ReturnType<CreateDextoProjectFn>>> {
    const mod = await import('./create-app.js');
    return mod.createDextoProject(...args);
}

type CreateImageFn = typeof import('./create-image.js').createImage;
export async function createImage(
    ...args: Parameters<CreateImageFn>
): Promise<Awaited<ReturnType<CreateImageFn>>> {
    const mod = await import('./create-image.js');
    return mod.createImage(...args);
}

type GetUserInputToInitDextoAppFn = typeof import('./init-app.js').getUserInputToInitDextoApp;
export async function getUserInputToInitDextoApp(
    ...args: Parameters<GetUserInputToInitDextoAppFn>
): Promise<Awaited<ReturnType<GetUserInputToInitDextoAppFn>>> {
    const mod = await import('./init-app.js');
    return mod.getUserInputToInitDextoApp(...args);
}

type InitDextoFn = typeof import('./init-app.js').initDexto;
export async function initDexto(
    ...args: Parameters<InitDextoFn>
): Promise<Awaited<ReturnType<InitDextoFn>>> {
    const mod = await import('./init-app.js');
    return mod.initDexto(...args);
}

type PostInitDextoFn = typeof import('./init-app.js').postInitDexto;
export async function postInitDexto(
    ...args: Parameters<PostInitDextoFn>
): Promise<Awaited<ReturnType<PostInitDextoFn>>> {
    const mod = await import('./init-app.js');
    return mod.postInitDexto(...args);
}

type HandleSetupCommandFn = typeof import('./setup.js').handleSetupCommand;
export async function handleSetupCommand(
    ...args: Parameters<HandleSetupCommandFn>
): Promise<Awaited<ReturnType<HandleSetupCommandFn>>> {
    const mod = await import('./setup.js');
    return mod.handleSetupCommand(...args);
}

type HandleInstallCommandFn = typeof import('./install.js').handleInstallCommand;
export async function handleInstallCommand(
    ...args: Parameters<HandleInstallCommandFn>
): Promise<Awaited<ReturnType<HandleInstallCommandFn>>> {
    const mod = await import('./install.js');
    return mod.handleInstallCommand(...args);
}

type HandleUninstallCommandFn = typeof import('./uninstall.js').handleUninstallCommand;
export async function handleUninstallCommand(
    ...args: Parameters<HandleUninstallCommandFn>
): Promise<Awaited<ReturnType<HandleUninstallCommandFn>>> {
    const mod = await import('./uninstall.js');
    return mod.handleUninstallCommand(...args);
}

type HandleImageInstallCommandFn = typeof import('./image.js').handleImageInstallCommand;
export async function handleImageInstallCommand(
    ...args: Parameters<HandleImageInstallCommandFn>
): Promise<Awaited<ReturnType<HandleImageInstallCommandFn>>> {
    const mod = await import('./image.js');
    return mod.handleImageInstallCommand(...args);
}

type HandleImageListCommandFn = typeof import('./image.js').handleImageListCommand;
export async function handleImageListCommand(
    ...args: Parameters<HandleImageListCommandFn>
): Promise<Awaited<ReturnType<HandleImageListCommandFn>>> {
    const mod = await import('./image.js');
    return mod.handleImageListCommand(...args);
}

type HandleImageUseCommandFn = typeof import('./image.js').handleImageUseCommand;
export async function handleImageUseCommand(
    ...args: Parameters<HandleImageUseCommandFn>
): Promise<Awaited<ReturnType<HandleImageUseCommandFn>>> {
    const mod = await import('./image.js');
    return mod.handleImageUseCommand(...args);
}

type HandleImageRemoveCommandFn = typeof import('./image.js').handleImageRemoveCommand;
export async function handleImageRemoveCommand(
    ...args: Parameters<HandleImageRemoveCommandFn>
): Promise<Awaited<ReturnType<HandleImageRemoveCommandFn>>> {
    const mod = await import('./image.js');
    return mod.handleImageRemoveCommand(...args);
}

type HandleImageDoctorCommandFn = typeof import('./image.js').handleImageDoctorCommand;
export async function handleImageDoctorCommand(
    ...args: Parameters<HandleImageDoctorCommandFn>
): Promise<Awaited<ReturnType<HandleImageDoctorCommandFn>>> {
    const mod = await import('./image.js');
    return mod.handleImageDoctorCommand(...args);
}

type HandleListAgentsCommandFn = typeof import('./list-agents.js').handleListAgentsCommand;
export async function handleListAgentsCommand(
    ...args: Parameters<HandleListAgentsCommandFn>
): Promise<Awaited<ReturnType<HandleListAgentsCommandFn>>> {
    const mod = await import('./list-agents.js');
    return mod.handleListAgentsCommand(...args);
}

type HandleWhichCommandFn = typeof import('./which.js').handleWhichCommand;
export async function handleWhichCommand(
    ...args: Parameters<HandleWhichCommandFn>
): Promise<Awaited<ReturnType<HandleWhichCommandFn>>> {
    const mod = await import('./which.js');
    return mod.handleWhichCommand(...args);
}

type HandleSyncAgentsCommandFn = typeof import('./sync-agents.js').handleSyncAgentsCommand;
export async function handleSyncAgentsCommand(
    ...args: Parameters<HandleSyncAgentsCommandFn>
): Promise<Awaited<ReturnType<HandleSyncAgentsCommandFn>>> {
    const mod = await import('./sync-agents.js');
    return mod.handleSyncAgentsCommand(...args);
}

type ShouldPromptForSyncFn = typeof import('./sync-agents.js').shouldPromptForSync;
export async function shouldPromptForSync(
    ...args: Parameters<ShouldPromptForSyncFn>
): Promise<Awaited<ReturnType<ShouldPromptForSyncFn>>> {
    const mod = await import('./sync-agents.js');
    return mod.shouldPromptForSync(...args);
}

type HandleLoginCommandFn = typeof import('./auth/login.js').handleLoginCommand;
export async function handleLoginCommand(
    ...args: Parameters<HandleLoginCommandFn>
): Promise<Awaited<ReturnType<HandleLoginCommandFn>>> {
    const mod = await import('./auth/login.js');
    return mod.handleLoginCommand(...args);
}

type HandleLogoutCommandFn = typeof import('./auth/logout.js').handleLogoutCommand;
export async function handleLogoutCommand(
    ...args: Parameters<HandleLogoutCommandFn>
): Promise<Awaited<ReturnType<HandleLogoutCommandFn>>> {
    const mod = await import('./auth/logout.js');
    return mod.handleLogoutCommand(...args);
}

type HandleStatusCommandFn = typeof import('./auth/status.js').handleStatusCommand;
export async function handleStatusCommand(
    ...args: Parameters<HandleStatusCommandFn>
): Promise<Awaited<ReturnType<HandleStatusCommandFn>>> {
    const mod = await import('./auth/status.js');
    return mod.handleStatusCommand(...args);
}

type HandleBillingStatusCommandFn = typeof import('./billing/status.js').handleBillingStatusCommand;
export async function handleBillingStatusCommand(
    ...args: Parameters<HandleBillingStatusCommandFn>
): Promise<Awaited<ReturnType<HandleBillingStatusCommandFn>>> {
    const mod = await import('./billing/status.js');
    return mod.handleBillingStatusCommand(...args);
}

type HandlePluginListCommandFn = typeof import('./plugin.js').handlePluginListCommand;
export async function handlePluginListCommand(
    ...args: Parameters<HandlePluginListCommandFn>
): Promise<Awaited<ReturnType<HandlePluginListCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handlePluginListCommand(...args);
}

type HandlePluginInstallCommandFn = typeof import('./plugin.js').handlePluginInstallCommand;
export async function handlePluginInstallCommand(
    ...args: Parameters<HandlePluginInstallCommandFn>
): Promise<Awaited<ReturnType<HandlePluginInstallCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handlePluginInstallCommand(...args);
}

type HandlePluginUninstallCommandFn = typeof import('./plugin.js').handlePluginUninstallCommand;
export async function handlePluginUninstallCommand(
    ...args: Parameters<HandlePluginUninstallCommandFn>
): Promise<Awaited<ReturnType<HandlePluginUninstallCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handlePluginUninstallCommand(...args);
}

type HandlePluginValidateCommandFn = typeof import('./plugin.js').handlePluginValidateCommand;
export async function handlePluginValidateCommand(
    ...args: Parameters<HandlePluginValidateCommandFn>
): Promise<Awaited<ReturnType<HandlePluginValidateCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handlePluginValidateCommand(...args);
}

type HandleMarketplaceAddCommandFn = typeof import('./plugin.js').handleMarketplaceAddCommand;
export async function handleMarketplaceAddCommand(
    ...args: Parameters<HandleMarketplaceAddCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplaceAddCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplaceAddCommand(...args);
}

type HandleMarketplaceRemoveCommandFn = typeof import('./plugin.js').handleMarketplaceRemoveCommand;
export async function handleMarketplaceRemoveCommand(
    ...args: Parameters<HandleMarketplaceRemoveCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplaceRemoveCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplaceRemoveCommand(...args);
}

type HandleMarketplaceUpdateCommandFn = typeof import('./plugin.js').handleMarketplaceUpdateCommand;
export async function handleMarketplaceUpdateCommand(
    ...args: Parameters<HandleMarketplaceUpdateCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplaceUpdateCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplaceUpdateCommand(...args);
}

type HandleMarketplaceListCommandFn = typeof import('./plugin.js').handleMarketplaceListCommand;
export async function handleMarketplaceListCommand(
    ...args: Parameters<HandleMarketplaceListCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplaceListCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplaceListCommand(...args);
}

type HandleMarketplacePluginsCommandFn =
    typeof import('./plugin.js').handleMarketplacePluginsCommand;
export async function handleMarketplacePluginsCommand(
    ...args: Parameters<HandleMarketplacePluginsCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplacePluginsCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplacePluginsCommand(...args);
}

type HandleMarketplaceInstallCommandFn =
    typeof import('./plugin.js').handleMarketplaceInstallCommand;
export async function handleMarketplaceInstallCommand(
    ...args: Parameters<HandleMarketplaceInstallCommandFn>
): Promise<Awaited<ReturnType<HandleMarketplaceInstallCommandFn>>> {
    const mod = await import('./plugin.js');
    return mod.handleMarketplaceInstallCommand(...args);
}

type HandleSessionListCommandFn = typeof import('./session-commands.js').handleSessionListCommand;
export async function handleSessionListCommand(
    ...args: Parameters<HandleSessionListCommandFn>
): Promise<Awaited<ReturnType<HandleSessionListCommandFn>>> {
    const mod = await import('./session-commands.js');
    return mod.handleSessionListCommand(...args);
}

type HandleSessionHistoryCommandFn =
    typeof import('./session-commands.js').handleSessionHistoryCommand;
export async function handleSessionHistoryCommand(
    ...args: Parameters<HandleSessionHistoryCommandFn>
): Promise<Awaited<ReturnType<HandleSessionHistoryCommandFn>>> {
    const mod = await import('./session-commands.js');
    return mod.handleSessionHistoryCommand(...args);
}

type HandleSessionDeleteCommandFn =
    typeof import('./session-commands.js').handleSessionDeleteCommand;
export async function handleSessionDeleteCommand(
    ...args: Parameters<HandleSessionDeleteCommandFn>
): Promise<Awaited<ReturnType<HandleSessionDeleteCommandFn>>> {
    const mod = await import('./session-commands.js');
    return mod.handleSessionDeleteCommand(...args);
}

type HandleSessionSearchCommandFn =
    typeof import('./session-commands.js').handleSessionSearchCommand;
export async function handleSessionSearchCommand(
    ...args: Parameters<HandleSessionSearchCommandFn>
): Promise<Awaited<ReturnType<HandleSessionSearchCommandFn>>> {
    const mod = await import('./session-commands.js');
    return mod.handleSessionSearchCommand(...args);
}
