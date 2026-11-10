import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import inventory from '../../../cli-mcp-parity.json' with { type: 'json' };
import { cloudCommands } from './host.js';

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
const approvedPassthroughOnly = `dexto_agents_list
dexto_app_data_remove
dexto_app_deploy
dexto_app_deployment_verify
dexto_app_get
dexto_app_open
dexto_app_request_access
dexto_app_runtime
dexto_application_create
dexto_application_deploy
dexto_application_get
dexto_application_history
dexto_application_insights
dexto_application_install
dexto_application_logs
dexto_application_operations_list
dexto_application_plugin_export
dexto_application_purge
dexto_application_release_delete
dexto_application_release_get
dexto_application_resume
dexto_application_retire
dexto_application_rollback
dexto_application_suspend
dexto_application_usage
dexto_application_variables_list
dexto_applications_list
dexto_apps_list
dexto_apps_uninstalled_list
dexto_autobot_chat_start
dexto_autobot_get
dexto_autobot_input_submit
dexto_autobot_publish
dexto_autobot_save
dexto_autobot_status
dexto_autobots_list
dexto_automation_create
dexto_automation_delete
dexto_automation_get
dexto_automation_recipe_install
dexto_automation_recipes_list
dexto_automation_trigger
dexto_automation_update
dexto_automations_list
dexto_capabilities_search
dexto_channel_get
dexto_channel_send
dexto_channels_list
dexto_chat_cancel
dexto_chat_computer
dexto_chat_continue
dexto_chat_get
dexto_chat_list
dexto_chat_models
dexto_contacts_block
dexto_contacts_connect
dexto_contacts_invite_link
dexto_contacts_people_list
dexto_contacts_people_search
dexto_contacts_remove
dexto_contacts_request_answer
dexto_contacts_requests_list
dexto_contacts_unblock
dexto_cos_report
dexto_credits_balance
dexto_credits_topup
dexto_direct_conversation_get
dexto_direct_conversations_list
dexto_direct_message_send
dexto_docs_read
dexto_docs_search
dexto_feedback_submit
dexto_function_credential_configure
dexto_function_deploy
dexto_function_get
dexto_function_invoke
dexto_function_plan
dexto_function_promote
dexto_function_secret_delete
dexto_functions_list
dexto_gigs_finding
dexto_gigs_posting
dexto_gpu_process_get
dexto_gpu_process_logs
dexto_gpu_process_start
dexto_gpu_process_stop
dexto_gpu_profiles_list
dexto_gpu_sandbox_delete
dexto_gpu_sandbox_get
dexto_gpu_sandbox_provision
dexto_gpu_sandbox_start
dexto_gpu_sandbox_stop
dexto_gpu_sandboxes_list
dexto_marketplace_get
dexto_marketplace_install
dexto_marketplace_preview
dexto_marketplace_publish
dexto_marketplace_search
dexto_marketplace_uninstall
dexto_marketplace_unpublish
dexto_mcp_server_import
dexto_network_send
dexto_network_thread_get
dexto_network_thread_mark_read
dexto_network_threads_list
dexto_notification_get
dexto_notifications_list
dexto_notifications_mark_read
dexto_open
dexto_project_import
dexto_share
dexto_share_access
dexto_share_received
dexto_site_collections_list
dexto_site_get
dexto_site_promote
dexto_site_record_create
dexto_site_record_delete
dexto_site_record_get
dexto_site_record_update
dexto_site_records_list
dexto_skill_create
dexto_skill_delete
dexto_skill_file_get
dexto_skill_get
dexto_skill_install
dexto_skill_publish
dexto_skill_restore
dexto_skill_uninstall
dexto_skill_update
dexto_skill_validate
dexto_skill_versions`.split('\n');

const approvedLocalOnly = [
    'accounts list',
    'accounts remove',
    'accounts use',
    'chat local',
    'cloud projects use',
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
        expect(
            inventoried.sort(),
            'add the verb to commands/localOnly/exceptions in cli-mcp-parity.json and vendor it to dexto-cloudflare'
        ).toEqual(registered.sort());
    });

    it('partitions vendored tools into real coverage and passthrough-only debt', () => {
        expect([...inventory.passthroughOnly].sort()).toEqual([...approvedPassthroughOnly].sort());
        expect(new Set(inventory.passthroughOnly).size).toBe(inventory.passthroughOnly.length);
        const direct = Object.entries(inventory.commands)
            .filter(([command]) => command !== 'workspace call')
            .flatMap(([, tools]) => tools);
        expect(inventory.passthroughOnly.filter((tool) => direct.includes(tool))).toEqual([]);
        // Discovery inspects tools/list; generic workspace call is not coverage.
        expect(
            Object.entries(inventory.commands)
                .filter(([, mapped]) => mapped.length === 0)
                .map(([command]) => command)
                .sort()
        ).toEqual(['workspace call', 'workspace describe', 'workspace tools']);
        expect(inventory.commands['chat outputs']).toEqual(['dexto_chat_outputs_list']);
        const pending = z
            .array(z.object({ tool: z.string() }))
            .parse(inventory.pendingCli)
            .map((entry) => entry.tool);
        expect(
            pending.filter(
                (tool) => direct.includes(tool) || inventory.passthroughOnly.includes(tool)
            )
        ).toEqual([]);
        expect([...new Set(direct.concat(inventory.passthroughOnly, pending))].sort()).toEqual(
            catalog.tools.map((tool) => tool.name).sort()
        );
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
