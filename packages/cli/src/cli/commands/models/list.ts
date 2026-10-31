// `dexto models list`: the models Dexto serves on the sign-in, as `dexto/<id>`.

import type { dextoGateway } from '@dexto/agent-management';
import { CommandError } from '../auth/sign-in-commands.js';

export async function listDextoModels(io: {
    readonly read: () => Promise<readonly dextoGateway.DextoModel[] | null>;
    readonly print: (text: string) => void;
}): Promise<void> {
    const models = await io.read();
    if (models === null)
        throw new CommandError(3, 'Not signed in. Run dexto login, or set DEXTO_API_KEY.');
    const ids = models.map((model) => `dexto/${model.id}`);
    const width = Math.max(0, ...ids.map((id) => id.length));
    io.print(
        models
            .map((model, index) => `${(ids[index] ?? '').padEnd(width)}  ${model.name}`)
            .join('\n')
    );
}
