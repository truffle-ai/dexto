---
"@dexto/webui": patch
"@dexto/analytics": patch
---

Add copy-paste and drag-drop support for multiple file attachments

**New Features:**
- Support for up to 5 file attachments per message (5MB each, 25MB total)
- Copy-paste files from file manager, screenshots, and images from browser
- Drag-drop files with visual feedback and drop overlay
- Multiple file types supported: images, PDFs, and audio files
- Dedicated attachment preview component with individual remove buttons
- "Clear All" button for bulk attachment removal

**Improvements:**
- Comprehensive file validation with smart error messages
- Compatible model suggestions for unsupported file types
- File rejection analytics tracking
- Unified file handler for consistent validation across all input methods
- Consistent duplicate file rejection across all upload methods (paste/drop/button)
- Defensive checks for undefined mimeType and malformed data URLs

**Technical Changes:**
- Refactored from single image+file to unified `Attachment[]` array
- Updated `InputArea`, `ChatApp`, `ChatContext`, `useChat`, and `useQueue` signatures
- Created `AttachmentPreview` component for consistent rendering
- Added `FileRejectedEvent` analytics event
- Helper utilities for attachment management
