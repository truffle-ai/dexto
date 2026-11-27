import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import inventory from '../../../cli-mcp-parity.json' with { type: 'json' };
import { builtCloudCommands } from './host.js';

it('keeps the vendored parity inventory identical to the CLI inventory', () => {
    expect(readFileSync(new URL('./__parity__/cli-mcp-parity.json', import.meta.url), 'utf8')).toBe(
        readFileSync(new URL('../../../cli-mcp-parity.json', import.meta.url), 'utf8')
    );
});

const catalog = z
    .object({
        tools: z.array(
            z.object({
                name: z.string(),
                inputSchema: z
                    .object({ properties: z.record(z.string(), z.unknown()).optional() })
                    .passthrough(),
            })
        ),
        chatGetUsage: z.boolean(),
    })
    .parse(
        JSON.parse(readFileSync(new URL('./__parity__/mcp-tools.txt', import.meta.url), 'utf8'))
    );

// Approved S0 debt ceiling. Remove closed exceptions; never extend this baseline.
const approvedExceptions = new Set(
    `cloud-api
cloud-automations-rotate-secret
cloud-data-deletions-create
cloud-fetch
cloud-functions-deploy
models-list
cloud-sandboxes-create
cloud-sandboxes-delete
cloud-sandboxes-exec
cloud-sandboxes-export
cloud-sandboxes-import
cloud-sandboxes-pause
cloud-sandboxes-rm
cloud-sandboxes-start
cloud-sandboxes-write
cloud-secrets-create
cloud-secrets-delete
cloud-secrets-update
cloud-sites-deploy`.split('\n')
);

// Tools with only generic passthrough reachability are debt, not coverage.
const approvedPassthroughOnly = `dexto_app_open
dexto_app_request_access
dexto_app_runtime
dexto_cos_report
dexto_gigs_finding
dexto_gigs_posting
dexto_open
dexto_share`.split('\n');

/** A passthrough-only tool says why it has no command; one waiting for a command is pendingCli. */
const passthroughOnlySchema = z.array(
    z.object({ tool: z.string(), reason: z.string().trim().min(1) }).strict()
);
const pendingCliSchema = z.array(
    z
        .object({
            tool: z.string(),
            issue: z.string().regex(/^DEXTO-\d+$/),
            reason: z.string().trim().min(1),
        })
        .strict()
);
const passthroughOnly = passthroughOnlySchema
    .parse(inventory.passthroughOnly)
    .map(({ tool }) => tool);

const approvedLocalOnly = [
    'accounts list',
    'accounts remove',
    'accounts use',
    'chat local',
    'chat move',
    'chat watch',
    'cloud projects use',
    'import list',
    'login',
    'logout',
    'whoami',
];

describe('CLI and MCP capability parity', () => {
    it('accounts for every registered verb exactly once', () => {
        expect(inventory.localOnly.map((entry) => entry.command).sort()).toEqual(
            [...approvedLocalOnly].sort()
        );
        expect(inventory.localOnly.every((entry) => entry.registry === 'cloud')).toBe(true);
        // Held commands keep their inventory entries, so releasing one changes nothing here.
        const registered = builtCloudCommands('/unused/parity-accounts', async () => {
            throw new Error('Parity inspection must not sign in.');
        }).map((command) => command.path.join(' '));
        const inventoried = [
            ...Object.keys(inventory.commands),
            ...Object.keys(inventory.actionCommands),
            ...inventory.localOnly
                .filter((entry) => entry.registry === 'cloud')
                .map((entry) => entry.command),
            ...inventory.exceptions.flatMap((gap) => gap.commands),
        ];
        expect(new Set(inventoried).size).toBe(inventoried.length);
        expect(
            inventoried.sort(),
            'add the verb to commands/actionCommands/localOnly/exceptions in cli-mcp-parity.json and vendor it to dexto-cloudflare'
        ).toEqual(registered.sort());
    });

    it('keeps a tool only some of whose actions have verbs in passthrough-only debt', () => {
        const mapped = z
            .record(z.string(), z.object({ tool: z.string(), actions: z.array(z.string()).min(1) }))
            .parse(inventory.actionCommands);
        for (const [command, { tool }] of Object.entries(mapped)) {
            expect(passthroughOnly, command).toContain(tool);
            expect(Object.keys(inventory.commands), command).not.toContain(command);
        }
    });

    it('partitions vendored tools into real coverage and passthrough-only debt', () => {
        expect([...passthroughOnly].sort()).toEqual([...approvedPassthroughOnly].sort());
        expect(new Set(passthroughOnly).size).toBe(passthroughOnly.length);
        const direct = Object.entries(inventory.commands)
            .filter(([command]) => command !== 'workspace call')
            .flatMap(([, tools]) => tools);
        expect(passthroughOnly.filter((tool) => direct.includes(tool))).toEqual([]);
        // Discovery inspects tools/list; generic workspace call is not coverage.
        expect(
            Object.entries(inventory.commands)
                .filter(([, mapped]) => mapped.length === 0)
                .map(([command]) => command)
                .sort()
        ).toEqual(['workspace call', 'workspace describe', 'workspace tools']);
        expect(inventory.commands['chat outputs']).toEqual(['dexto_chat_outputs_list']);
        const pending = pendingCliSchema.parse(inventory.pendingCli).map((entry) => entry.tool);
        expect(new Set(pending).size).toBe(pending.length);
        expect(
            pending.filter((tool) => direct.includes(tool) || passthroughOnly.includes(tool))
        ).toEqual([]);
        expect([...new Set(direct.concat(passthroughOnly, pending))].sort()).toEqual(
            catalog.tools.map((tool) => tool.name).sort()
        );
    });

    it('refuses a passthrough-only or pending tool without a reason', () => {
        expect(passthroughOnlySchema.safeParse(['dexto_open']).success).toBe(false);
        expect(passthroughOnlySchema.safeParse([{ tool: 'dexto_open' }]).success).toBe(false);
        expect(passthroughOnlySchema.safeParse([{ tool: 'dexto_open', reason: ' ' }]).success).toBe(
            false
        );
        expect(pendingCliSchema.safeParse([{ tool: 'dexto_open', issue: 'DEXTO-1' }]).success).toBe(
            false
        );
        expect(
            pendingCliSchema.safeParse([{ tool: 'dexto_open', reason: 'Follows upstream.' }])
                .success
        ).toBe(false);
    });

    it('rejects stale or untracked exceptions', () => {
        const names = inventory.exceptions.map((gap) => gap.name);
        expect([...names].sort()).toEqual([...approvedExceptions].sort());
        expect(new Set(names).size).toBe(names.length);
        for (const gap of inventory.exceptions) {
            expect(gap.issue).toMatch(/^DEXTO-\d+$/);
            expect(gap.reason.length).toBeGreaterThan(0);
            expect(['knownChat', 'additionalRemote']).toContain(gap.group);
            expect(gap.commands.map((command) => command.replaceAll(' ', '-'))).toEqual(
                gap.group === 'knownChat' ? [] : [gap.name]
            );
            const closed =
                gap.name === 'chat-get-usage'
                    ? catalog.chatGetUsage
                    : z
                          .object({
                              closesWhen: z.array(
                                  z.object({ tool: z.string(), inputs: z.array(z.string()) })
                              ),
                          })
                          .parse(gap)
                          .closesWhen.every((probe) => {
                              const tool = catalog.tools.find(
                                  (candidate) => candidate.name === probe.tool
                              );
                              return (
                                  tool !== undefined &&
                                  probe.inputs.every((field) =>
                                      Object.hasOwn(
                                          z
                                              .object({
                                                  properties: z
                                                      .record(z.string(), z.unknown())
                                                      .default({}),
                                              })
                                              .parse(tool.inputSchema).properties,
                                          field
                                      )
                                  )
                              );
                          });
            expect(closed, `Stale exception ${gap.name}: remove it from both inventories.`).toBe(
                false
            );
        }
    });
});
