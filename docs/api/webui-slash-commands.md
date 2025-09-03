# WebUI Slash Commands

The Dexto WebUI now supports slash commands for accessing prompts, providing an intuitive way to discover and use available prompts directly in the chat interface.

## Overview

Slash commands allow users to quickly access prompts by typing `/` in the input area, which triggers an autocomplete interface showing all available prompts with their descriptions and arguments.

## Features

### **Automatic Prompt Discovery**
- **Type `/`** to trigger the prompt autocomplete
- **Real-time search** through available prompts
- **Source identification** (MCP vs Internal prompts)
- **Argument display** showing required and optional parameters

### **User Experience**
- **Keyboard navigation** with arrow keys
- **Tab completion** for quick prompt insertion
- **Visual feedback** with source badges and descriptions
- **Responsive design** that works on all screen sizes

## How It Works

### 1. **Trigger Slash Commands**
```
Type "/" in the input area
```

### 2. **Browse Available Prompts**
The autocomplete shows:
- **Prompt name** (e.g., `/code-review`)
- **Title** (if available)
- **Description** (what the prompt does)
- **Source badge** (MCP or Internal)
- **Arguments** (required parameters marked with *)

### 3. **Select and Use**
- **Arrow keys** to navigate
- **Enter** to select
- **Escape** to close
- **Click** to select directly

### 4. **Automatic Insertion**
Selected prompts are automatically inserted into the input area, ready for use.

## API Endpoints

The slash command functionality is powered by these API endpoints:

### `GET /api/prompts`
Lists all available prompts with metadata.

**Response:**
```json
{
  "prompts": [
    {
      "name": "code-review",
      "title": "Code Review Assistant",
      "description": "Helps review code for best practices and potential issues",
      "source": "internal",
      "arguments": [
        {
          "name": "language",
          "description": "Programming language",
          "required": true
        }
      ]
    }
  ],
  "total": 1
}
```

### `GET /api/prompts/:name`
Gets a specific prompt definition.

### `POST /api/prompts/:name/execute`
Executes a prompt with arguments and sends the result to the AI agent.

## Technical Implementation

### **Frontend Components**
- **`SlashCommandAutocomplete`**: Main autocomplete component
- **`InputArea`**: Enhanced with slash command detection
- **Real-time filtering** and keyboard navigation

### **Backend Integration**
- **Direct agent access** through the API server
- **Prompt execution** via the PromptsManager
- **Error handling** and validation

### **State Management**
- **Slash command visibility** based on input content
- **Selected prompt tracking** for argument handling
- **Search query filtering** for prompt discovery

## Usage Examples

### **Basic Prompt Usage**
```
1. Type "/" in the input
2. See available prompts
3. Select "code-review"
4. Add arguments: "language: python"
5. Send the message
```

### **Prompt with Arguments**
```
1. Type "/" to see prompts
2. Select "email-generator"
3. Add arguments: "tone: professional, topic: meeting request"
4. Send to generate the email
```

## Benefits

### **For Users**
- **Faster access** to common prompts
- **Better discovery** of available functionality
- **Consistent interface** across all prompt types
- **Reduced typing** with autocomplete

### **For Developers**
- **Unified prompt system** (MCP + Internal)
- **Extensible architecture** for new prompt types
- **Real-time prompt discovery** without page refresh
- **Standardized API** for prompt management

## Future Enhancements

### **Planned Features**
- **Argument validation** with real-time feedback
- **Prompt templates** for common use cases
- **Favorites system** for frequently used prompts
- **Custom prompt creation** through the UI

### **Integration Opportunities**
- **Tool execution** through slash commands
- **Session management** commands
- **Configuration shortcuts** for common settings
- **Help system** integration

## Troubleshooting

### **Common Issues**
- **Prompts not showing**: Check if the agent has access to prompt sources
- **Autocomplete not working**: Ensure JavaScript is enabled
- **API errors**: Check the browser console for error details

### **Debug Information**
- **Browser console** shows API request/response details
- **Network tab** displays prompt fetching operations
- **Error messages** provide specific failure reasons
