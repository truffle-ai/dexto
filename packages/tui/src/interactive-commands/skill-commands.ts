/**
 * Skill Commands Module
 *
 * Skills are first-class agent capabilities backed by SkillManager. They are
 * listed/read separately from slash prompt commands.
 */

import type { CommandContext, CommandDefinition, CommandHandlerResult } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import type { TuiAgentBackend } from '../agent-backend.js';

export const skillCommands: CommandDefinition[] = [
    {
        name: 'skills',
        description: 'List available skills, or read one skill by id',
        usage: '/skills [skill-id]',
        category: 'Skill Management',
        handler: async (
            args: string[],
            agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const skillManager = agent.skillManager;
            if (!skillManager) {
                return formatForInkCli('⚠️  Skills are not available for this chat target.');
            }

            const skillId = args[0];

            try {
                if (skillId) {
                    const skill = await skillManager.get(skillId);
                    if (!skill) {
                        return formatForInkCli(`⚠️  Skill '${skillId}' not found`);
                    }

                    const outputLines = [`\n🧩 ${skill.displayName}`, `ID: ${skill.id}`];
                    if (skill.description) {
                        outputLines.push(`Description: ${skill.description}`);
                    }
                    outputLines.push('', skill.instructions);
                    return formatForInkCli(outputLines.join('\n'));
                }

                const skills = await skillManager.list();
                if (skills.length === 0) {
                    return formatForInkCli('\n⚠️  No skills available');
                }

                const outputLines = ['\n🧩 Available Skills:\n'];
                for (const skill of skills) {
                    const desc = skill.description ? ` - ${skill.description}` : '';
                    outputLines.push(`  ${skill.displayName} (${skill.id})${desc}`);
                }
                outputLines.push('', `Total: ${skills.length} skills`);
                return formatForInkCli(outputLines.join('\n'));
            } catch (error) {
                const errorMsg = `Error loading skills: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
];
