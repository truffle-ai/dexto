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
        .map((word) => {
            if (!word) return '';
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
}

function cleanLabel(value: string): string {
    return value
        .replace(/^\s*\d+\s*[).:-]\s*/g, '')
        .replace(/\s*[:*]\s*$/g, '')
        .trim();
}

function getXDextoStepLabel(prop: Record<string, unknown>): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(prop, 'x-dexto')) return undefined;
    const value = prop['x-dexto'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const stepLabel = (value as Record<string, unknown>).stepLabel;
    if (typeof stepLabel !== 'string') return undefined;
    const cleaned = cleanLabel(stepLabel);
    return cleaned || undefined;
}

export function parseElicitationSchema(schema: unknown): ElicitationFormField[] {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const schemaRecord = schema as Record<string, unknown>;
    const properties = schemaRecord.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];

    const required = Array.isArray(schemaRecord.required)
        ? schemaRecord.required.filter((value): value is string => typeof value === 'string')
        : [];

    const result: ElicitationFormField[] = [];

    for (const [name, rawProp] of Object.entries(properties as Record<string, unknown>)) {
        if (typeof rawProp === 'boolean') continue;
        if (!rawProp || typeof rawProp !== 'object' || Array.isArray(rawProp)) continue;
        const prop = rawProp as Record<string, unknown>;

        let type: ElicitationFormField['type'] = 'string';
        let enumValues: unknown[] | undefined;

        const propType = prop.type;
        if (propType === 'boolean') {
            type = 'boolean';
        } else if (propType === 'number' || propType === 'integer') {
            type = 'number';
        } else if (Array.isArray(prop.enum)) {
            type = 'enum';
            enumValues = prop.enum;
        } else if (
            propType === 'array' &&
            prop.items &&
            typeof prop.items === 'object' &&
            !Array.isArray(prop.items) &&
            Array.isArray((prop.items as Record<string, unknown>).enum)
        ) {
            type = 'array-enum';
            enumValues = (prop.items as Record<string, unknown>).enum as unknown[];
        }

        const fallbackLabel = titleCaseWords(humanizeIdentifier(name)) || name;
        const title = typeof prop.title === 'string' ? cleanLabel(prop.title) : '';
        const description =
            typeof prop.description === 'string' ? cleanLabel(prop.description) : '';

        const stepLabel = getXDextoStepLabel(prop) || fallbackLabel;

        result.push({
            name,
            stepLabel,
            question: title || fallbackLabel,
            helpText: description || undefined,
            type,
            required: required.includes(name),
            enumValues,
        });
    }

    return result;
}
