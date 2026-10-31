// `dexto billing`: the organization's credits and recent spending, on the sign-in.

import chalk from 'chalk';
import type { dextoGateway } from '@dexto/agent-management';
import { CommandError } from '../auth/sign-in-commands.js';

export async function showBillingStatus(io: {
    readonly read: () => Promise<dextoGateway.DextoBillingSummary | null>;
    readonly print: (text: string) => void;
}): Promise<void> {
    const summary = await io.read();
    if (summary === null)
        throw new CommandError(3, 'Not signed in. Run dexto login, or set DEXTO_API_KEY.');
    io.print(
        [
            `${chalk.bold(`$${summary.balanceUsd.toFixed(2)}`)} remaining. Buy more with dexto billing --buy.`,
            `$${summary.last30Days.costUsd.toFixed(4)} over ${summary.last30Days.usageEvents} requests in the last 30 days.`,
            ...summary.recent
                .slice(0, 5)
                .map(
                    (usage) =>
                        `  ${chalk.dim(new Date(usage.timestamp).toLocaleString())} ${usage.model}: $${usage.costUsd.toFixed(4)}`
                ),
        ].join('\n')
    );
}
