import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    validateProjectName,
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForApp,
    createTsconfigForImage,
    createTsconfigForProject,
    installDependencies,
    createEnvExample,
    ensureDirectory,
    pinDextoPackageIfUnversioned,
} from './scaffolding-utils.js';

// Mock dependencies
vi.mock('fs-extra', () => {
    const mock = {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        readFile: vi.fn(),
        writeJSON: vi.fn(),
        ensureDir: vi.fn(),
    };
    return {
        default: mock,
        ...mock,
    };
});

vi.mock('@clack/prompts', () => ({
    text: vi.fn(),
    isCancel: vi.fn(),
    cancel: vi.fn(),
}));

vi.mock('./execute.js', () => ({
    executeWithTimeout: vi.fn(),
}));

const fs = await import('fs-extra');
const p = await import('@clack/prompts');
const { executeWithTimeout } = await import('./execute.js');

describe('scaffolding-utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('pinDextoPackageIfUnversioned', () => {
        it('pins @dexto packages when unversioned', () => {
            expect(pinDextoPackageIfUnversioned('@dexto/image-local', '^1.2.3')).toBe(
                '@dexto/image-local@^1.2.3'
            );
        });

        it('supports workspace protocol pinning', () => {
            expect(pinDextoPackageIfUnversioned('@dexto/image-local', 'workspace:*')).toBe(
                '@dexto/image-local@workspace:*'
            );
        });

        it('does not pin when a version is already present', () => {
            expect(pinDextoPackageIfUnversioned('@dexto/image-local@1.0.0', '^1.2.3')).toBe(
                '@dexto/image-local@1.0.0'
            );
        });

        it('does not pin non-@dexto packages', () => {
            expect(pinDextoPackageIfUnversioned('@myorg/image-base', '^1.2.3')).toBe(
                '@myorg/image-base'
            );
        });

        it('does not pin local specifiers', () => {
            expect(pinDextoPackageIfUnversioned('./local/path', '^1.2.3')).toBe('./local/path');
        });
    });

    describe('validateProjectName', () => {
        it('should accept valid project names', () => {
            expect(validateProjectName('my-project')).toBeUndefined();
            expect(validateProjectName('myProject')).toBeUndefined();
            expect(validateProjectName('my_project')).toBeUndefined();
            expect(validateProjectName('Project123')).toBeUndefined();
            expect(validateProjectName('a')).toBeUndefined();
        });

        it('should reject names starting with numbers', () => {
            const error = validateProjectName('123-project');
            expect(error).toBeDefined();
            expect(error).toContain('Must start with a letter');
        });

        it('should reject names starting with special characters', () => {
            const error = validateProjectName('-my-project');
            expect(error).toBeDefined();
            expect(error).toContain('Must start with a letter');
        });

        it('should reject names with invalid characters', () => {
            const error = validateProjectName('my@project');
            expect(error).toBeDefined();
            expect(error).toContain('Must start with a letter');
        });

        it('should reject empty names', () => {
            const error = validateProjectName('');
            expect(error).toBeDefined();
        });
    });

    describe('promptForProjectName', () => {
        it('should return valid project name on first attempt', async () => {
            vi.mocked(p.text).mockResolvedValue('valid-project');

            const result = await promptForProjectName('default-name', 'Enter name');

            expect(result).toBe('valid-project');
            expect(p.text).toHaveBeenCalledTimes(1);
        });

        it('should exit on cancel', async () => {
            const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
                throw new Error('process.exit called');
            });
            vi.mocked(p.text).mockResolvedValue(Symbol('cancel') as any);
            vi.mocked(p.isCancel).mockReturnValue(true);

            await expect(promptForProjectName()).rejects.toThrow('process.exit called');

            expect(p.cancel).toHaveBeenCalledWith('Project creation cancelled');
            expect(mockExit).toHaveBeenCalledWith(0);

            mockExit.mockRestore();
        });

        it('should re-prompt on invalid name', async () => {
            vi.mocked(p.text)
                .mockResolvedValueOnce('123-invalid')
                .mockResolvedValueOnce('valid-project');
            vi.mocked(p.isCancel).mockReturnValue(false);

            const result = await promptForProjectName();

            expect(result).toBe('valid-project');
            expect(p.text).toHaveBeenCalledTimes(2);
        });
    });

    describe('createProjectDirectory', () => {
        const mockSpinner = {
            stop: vi.fn(),
        } as any;

        it('should create directory successfully', async () => {
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            const result = await createProjectDirectory('my-project', mockSpinner);

            expect(result).toContain('my-project');
            expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('my-project'));
        });

        it('should exit if directory exists', async () => {
            const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
                throw new Error('process.exit called');
            });
            const error = new Error('EEXIST') as any;
            error.code = 'EEXIST';
            vi.mocked(fs.mkdir).mockRejectedValue(error);

            await expect(createProjectDirectory('existing-project', mockSpinner)).rejects.toThrow(
                'process.exit called'
            );

            expect(mockSpinner.stop).toHaveBeenCalledWith(
                expect.stringContaining('already exists')
            );
            expect(mockExit).toHaveBeenCalledWith(1);

            mockExit.mockRestore();
        });

        it('should throw on other errors', async () => {
            const error = new Error('Permission denied');
            vi.mocked(fs.mkdir).mockRejectedValue(error);

            await expect(createProjectDirectory('my-project', mockSpinner)).rejects.toThrow(
                'Permission denied'
            );
        });
    });

    describe('setupGitRepo', () => {
        it('should initialize git repository', async () => {
            vi.mocked(executeWithTimeout).mockResolvedValue(undefined as any);

            await setupGitRepo('/path/to/project');

            expect(executeWithTimeout).toHaveBeenCalledWith('git', ['init'], {
                cwd: '/path/to/project',
            });
        });
    });

    describe('createGitignore', () => {
        it('should create .gitignore with base entries', async () => {
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            await createGitignore('/path/to/project');

            expect(fs.writeFile).toHaveBeenCalledWith(
                '/path/to/project/.gitignore',
                expect.stringContaining('node_modules')
            );
            expect(fs.writeFile).toHaveBeenCalledWith(
                '/path/to/project/.gitignore',
                expect.stringContaining('.env')
            );
        });

        it('should include additional entries', async () => {
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            await createGitignore('/path/to/project', ['*.tmp', 'cache/']);

            expect(fs.writeFile).toHaveBeenCalledWith(
                '/path/to/project/.gitignore',
                expect.stringMatching(/\*.tmp/)
            );
            expect(fs.writeFile).toHaveBeenCalledWith(
                '/path/to/project/.gitignore',
                expect.stringMatching(/cache\//)
            );
        });
    });

    describe('initPackageJson', () => {
        beforeEach(() => {
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);
        });

        it('should initialize package.json for app', async () => {
            await initPackageJson('/path/to/project', 'my-app', 'app');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            if (!writeCall) {
                throw new Error('writeFile was not called');
            }
            const packageJson = JSON.parse(writeCall[1] as string);

            expect(packageJson.name).toBe('my-app');
            expect(packageJson.version).toBe('1.0.0');
            expect(packageJson.type).toBe('module');
            expect(packageJson.description).toBe('Dexto application');
        });

        it('should initialize package.json for image', async () => {
            await initPackageJson('/path/to/project', 'my-image', 'image');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            if (!writeCall) {
                throw new Error('writeFile was not called');
            }
            const packageJson = JSON.parse(writeCall[1] as string);

            expect(packageJson.description).toBe('Dexto image providing agent harness');
            expect(packageJson.main).toBe('./dist/index.js');
            expect(packageJson.types).toBe('./dist/index.d.ts');
            expect(packageJson.exports).toBeDefined();
        });

        it('should initialize package.json for project', async () => {
            await initPackageJson('/path/to/project', 'my-project', 'project');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            if (!writeCall) {
                throw new Error('writeFile was not called');
            }
            const packageJson = JSON.parse(writeCall[1] as string);

            expect(packageJson.description).toBe('Custom Dexto project');
            expect(packageJson.bin).toBeDefined();
            expect(packageJson.bin['my-project']).toBe('./dist/src/index.js');
        });
    });

    describe('createTsconfigForApp', () => {
        it('should create tsconfig.json for app', async () => {
            vi.mocked(fs.writeJSON).mockResolvedValue(undefined);

            await createTsconfigForApp('/path/to/project', 'src');

            expect(fs.writeJSON).toHaveBeenCalledWith(
                '/path/to/project/tsconfig.json',
                expect.objectContaining({
                    compilerOptions: expect.objectContaining({
                        target: 'ES2022',
                        module: 'ESNext',
                        outDir: 'dist',
                        rootDir: 'src',
                    }),
                    include: ['src/**/*.ts'],
                }),
                { spaces: 4 }
            );
        });
    });

    describe('createTsconfigForImage', () => {
        it('should create tsconfig.json for image', async () => {
            vi.mocked(fs.writeJSON).mockResolvedValue(undefined);

            await createTsconfigForImage('/path/to/project');

            expect(fs.writeJSON).toHaveBeenCalledWith(
                '/path/to/project/tsconfig.json',
                expect.objectContaining({
                    compilerOptions: expect.objectContaining({
                        target: 'ES2022',
                        module: 'ES2022',
                        moduleResolution: 'bundler',
                        declaration: true,
                    }),
                    include: expect.arrayContaining([
                        'dexto.image.ts',
                        'tools/**/*',
                        'storage/blob/**/*',
                        'storage/database/**/*',
                        'storage/cache/**/*',
                        'compaction/**/*',
                    ]),
                }),
                { spaces: 2 }
            );
        });
    });

    describe('createTsconfigForProject', () => {
        it('should create tsconfig.json for project', async () => {
            vi.mocked(fs.writeJSON).mockResolvedValue(undefined);

            await createTsconfigForProject('/path/to/project');

            expect(fs.writeJSON).toHaveBeenCalledWith(
                '/path/to/project/tsconfig.json',
                expect.objectContaining({
                    compilerOptions: expect.objectContaining({
                        module: 'ES2022',
                        moduleResolution: 'bundler',
                    }),
                    include: expect.arrayContaining([
                        'src/**/*',
                        'storage/**/*',
                        'dexto.config.ts',
                    ]),
                }),
                { spaces: 2 }
            );
        });
    });

    describe('installDependencies', () => {
        beforeEach(() => {
            vi.mocked(executeWithTimeout).mockResolvedValue(undefined as any);
        });

        it('should install production dependencies', async () => {
            await installDependencies('/path/to/project', {
                dependencies: ['@dexto/core', 'zod'],
            });

            expect(executeWithTimeout).toHaveBeenCalledWith(
                'bun',
                ['add', '--save-text-lockfile', '@dexto/core', 'zod'],
                {
                    cwd: '/path/to/project',
                }
            );
        });

        it('should install dev dependencies', async () => {
            await installDependencies('/path/to/project', {
                devDependencies: ['typescript', '@types/node'],
            });

            expect(executeWithTimeout).toHaveBeenCalledWith(
                'bun',
                ['add', '--dev', '--save-text-lockfile', 'typescript', '@types/node'],
                { cwd: '/path/to/project' }
            );
        });

        it('should install both dependencies and devDependencies', async () => {
            await installDependencies('/path/to/project', {
                dependencies: ['@dexto/core'],
                devDependencies: ['typescript'],
            });

            expect(executeWithTimeout).toHaveBeenCalledTimes(2);
        });

        it('should handle empty dependency arrays', async () => {
            await installDependencies('/path/to/project', {
                dependencies: [],
                devDependencies: [],
            });

            expect(executeWithTimeout).not.toHaveBeenCalled();
        });
    });

    describe('createEnvExample', () => {
        it('should create .env.example with entries', async () => {
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            await createEnvExample('/path/to/project', {
                OPENAI_API_KEY: 'sk-...',
                DATABASE_URL: 'postgresql://...',
            });

            expect(fs.writeFile).toHaveBeenCalledWith(
                '/path/to/project/.env.example',
                'OPENAI_API_KEY=sk-...\nDATABASE_URL=postgresql://...'
            );
        });

        it('should handle empty entries', async () => {
            vi.mocked(fs.writeFile).mockResolvedValue(undefined);

            await createEnvExample('/path/to/project', {});

            expect(fs.writeFile).toHaveBeenCalledWith('/path/to/project/.env.example', '');
        });
    });

    describe('ensureDirectory', () => {
        it('should ensure directory exists', async () => {
            vi.mocked(fs.ensureDir).mockResolvedValue(undefined);

            await ensureDirectory('/path/to/directory');

            expect(fs.ensureDir).toHaveBeenCalledWith('/path/to/directory');
        });
    });
});
