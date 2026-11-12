// Local files given for an App action's file fields: uploaded to the app's Drive folder, then referred to.

import { isJsonObject, type CommandContext } from '../command.js';
import { putAppFile } from './drive.js';

/** The JSON Schema `format` of a string that takes a Drive file, as `drive:<id>`. */
export const DRIVE_FILE_FORMAT = 'dexto-drive-file';

/**
 * How a field takes files: as the reference itself, or as an object whose `property` is the
 * reference, with the file's `name` and `mimeType` beside it where the object has them. `list`
 * says the field takes several.
 */
export interface FileField {
    readonly list: boolean;
    readonly slot:
        | { readonly kind: 'reference' }
        | {
              readonly kind: 'object';
              readonly mimeType: boolean;
              readonly name: boolean;
              readonly property: string;
          };
}

/** A field's file slot, from its schema: a string of the Drive file format, alone or in an object. */
export function fileFieldOf(property: Record<string, unknown>): FileField | null {
    const items = property.type === 'array' && isJsonObject(property.items) ? property.items : null;
    const slot = slotOf(items ?? property);
    return slot === null ? null : { list: items !== null, slot };
}

function slotOf(schema: Record<string, unknown>): FileField['slot'] | null {
    if (takesFile(schema)) return { kind: 'reference' };
    if (schema.type !== 'object' || !isJsonObject(schema.properties)) return null;
    const { properties } = schema;
    const property = Object.keys(properties).find((name) => {
        const each = properties[name];
        return isJsonObject(each) && takesFile(each);
    });
    return property === undefined
        ? null
        : {
              kind: 'object',
              mimeType: isJsonObject(properties.mimeType),
              name: isJsonObject(properties.name),
              property,
          };
}

function takesFile(schema: Record<string, unknown>): boolean {
    return schema.type === 'string' && schema.format === DRIVE_FILE_FORMAT;
}

/**
 * The field's values with each local path uploaded into the app's Drive folder: a link (`https:`,
 * `drive:`) is kept as it is, and a value given as JSON is left alone.
 */
export async function attachFiles(
    context: CommandContext,
    appId: string,
    field: FileField,
    values: readonly unknown[]
): Promise<unknown[]> {
    const attached: unknown[] = [];
    for (const value of values) {
        if (typeof value !== 'string') {
            attached.push(value);
            continue;
        }
        const file = LINK.test(value)
            ? { mimeType: null, name: null, uri: value }
            : await uploadAppFile(context, appId, value);
        const { slot } = field;
        attached.push(
            slot.kind === 'reference'
                ? file.uri
                : {
                      [slot.property]: file.uri,
                      ...(slot.name && file.name !== null ? { name: file.name } : {}),
                      ...(slot.mimeType && file.mimeType !== null
                          ? { mimeType: file.mimeType }
                          : {}),
                  }
        );
    }
    return attached;
}

/** A value that already refers to a file, rather than naming a local one. */
const LINK = /^(?:https?:\/\/|drive:)/iu;

/** A value naming a local file to upload, rather than a link or JSON given as it is. */
export function isLocalFile(value: unknown): boolean {
    return typeof value === 'string' && !LINK.test(value);
}

async function uploadAppFile(
    context: CommandContext,
    appId: string,
    localPath: string
): Promise<{ mimeType: string; name: string; uri: string }> {
    const file = await putAppFile(context, localPath, appId);
    const uri = `drive:${file.id}`;
    context.output.note(`Uploaded ${localPath} to your Drive as ${uri}.`);
    return { mimeType: file.mimeType, name: file.name, uri };
}
