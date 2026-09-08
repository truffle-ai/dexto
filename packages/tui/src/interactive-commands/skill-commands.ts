/**
 * Skill Commands Module
 *
 * Skills are first-class agent capabilities backed by the Core Skills contract. They are
 * listed/read separately from slash prompt commands.
 */

import type { CommandContext, CommandDefinition, CommandHandlerResult } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import type { TuiAgentBackend } from '../agent-backend.js';

export const skillCommands: CommandDefinition[] = [
    {
        name: 'skills',
        description: 'List available skills, or read one skill by exact name',
        usage: '/skills [skill-name]',
        category: 'Skill Management',
        handler: async (
            args: string[],
            agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<CommandHandlerResult> => {
            const skills = agent.skills;
            if (!skills) {
                return formatForInkCli('⚠️  Skills are not available for this chat target.');
            }

            const skillName = args[0];

            try {
                if (skillName) {
                    const skill = await skills.load(skillName);
                    if (!skill) {
                        return formatForInkCli(`⚠️  Skill '${skillName}' not found`);
                    }

                    const outputLines = [`\n🧩 ${skill.name}`, '', skill.instructions];
                    return formatForInkCli(outputLines.join('\n'));
                }

                const summaries = await skills.list();
                if (summaries.length === 0) {
                    return formatForInkCli('\n⚠️  No skills available');
                }

                const outputLines = ['\n🧩 Available Skills:\n'];
                for (const skill of summaries) {
                    outputLines.push(`  ${skill.name} - ${skill.description}`);
                }
                outputLines.push('', `Total: ${summaries.length} skills`);
                return formatForInkCli(outputLines.join('\n'));
            } catch (error) {
                const errorMsg = `Error loading skills: ${error instanceof Error ? error.message : String(error)}`;
                agent.logger.error(errorMsg);
                return formatForInkCli(`❌ ${errorMsg}`);
            }
        },
    },
];
