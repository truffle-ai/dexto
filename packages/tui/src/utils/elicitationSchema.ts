export interface ElicitationFormField {
    name: string;
    stepLabel: string;
    question: string;
    helpText: string | undefined;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'array-enum';
    required: boolean;
    enumValues: unknown[] | undefined;
}

function humanizeIdentifier(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCaseWords(value: string): string {
    return value
        .split(' ')
        .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
        .join(' ');
}

function cleanLabel(value: string): string {
    return value
        .replace(/^\s*\d+\s*[).:-]\s*/g, '')
        .replace(/\s*[:*]\s*$/g, '')
        .trim();
}

function makeLabel(name: string): string {
    return titleCaseWords(humanizeIdentifier(name)) || name;
}

function getXDextoStepLabel(prop: Record<string, unknown>): string | undefined {
    const xDexto = prop['x-dexto'];
    if (!xDexto || typeof xDexto !== 'object' || Array.isArray(xDexto)) return undefined;
    const stepLabel = (xDexto as Record<string, unknown>).stepLabel;
    if (typeof stepLabel !== 'string') return undefined;
    return cleanLabel(stepLabel) || undefined;
}

type JsonSchemaProp = {
    type?: string;
    title?: string;
    description?: string;
    enum?: unknown[];
    items?: Record<string, unknown>;
};

type FieldTypeResult = { type: ElicitationFormField['type']; enumValues: unknown[] | undefined };

function getFieldType(prop: JsonSchemaProp): FieldTypeResult {
    const { type } = prop;
    if (type === 'boolean') return { type: 'boolean', enumValues: undefined };
    if (type === 'number' || type === 'integer') return { type: 'number', enumValues: undefined };
    if (type === 'array' && prop.items && Array.isArray(prop.items.enum)) {
        return { type: 'array-enum', enumValues: prop.items.enum };
    }
    if (Array.isArray(prop.enum)) return { type: 'enum', enumValues: prop.enum };
    return { type: 'string', enumValues: undefined };
}

export function parseElicitationSchema(schema: unknown): ElicitationFormField[] {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];

    const schemaRecord = schema as Record<string, unknown>;
    const properties = schemaRecord.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];

    const required = Array.isArray(schemaRecord.required)
        ? schemaRecord.required.filter((v): v is string => typeof v === 'string')
        : [];

    const result: ElicitationFormField[] = [];

    for (const [name, rawProp] of Object.entries(properties as Record<string, unknown>)) {
        if (
            typeof rawProp === 'boolean' ||
            !rawProp ||
            typeof rawProp !== 'object' ||
            Array.isArray(rawProp)
        ) {
            continue;
        }

        const prop = rawProp as JsonSchemaProp;
        const { type, enumValues } = getFieldType(prop);

        const fallbackLabel = makeLabel(name);
        const stepLabel = getXDextoStepLabel(prop) || fallbackLabel;
        const question = (prop.title ? cleanLabel(prop.title) : '') || fallbackLabel;
        const helpText = (prop.description ? cleanLabel(prop.description) : '') || undefined;

        result.push({
            name,
            stepLabel,
            question,
            helpText,
            type,
            required: required.includes(name),
            enumValues,
        });
    }

    return result;
}
