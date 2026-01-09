import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { SettingsNavigation, type SettingsSection } from './SettingsNavigation';
import { ApiKeysSection } from './sections/ApiKeysSection';
import { VoiceSection } from './sections/VoiceSection';
import { AppearanceSection } from './sections/AppearanceSection';

type SettingsPanelProps = {
    isOpen: boolean;
    onClose: () => void;
};

const sectionTitles: Record<SettingsSection, string> = {
    'api-keys': 'API Keys',
    voice: 'Voice & TTS',
    appearance: 'Appearance',
};

const sectionDescriptions: Record<SettingsSection, string> = {
    'api-keys': 'Manage API keys for LLM providers',
    voice: 'Configure text-to-speech settings',
    appearance: 'Customize theme and UI preferences',
};

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    const [activeSection, setActiveSection] = useState<SettingsSection>('api-keys');

    const renderSection = () => {
        switch (activeSection) {
            case 'api-keys':
                return <ApiKeysSection />;
            case 'voice':
                return <VoiceSection active={isOpen} />;
            case 'appearance':
                return <AppearanceSection />;
            default:
                return null;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="max-w-4xl! w-[90vw] h-[85vh] p-0! gap-0! flex flex-col"
                hideCloseButton
            >
                {/* Visually hidden title for accessibility */}
                <DialogTitle className="sr-only">Settings</DialogTitle>

                <div className="flex flex-1 min-h-0">
                    {/* Left Navigation - hidden on mobile, shown on md+ */}
                    <div className="hidden md:flex md:flex-col w-56 border-r border-border bg-muted/30 shrink-0">
                        <SettingsNavigation
                            activeSection={activeSection}
                            onSectionChange={setActiveSection}
                            onClose={onClose}
                        />
                    </div>

                    {/* Right Content Area */}
                    <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        {/* Mobile header with navigation */}
                        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                            <SettingsNavigation
                                activeSection={activeSection}
                                onSectionChange={setActiveSection}
                                onClose={onClose}
                                variant="mobile"
                            />
                        </div>

                        {/* Desktop header */}
                        <div className="hidden md:block px-6 py-4 border-b border-border shrink-0">
                            <h2 className="text-lg font-semibold">
                                {sectionTitles[activeSection]}
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                {sectionDescriptions[activeSection]}
                            </p>
                        </div>

                        {/* Section content - scrollable */}
                        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
                            {renderSection()}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
