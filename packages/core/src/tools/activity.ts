/** Opaque grouping key owned by the tool package or host. */
export type ToolActivityCategory = string;

/**
 * Tool-owned transcript copy and aggregation grammar.
 *
 * The semantic call description remains model-authored. This metadata provides deterministic
 * lifecycle copy and lets UIs summarize first-party calls without inspecting tool ids or args.
 */
export type ToolActivityPresentation = {
    category: ToolActivityCategory;
    label: {
        running: string;
        completed: string;
    };
    summary: {
        verb: string;
        singular: string;
        plural: string;
    };
};

function activity(
    category: ToolActivityCategory,
    running: string,
    completed: string,
    verb: string,
    singular: string,
    plural: string
): ToolActivityPresentation {
    return {
        category,
        label: { running, completed },
        summary: { verb, singular, plural },
    };
}

/** Shared activity declarations for first-party tools with identical transcript semantics. */
export const TOOL_ACTIVITY = {
    runCommand: activity(
        'command',
        'Running command',
        'Ran command',
        'Ran',
        'a command',
        'commands'
    ),
    checkCommandOutput: activity(
        'command-output',
        'Checking command output',
        'Checked command output',
        'Checked',
        'command output',
        'command outputs'
    ),
    stopProcess: activity(
        'process',
        'Stopping process',
        'Stopped process',
        'Stopped',
        'a process',
        'processes'
    ),
    readFile: activity('file-read', 'Reading file', 'Read file', 'Read', 'a file', 'files'),
    writeFile: activity('file-write', 'Writing file', 'Wrote file', 'Wrote', 'a file', 'files'),
    createFile: activity(
        'file-create',
        'Creating file',
        'Created file',
        'Created',
        'a file',
        'files'
    ),
    editFile: activity('file-edit', 'Editing file', 'Edited file', 'Edited', 'a file', 'files'),
    searchFiles: activity(
        'file-search',
        'Searching files',
        'Searched files',
        'Ran',
        'a file search',
        'file searches'
    ),
    searchWeb: activity(
        'web-search',
        'Searching the web',
        'Searched the web',
        'Ran',
        'a web search',
        'web searches'
    ),
    searchCode: activity(
        'code-search',
        'Searching code',
        'Searched code',
        'Ran',
        'a code search',
        'code searches'
    ),
    useSkill: activity('skill', 'Using skill', 'Used skill', 'Used', 'a skill', 'skills'),
    readSkill: activity('skill-read', 'Reading skill', 'Read skill', 'Read', 'a skill', 'skills'),
    createSkill: activity(
        'skill-create',
        'Creating skill',
        'Created skill',
        'Created',
        'a skill',
        'skills'
    ),
    updateSkill: activity(
        'skill-update',
        'Updating skill',
        'Updated skill',
        'Updated',
        'a skill',
        'skills'
    ),
    refreshSkill: activity(
        'skill-refresh',
        'Refreshing skill',
        'Refreshed skill',
        'Refreshed',
        'a skill',
        'skills'
    ),
    searchSkills: activity(
        'skill-search',
        'Searching skills',
        'Searched skills',
        'Ran',
        'a skill search',
        'skill searches'
    ),
    readResource: activity(
        'resource',
        'Reading resource',
        'Read resource',
        'Read',
        'a resource',
        'resources'
    ),
    listResources: activity(
        'resource-list',
        'Listing resources',
        'Listed resources',
        'Listed',
        'a resource catalog',
        'resource catalogs'
    ),
    requestHttp: activity(
        'http-request',
        'Sending request',
        'Sent request',
        'Sent',
        'a request',
        'requests'
    ),
    delegate: activity(
        'delegation',
        'Delegating task',
        'Delegated task',
        'Delegated',
        'a task',
        'tasks'
    ),
    runAgent: activity('agent', 'Running agent', 'Ran agent', 'Ran', 'an agent', 'agents'),
    checkTask: activity(
        'task-check',
        'Checking task',
        'Checked task',
        'Checked',
        'a task',
        'tasks'
    ),
    listTasks: activity(
        'task-list',
        'Listing tasks',
        'Listed tasks',
        'Listed',
        'a task collection',
        'task collections'
    ),
    updateTasks: activity(
        'task',
        'Updating tasks',
        'Updated tasks',
        'Updated',
        'a task list',
        'task lists'
    ),
    createPlan: activity(
        'plan-create',
        'Creating plan',
        'Created plan',
        'Created',
        'a plan',
        'plans'
    ),
    readPlan: activity('plan-read', 'Reading plan', 'Read plan', 'Read', 'a plan', 'plans'),
    reviewPlan: activity(
        'plan-review',
        'Reviewing plan',
        'Reviewed plan',
        'Reviewed',
        'a plan',
        'plans'
    ),
    updatePlan: activity(
        'plan-update',
        'Updating plan',
        'Updated plan',
        'Updated',
        'a plan',
        'plans'
    ),
    listMemories: activity(
        'memory-list',
        'Listing memories',
        'Listed memories',
        'Listed',
        'a memory collection',
        'memory collections'
    ),
    readMemory: activity(
        'memory-read',
        'Reading memory',
        'Read memory',
        'Read',
        'a memory',
        'memories'
    ),
    createMemory: activity(
        'memory-create',
        'Creating memory',
        'Created memory',
        'Created',
        'a memory',
        'memories'
    ),
    updateMemory: activity(
        'memory-update',
        'Updating memory',
        'Updated memory',
        'Updated',
        'a memory',
        'memories'
    ),
    deleteMemory: activity(
        'memory-delete',
        'Deleting memory',
        'Deleted memory',
        'Deleted',
        'a memory',
        'memories'
    ),
    searchHistory: activity(
        'history-search',
        'Searching history',
        'Searched history',
        'Ran',
        'a history search',
        'history searches'
    ),
    listSchedules: activity(
        'schedule-list',
        'Listing schedules',
        'Listed schedules',
        'Listed',
        'a schedule collection',
        'schedule collections'
    ),
    readSchedule: activity(
        'schedule-read',
        'Reading schedule',
        'Read schedule',
        'Read',
        'a schedule',
        'schedules'
    ),
    readScheduleHistory: activity(
        'schedule-history',
        'Reading schedule history',
        'Read schedule history',
        'Read',
        'a schedule history',
        'schedule histories'
    ),
    createSchedule: activity(
        'schedule-create',
        'Creating schedule',
        'Created schedule',
        'Created',
        'a schedule',
        'schedules'
    ),
    updateSchedule: activity(
        'schedule-update',
        'Updating schedule',
        'Updated schedule',
        'Updated',
        'a schedule',
        'schedules'
    ),
    deleteSchedule: activity(
        'schedule-delete',
        'Deleting schedule',
        'Deleted schedule',
        'Deleted',
        'a schedule',
        'schedules'
    ),
    triggerSchedule: activity(
        'schedule-trigger',
        'Running schedule',
        'Ran schedule',
        'Ran',
        'a schedule',
        'schedules'
    ),
    inspectLogs: activity(
        'logs',
        'Inspecting logs',
        'Inspected logs',
        'Inspected',
        'a log set',
        'log sets'
    ),
    wait: activity('wait', 'Waiting', 'Waited', 'Waited for', 'an event', 'events'),
    pause: activity('pause', 'Waiting', 'Waited', 'Waited for', 'a period', 'periods'),
    askUser: activity(
        'user-input',
        'Waiting for input',
        'Received input',
        'Requested',
        'user input',
        'user inputs'
    ),
    discoverTools: activity(
        'tool-discovery',
        'Finding tools',
        'Found tools',
        'Ran',
        'a tool search',
        'tool searches'
    ),
} as const satisfies Record<string, ToolActivityPresentation>;
