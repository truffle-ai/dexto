import type { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { ImageInstallCommandOptionsInput } from '../image.js';

export interface ImageCommandRegisterContext {
    program: Command;
}

export function registerImageCommand({ program }: ImageCommandRegisterContext): void {
    // `create-image` SUB-COMMAND (hidden alias for `dexto image create`)
    program
        .command('create-image [name]', { hidden: true })
        .description('Alias for `dexto image create`')
        .action(
            withAnalytics('create-image', async (name?: string) => {
                try {
                    p.intro(chalk.inverse('Create Dexto Image'));

                    // Create the image project structure
                    const { createImage } = await import('../create-image.js');
                    const projectPath = await createImage(name);

                    p.outro(
                        chalk.greenBright(`Dexto image created successfully at ${projectPath}!`)
                    );
                    safeExit('create-image', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto create-image command failed: ${err}`);
                    safeExit('create-image', 1, 'error');
                }
            })
        );

    // `image` SUB-COMMAND
    const imageCommand = program.command('image').description('Manage images');

    imageCommand.addHelpText(
        'after',
        `
Examples:
  $ dexto image create my-image
  $ dexto image install @dexto/image-local
  $ dexto image install @myorg/my-image@1.2.3
  $ dexto image list
  $ dexto image use @myorg/my-image@1.2.3
  $ dexto image remove @myorg/my-image@1.2.3
  $ dexto image doctor
`
    );

    imageCommand
        .command('create [name]')
        .description('Create a Dexto image project (scaffold)')
        .action(
            withAnalytics('image create', async (name?: string) => {
                try {
                    p.intro(chalk.inverse('Create Dexto Image'));

                    // Create the image project structure
                    const { createImage } = await import('../create-image.js');
                    const projectPath = await createImage(name);

                    p.outro(
                        chalk.greenBright(`Dexto image created successfully at ${projectPath}!`)
                    );
                    safeExit('image create', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto image create command failed: ${err}`);
                    safeExit('image create', 1, 'error');
                }
            })
        );

    imageCommand
        .command('install <image>')
        .description('Install an image into the local Dexto image store')
        .option('--force', 'Force reinstall if already installed')
        .option('--no-activate', 'Do not set as the active version')
        .addHelpText(
            'after',
            `
Examples:
  $ dexto image install @dexto/image-local
  $ dexto image install @myorg/my-image@1.2.3
  $ dexto image install ./my-image-1.0.0.tgz
`
        )
        .action(
            withAnalytics(
                'image install',
                async (image: string, options: Omit<ImageInstallCommandOptionsInput, 'image'>) => {
                    try {
                        const { handleImageInstallCommand } = await import('../image.js');
                        await handleImageInstallCommand({ ...options, image });
                        safeExit('image install', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto image install command failed: ${err}`);
                        safeExit('image install', 1, 'error');
                    }
                }
            )
        );

    imageCommand
        .command('list')
        .description('List installed images')
        .action(
            withAnalytics('image list', async () => {
                try {
                    const { handleImageListCommand } = await import('../image.js');
                    await handleImageListCommand();
                    safeExit('image list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto image list command failed: ${err}`);
                    safeExit('image list', 1, 'error');
                }
            })
        );

    imageCommand
        .command('use <image>')
        .description('Set the active version for an installed image (image@version)')
        .action(
            withAnalytics('image use', async (image: string) => {
                try {
                    const { handleImageUseCommand } = await import('../image.js');
                    await handleImageUseCommand({ image });
                    safeExit('image use', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto image use command failed: ${err}`);
                    safeExit('image use', 1, 'error');
                }
            })
        );

    imageCommand
        .command('remove <image>')
        .description('Remove an image from the store (image or image@version)')
        .action(
            withAnalytics('image remove', async (image: string) => {
                try {
                    const { handleImageRemoveCommand } = await import('../image.js');
                    await handleImageRemoveCommand({ image });
                    safeExit('image remove', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto image remove command failed: ${err}`);
                    safeExit('image remove', 1, 'error');
                }
            })
        );

    imageCommand
        .command('doctor')
        .description('Print image store diagnostics')
        .action(
            withAnalytics('image doctor', async () => {
                try {
                    const { handleImageDoctorCommand } = await import('../image.js');
                    await handleImageDoctorCommand();
                    safeExit('image doctor', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto image doctor command failed: ${err}`);
                    safeExit('image doctor', 1, 'error');
                }
            })
        );
}
