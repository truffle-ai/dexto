import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '../../../cli-mcp-parity.json' with { type: 'json' };
import { cloudCommands } from './host.js';

const catalog: { tools: { name: string; inputSchema: unknown }[]; chatGetUsage: boolean } =
    JSON.parse(readFileSync(new URL('./__parity__/mcp-tools.txt', import.meta.url), 'utf8'));

// Approved S0 debt ceiling. Remove closed exceptions; never extend this baseline.
const approvedExceptions = new Set(
    `billing
cloud-agents-approve
cloud-agents-archive
cloud-agents-chat
cloud-agents-create
cloud-agents-reject
cloud-agents-get
cloud-agents-list
cloud-agents-messages
cloud-agents-runs-get
cloud-agents-runs-list
cloud-agents-runs-steps
cloud-agents-sessions-cancel
cloud-agents-sessions-delete
cloud-agents-sessions-get
cloud-agents-sessions-list
cloud-agents-update
cloud-api
cloud-automations-create
cloud-automations-delete
cloud-automations-firings
cloud-automations-get
cloud-automations-list
cloud-automations-pause
cloud-automations-resume
cloud-automations-rotate-secret
cloud-automations-run
cloud-automations-update
cloud-data-deletions-create
cloud-data-deletions-get
cloud-data-deletions-list
cloud-fetch
cloud-files-delete
cloud-files-download
cloud-files-get
cloud-files-list
cloud-files-upload
cloud-files-url
cloud-functions-deploy
cloud-functions-list
cloud-models-get
cloud-models-list
cloud-models-run
cloud-models-runs-get
cloud-models-runs-list
cloud-projects-create
cloud-projects-list
cloud-sandboxes-cat
cloud-sandboxes-create
cloud-sandboxes-delete
cloud-sandboxes-exec
cloud-sandboxes-export
cloud-sandboxes-get
cloud-sandboxes-import
cloud-sandboxes-list
cloud-sandboxes-ls
cloud-sandboxes-pause
cloud-sandboxes-rm
cloud-sandboxes-start
cloud-sandboxes-write
cloud-secrets-create
cloud-secrets-delete
cloud-secrets-get
cloud-secrets-list
cloud-secrets-update
cloud-sites-deploy
cloud-sites-list
span-list
trace-list
trace-view
chat-artifacts
chat-list-status
chat-wait-follow
chat-start-computer-browser
chat-get-usage`.split('\n')
);

describe('CLI and MCP capability parity', () => {
    it('accounts for every registered verb exactly once', () => {
        const registered = cloudCommands('/unused/parity-accounts', async () => {
            throw new Error('Parity inspection must not sign in.');
        }).map((command) => command.path.join(' '));
        const inventoried = [
            ...Object.keys(inventory.commands),
            ...inventory.localOnly
                .filter((entry) => entry.registry === 'cloud')
                .map((entry) => entry.command),
            ...inventory.exceptions.flatMap((gap) => gap.commands),
        ];
        expect(new Set(inventoried).size).toBe(inventoried.length);
        expect(inventoried.sort()).toEqual(registered.sort());
    });

    it('covers every vendored MCP tool and rejects removed tool references', () => {
        // These two commands inspect tools/list rather than invoking a tool.
        expect(
            Object.entries(inventory.commands)
                .filter(([, mapped]) => mapped.length === 0)
                .map(([command]) => command)
                .sort()
        ).toEqual(['workspace describe', 'workspace tools']);
        expect([...new Set(Object.values(inventory.commands).flat())].sort()).toEqual(
            catalog.tools.map((tool) => tool.name).sort()
        );
    });

    it('rejects stale or untracked exceptions', () => {
        const names = inventory.exceptions.map((gap) => gap.name);
        expect(new Set(names).size).toBe(names.length);
        for (const gap of inventory.exceptions) {
            expect(
                approvedExceptions.has(gap.name),
                `New exception ${gap.name} exceeds the S0 debt ceiling.`
            ).toBe(true);
            expect(gap.issue).toBe('DEXTO-2479');
            expect(gap.reason.length).toBeGreaterThan(0);
            expect(['knownChat', 'additionalRemote']).toContain(gap.group);
            expect(gap.commands.map((command) => command.replaceAll(' ', '-'))).toEqual(
                gap.group === 'knownChat' ? [] : [gap.name]
            );
            const closed =
                gap.name === 'chat-get-usage'
                    ? catalog.chatGetUsage
                    : gap.closesWhen.every((probe) => {
                          const tool = catalog.tools.find(
                              (candidate) => candidate.name === probe.tool
                          );
                          return (
                              tool !== undefined &&
                              probe.inputs.every((field) =>
                                  JSON.stringify(tool.inputSchema).includes(`"${field}"`)
                              )
                          );
                      });
            expect(closed, `Stale exception ${gap.name}: remove it from both inventories.`).toBe(
                false
            );
        }
    });
});
