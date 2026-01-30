import React, { useState } from 'react';
import type { ServerRegistryEntry } from '@dexto/registry';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Alert, AlertDescription } from './ui/alert';
import { Plus, Save } from 'lucide-react';
import { KeyValueEditor } from './ui/key-value-editor';

interface HeaderPair {
    key: string;
    value: string;
    id: string;
}

interface AddCustomServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddServer: (
        entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>
    ) => Promise<void>;
}

export default function AddCustomServerModal({
    isOpen,
    onClose,
    onAddServer,
}: AddCustomServerModalProps) {
    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        category:
            | 'productivity'
            | 'development'
            | 'research'
            | 'creative'
            | 'data'
            | 'communication'
            | 'custom';
        icon: string;
        version: string;
        author: string;
        homepage: string;
        config: {
            type: 'stdio' | 'sse' | 'http';
            command: string;
            args: string[];
            url: string;
            env: Record<string, string>;
            headers: Record<string, string>;
            timeout: number;
        };
        tags: string[];
        isInstalled: boolean;
        requirements: {
            platform: 'win32' | 'darwin' | 'linux' | 'all';
            node: string;
            python: string;
            dependencies: string[];
        };
    }>({
        name: '',
        description: '',
        category: 'custom',
        icon: '',
        version: '',
        author: '',
        homepage: '',
        config: {
            type: 'stdio',
            command: '',
            args: [],
            url: '',
            env: {},
            headers: {},
            timeout: 30000,
        },
        tags: [],
        isInstalled: false,
        requirements: {
            platform: 'all',
            node: '',
            python: '',
            dependencies: [],
        },
    });

    const [argsInput, setArgsInput] = useState('');
    const [tagsInput, setTagsInput] = useState('');
    const [envInput, setEnvInput] = useState('');
    const [headerPairs, setHeaderPairs] = useState<HeaderPair[]>([]);
    const [dependenciesInput, setDependenciesInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const categories = [
        { value: 'productivity', label: 'Productivity' },
        { value: 'development', label: 'Development' },
        { value: 'research', label: 'Research' },
        { value: 'creative', label: 'Creative' },
        { value: 'data', label: 'Data' },
        { value: 'communication', label: 'Communication' },
        { value: 'custom', label: 'Custom' },
    ];

    const platforms = [
        { value: 'all', label: 'All Platforms' },
        { value: 'win32', label: 'Windows' },
        { value: 'darwin', label: 'macOS' },
        { value: 'linux', label: 'Linux' },
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            // Parse inputs
            const args = argsInput
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const tags = tagsInput
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const dependencies = dependenciesInput
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

            // Parse environment variables
            const env: Record<string, string> = {};
            if (envInput.trim()) {
                const envLines = envInput.split('\n');
                for (const line of envLines) {
                    // Skip empty lines
                    const trimmedLine = line.trim();
                    if (!trimmedLine) {
                        continue;
                    }

                    // Split only at the first '=' character
                    const equalIndex = trimmedLine.indexOf('=');
                    if (equalIndex > 0) {
                        // Key must exist (equalIndex > 0, not >= 0)
                        const key = trimmedLine.substring(0, equalIndex).trim();
                        const value = trimmedLine.substring(equalIndex + 1).trim();

                        // Only add if key is not empty
                        if (key) {
                            env[key] = value; // Value can be empty string
                        }
                    }
                }
            }

            // Convert header pairs to record
            const headers: Record<string, string> = {};
            headerPairs.forEach((pair) => {
                if (pair.key.trim() && pair.value.trim()) {
                    headers[pair.key.trim()] = pair.value.trim();
                }
            });

            // Validate required fields
            if (!formData.name.trim()) {
                throw new Error('Server name is required');
            }
            if (!formData.description.trim()) {
                throw new Error('Description is required');
            }
            if (formData.config.type === 'stdio' && !formData.config.command.trim()) {
                throw new Error('Command is required for stdio servers');
            }
            if (formData.config.type === 'sse' && !formData.config.url.trim()) {
                throw new Error('URL is required for SSE servers');
            }
            if (formData.config.type === 'http' && !formData.config.url.trim()) {
                throw new Error('URL is required for HTTP servers');
            }

            const entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'> = {
                ...formData,
                config: {
                    ...formData.config,
                    args,
                    env,
                    headers,
                },
                tags,
                requirements: {
                    ...formData.requirements,
                    dependencies,
                },
            };

            await onAddServer(entry);
            onClose();

            // Reset form
            setFormData({
                name: '',
                description: '',
                category: 'custom',
                icon: '',
                version: '',
                author: '',
                homepage: '',
                config: {
                    type: 'stdio',
                    command: '',
                    args: [],
                    url: '',
                    env: {},
                    headers: {},
                    timeout: 30000,
                },
                tags: [],
                isInstalled: false,
                requirements: {
                    platform: 'all',
                    node: '',
                    python: '',
                    dependencies: [],
                },
            });
            setArgsInput('');
            setTagsInput('');
            setEnvInput('');
            setHeaderPairs([]);
            setDependenciesInput('');
        } catch (err: any) {
            setError(err.message || 'Failed to add custom server');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            config: {
                ...prev.config,
                [name]: value,
            },
        }));
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5" />
                        Add Custom Server to Registry
                    </DialogTitle>
                    <DialogDescription>
                        Add your own custom MCP server configuration to the registry for easy reuse.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Basic Information */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="name">Server Name *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="My Custom Server"
                                required
                            />
                        </div>
                        <div>
                            <Label htmlFor="category">Category</Label>
                            <Select
                                value={formData.category}
                                onValueChange={(value: any) =>
                                    setFormData((prev) => ({ ...prev, category: value }))
                                }
                            >
                                <SelectTrigger id="category">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map((cat) => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <Label htmlFor="description">Description *</Label>
                        <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e) =>
                                setFormData((prev) => ({ ...prev, description: e.target.value }))
                            }
                            placeholder="Describe what this server does..."
                            required
                        />
                    </div>

                    {/* Server Configuration */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium">Server Configuration</h3>

                        <div>
                            <Label htmlFor="serverType">Server Type</Label>
                            <Select
                                value={formData.config.type}
                                onValueChange={(value: 'stdio' | 'sse' | 'http') =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        config: { ...prev.config, type: value },
                                    }))
                                }
                            >
                                <SelectTrigger id="serverType">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stdio">stdio</SelectItem>
                                    <SelectItem value="sse">sse</SelectItem>
                                    <SelectItem value="http">http</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {formData.config.type === 'stdio' ? (
                            <>
                                <div>
                                    <Label htmlFor="command">Command *</Label>
                                    <Input
                                        id="command"
                                        value={formData.config.command}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                config: { ...prev.config, command: e.target.value },
                                            }))
                                        }
                                        placeholder="npx or python"
                                        required
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="args">Arguments</Label>
                                    <Input
                                        id="args"
                                        value={argsInput}
                                        onChange={(e) => setArgsInput(e.target.value)}
                                        placeholder="Comma-separated: -m,script.py,--port,8080"
                                    />
                                </div>
                            </>
                        ) : formData.config.type === 'sse' ? (
                            <div className="space-y-2">
                                <Label htmlFor="url">URL *</Label>
                                <Input
                                    id="url"
                                    name="url"
                                    value={formData.config.url}
                                    onChange={handleConfigChange}
                                    placeholder="http://localhost:8080/sse"
                                    required
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label htmlFor="url">URL *</Label>
                                <Input
                                    id="url"
                                    name="url"
                                    value={formData.config.url}
                                    onChange={handleConfigChange}
                                    placeholder="https://example.com"
                                    required
                                />
                            </div>
                        )}

                        {formData.config.type === 'stdio' && (
                            <div>
                                <Label htmlFor="env">Environment Variables</Label>
                                <Textarea
                                    id="env"
                                    value={envInput}
                                    onChange={(e) => setEnvInput(e.target.value)}
                                    placeholder={`KEY1=value1\nKEY2=value2`}
                                    rows={3}
                                />
                            </div>
                        )}

                        {(formData.config.type === 'sse' || formData.config.type === 'http') && (
                            <div className="space-y-4">
                                <KeyValueEditor
                                    label="Headers"
                                    pairs={headerPairs}
                                    onChange={setHeaderPairs}
                                    placeholder={{
                                        key: 'Authorization',
                                        value: 'Bearer your-token',
                                    }}
                                    keyLabel="Header"
                                    valueLabel="Value"
                                />
                            </div>
                        )}
                    </div>

                    {/* Additional Information */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="tags">Tags</Label>
                            <Input
                                id="tags"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                                placeholder="Comma-separated: file, database, api"
                            />
                        </div>
                        <div>
                            <Label htmlFor="icon">Icon (Emoji)</Label>
                            <Input
                                id="icon"
                                value={formData.icon}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, icon: e.target.value }))
                                }
                                placeholder="⚡"
                                maxLength={2}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="version">Version</Label>
                            <Input
                                id="version"
                                value={formData.version}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, version: e.target.value }))
                                }
                                placeholder="1.0.0"
                            />
                        </div>
                        <div>
                            <Label htmlFor="author">Author</Label>
                            <Input
                                id="author"
                                value={formData.author}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, author: e.target.value }))
                                }
                                placeholder="Your Name"
                            />
                        </div>
                    </div>

                    <div>
                        <Label htmlFor="homepage">Homepage URL</Label>
                        <Input
                            id="homepage"
                            value={formData.homepage}
                            onChange={(e) =>
                                setFormData((prev) => ({ ...prev, homepage: e.target.value }))
                            }
                            placeholder="https://github.com/youruser/yourserver"
                        />
                    </div>

                    {/* Requirements Section */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium">Requirements</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="platform">Platform</Label>
                                <Select
                                    value={formData.requirements.platform}
                                    onValueChange={(value: 'win32' | 'darwin' | 'linux' | 'all') =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            requirements: { ...prev.requirements, platform: value },
                                        }))
                                    }
                                >
                                    <SelectTrigger id="platform">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {platforms.map((platform) => (
                                            <SelectItem key={platform.value} value={platform.value}>
                                                {platform.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="dependencies">Dependencies</Label>
                                <Input
                                    id="dependencies"
                                    value={dependenciesInput}
                                    onChange={(e) => setDependenciesInput(e.target.value)}
                                    placeholder="Comma-separated: package1, package2"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="nodeVersion">Node.js Version</Label>
                                <Input
                                    id="nodeVersion"
                                    value={formData.requirements.node}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            requirements: {
                                                ...prev.requirements,
                                                node: e.target.value,
                                            },
                                        }))
                                    }
                                    placeholder=">=16.0.0"
                                />
                            </div>
                            <div>
                                <Label htmlFor="pythonVersion">Python Version</Label>
                                <Input
                                    id="pythonVersion"
                                    value={formData.requirements.python}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            requirements: {
                                                ...prev.requirements,
                                                python: e.target.value,
                                            },
                                        }))
                                    }
                                    placeholder=">=3.8"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? (
                                'Adding...'
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Add to Registry
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
