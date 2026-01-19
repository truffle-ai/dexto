---
"@dexto/webui": minor
"@dexto/analytics": patch
---

Add copy-paste and drag-drop support for multiple file attachments

**New Features:**
- Support for up to 5 file attachments per message (25MB each, 125MB total)
- Copy-paste files from file manager, screenshots, and images from browser
- Drag-drop files with visual feedback and drop overlay
- Multiple file types supported: images, PDFs, and audio files
- Dedicated attachment preview component with individual remove buttons
- "Clear All" button for bulk attachment removal

**Improvements:**
- Comprehensive file validation with smart error messages
- Compatible model suggestions for unsupported file types
- File rejection analytics tracking
- Keyboard shortcuts: Backspace removes last attachment, Cmd+I focuses input
- Unified file handler for consistent validation across all input methods

**Technical Changes:**
- Refactored from single image+file to unified `Attachment[]` array
- Updated `InputArea`, `ChatApp`, `ChatContext`, `useChat`, and `useQueue` signatures
- Created `AttachmentPreview` component for consistent rendering
- Added `FileRejectedEvent` analytics event
- Helper utilities for attachment management
