import { setImageImporter } from '@dexto/agent-config';
import { importImageModule } from './image-store.js';

let imageImporterConfigured = false;

export async function ensureImageImporterConfigured(): Promise<void> {
    if (imageImporterConfigured) {
        return;
    }

    setImageImporter((specifier) => importImageModule(specifier));
    imageImporterConfigured = true;
}
