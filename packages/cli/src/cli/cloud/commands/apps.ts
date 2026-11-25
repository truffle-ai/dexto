// `apps`: inspect the Dexto Apps your sign-in reaches and the retained data of Apps you
// uninstalled, read-only, over Dexto's typed App tools. Running, opening, installing and removing
// data stay with those tools (`workspace <app> <operation>` runs App actions).

import { z } from 'zod';
import { argument, type Command } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SCOPES = ['apps:read'] as const;

const AppSchema = z
    .object({
        actionsAvailable: z.array(z.string()),
        delivery: z.string(),
        id: z.string(),
        title: z.string(),
    })
    .passthrough();
const ListSchema = z.object({ apps: z.array(AppSchema) }).passthrough();
const ActionSchema = z
    .object({ execution: z.string(), level: z.string(), title: z.string(), toolName: z.string() })
    .passthrough();
const DetailSchema = z
    .object({
        actions: z.array(ActionSchema),
        app: z
            .object({ id: z.string(), launchUrl: z.string().optional(), title: z.string() })
            .passthrough(),
    })
    .passthrough();
const RetainedSchema = z
    .object({ appId: z.string(), dataDeletedOn: z.string(), title: z.string() })
    .passthrough();
const UninstalledSchema = z.object({ apps: z.array(RetainedSchema) }).passthrough();

type App = z.output<typeof AppSchema>;
type Action = z.output<typeof ActionSchema>;
type Retained = z.output<typeof RetainedSchema>;

const APP_COLUMNS: readonly Column<App>[] = [
    { header: 'id', value: (app) => app.id },
    { header: 'title', value: (app) => app.title },
    { header: 'delivery', value: (app) => app.delivery },
    { header: 'actions', value: (app) => String(app.actionsAvailable.length) },
];
const ACTION_COLUMNS: readonly Column<Action>[] = [
    { header: 'action', value: (action) => action.toolName },
    { header: 'title', value: (action) => action.title },
    { header: 'execution', value: (action) => action.execution },
    { header: 'level', value: (action) => action.level },
];
const RETAINED_COLUMNS: readonly Column<Retained>[] = [
    { header: 'id', value: (app) => app.appId },
    { header: 'title', value: (app) => app.title },
    { header: 'data deleted on', value: (app) => app.dataDeletedOn },
];

const list: Command = {
    path: ['apps', 'list'],
    summary: 'List the Dexto Apps available to you in this organization.',
    examples: ['dexto apps list --json'],
    async run(context) {
        await requireLoginScopes(context, SCOPES);
        const result = ListSchema.parse(await queryWorkspaceTool(context, 'dexto_apps_list', {}));
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.apps }, APP_COLUMNS);
    },
};

const get: Command = {
    arguments: '<app_id>',
    path: ['apps', 'get'],
    summary: "Show one available App: its actions' input schemas, execution and launch URL.",
    examples: ['dexto apps get "$APP_ID" --json'],
    async run(context, input) {
        const appId = argument(input, 0, 'app_id');
        await requireLoginScopes(context, SCOPES);
        const result = DetailSchema.parse(
            await queryWorkspaceTool(context, 'dexto_app_get', { appId })
        );
        // JSON keeps the tool's whole response, input schemas included; people get the App and
        // a table of its actions.
        if (context.output.json) return context.output.record(result);
        context.output.record(result.app);
        if (result.actions.length > 0)
            context.output.list({ data: result.actions }, ACTION_COLUMNS);
    },
};

const uninstalled: Command = {
    path: ['apps', 'uninstalled'],
    summary: 'List Apps you uninstalled whose data Dexto still keeps, and when it is deleted.',
    examples: ['dexto apps uninstalled --json'],
    async run(context) {
        await requireLoginScopes(context, SCOPES);
        const result = UninstalledSchema.parse(
            await queryWorkspaceTool(context, 'dexto_apps_uninstalled_list', {})
        );
        if (context.output.json) return context.output.record(result);
        context.output.list({ data: result.apps }, RETAINED_COLUMNS);
    },
};

export const appCommands: readonly Command[] = [list, get, uninstalled];
