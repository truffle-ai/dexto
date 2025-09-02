# Adding a New LLM Service

This guide explains how to add support for a new Large Language Model (LLM) provider to Dexto. For an architectural overview of the LLM system see `../README.md`. The LLM service architecture is designed to be extensible, allowing you to integrate with different AI providers while maintaining consistent behavior.

## LLM Architecture Overview

Dexto uses an abstraction layer to interact with different LLM providers:

```
+-----------------+      +---------------------+      +---------------------+
|  Client Manager |----->|     LLM Factory     |<-----|       Config        |
| (Tool Execution)|      +----------+----------+      +---------------------+
+--------+--------+                 |
         |                         ▼
         |        +----------------------------------+
         |        |         LLM Interface            |
         +------->|       (ILLMService type)         |
                  +-----------------+----------------+
                                    |
                      +-------------+-------------+
                      |                           |
            +---------▼----------+     +----------▼---------+
            |   OpenAIService    |     |  AnthropicService  |  ... (Other Providers)
            | (Uses MessageMgr)  |     | (Uses MessageMgr)  |
            +--------------------+     +--------------------+
```

The main components are:

1.  **LLM Interface (`ILLMService`)** - Defines the contract that all LLM implementations must follow. It handles task completion, context updates, conversation state, and event emission.
2.  **Provider Implementations** - Each provider (e.g., OpenAI, Anthropic) has its own implementation of `ILLMService`. These services interact with the provider's specific API.
3.  **Factory (`factory.ts`)** - Creates the appropriate service (`OpenAIService`, `AnthropicService`, etc.) based on configuration (`LLMConfig`). It also handles API key extraction and can optionally create services compatible with the Vercel AI SDK.
4.  **Client Manager (`client/manager.ts`)** - Manages the available tools (getting definitions, executing them). LLM services use the `McpManager` to get tool information and execute tool calls requested by the LLM.
5.  **Message Manager (`messages/manager.ts`)** - Manages the conversation history, formats messages according to the provider's requirements (using specific formatters), handles system prompts, applies compression strategies, and manages token limits. Each LLM service instance typically has its own `ContextManager`.
6.  **Event Emitter (`EventEmitter`)** - Used by LLM services to emit events during the task completion lifecycle (e.g., `thinking`, `toolCall`, `toolResult`, `response`, `error`). This allows other parts of the application to react to the LLM's progress.


## Overview of Implementation Steps

Adding a new LLM provider involves these main steps:

1.  **Choose LLM & Install SDK:** Select the provider and install its Node.js/TypeScript SDK.
2.  **Implement/Select Formatter:** Ensure a message formatter (`IMessageFormatter`) exists for the provider's API structure.
3.  **Implement/Select Tokenizer & Utilities:** Ensure a tokenizer (`ITokenizer`) and token limit information (`getMaxTokens`) are available for the chosen model(s).
4.  **Choose/Implement Compression Strategy(ies):** Decide which context compression strategies (`ICompressionStrategy`) the `ContextManager` should use if the token limit is exceeded.
5.  **Create `ILLMService` Implementation:** Build the core service class, integrating the SDK, `ContextManager`, `McpManager`, and handling the API interaction logic.
6.  **Update Factory:** Modify the `factory.ts` to recognize and instantiate your new service.
7.  **Test:** Configure and run Dexto to test your new provider integration.

Let's look at each step in more detail.

## Step 1: Choose LLM & Install SDK

*   Select the Large Language Model provider you want to integrate (e.g., Google Gemini, Cohere, Mistral).
*   Find and install their official Node.js/TypeScript SDK:
    ```bash
    npm install @provider/sdk-library
    ```

## Step 2: Implement/Select Message Formatter (`IMessageFormatter`)

*   **Role:** Translates Dexto's internal message history (`InternalMessage[]`) into the specific array format required by your chosen LLM provider's API.
*   **Location:** `src/core/llm/messages/formatters/`
*   **Action:**
    *   Check if a suitable formatter already exists (e.g., `OpenAIMessageFormatter`, `AnthropicMessageFormatter`).
    *   If not, create a new class (e.g., `YourProviderMessageFormatter.ts`) that implements the `IMessageFormatter` interface from `./types.ts`.
    *   Implement the `formatMessages` method to perform the required transformation based on the provider's API documentation (e.g., mapping roles, handling content types).
    *   Implement `formatSystemPrompt` if the provider handles system prompts separately from the main message list.

## Step 3: Implement/Select Tokenizer (`ITokenizer`) & Utilities

*   **Role:** Counts tokens in text according to the specific model's tokenization scheme. This is crucial for the `ContextManager` to manage the context window and apply compression strategies when the token limit is exceeded.
*   **Location:** `src/core/llm/tokenizer/`
*   **Action:**
    1.  **Check/Add Tokenizer Logic:** Find a library or method (often part of the provider's SDK) to count tokens for your model. Integrate this into the `createTokenizer` function in `factory.ts` if possible, associating it with your provider name (e.g., `'your-provider-name'`). Alternatively, you can directly instantiate the tokenizer within your service constructor.
    2.  **Update `getMaxTokens`:** Add your model's maximum context window size (token limit) to the `getMaxTokens` function in `utils.ts`. This allows the system to calculate appropriate limits for `ContextManager`.
    *   Ensure your tokenizer implementation conforms to the `ITokenizer` interface from `./types.ts` (primarily the `countTokens(text: string): number` method).

## Step 4: Choose/Implement Compression Strategy(ies) (`ICompressionStrategy`)

*   **Role:** Defines how the `ContextManager` should reduce the token count of the conversation history when it exceeds the `maxTokens` limit. Strategies are applied sequentially until the history fits.
*   **Location:** `src/core/llm/messages/compression/`
*   **Action:**
    *   Review the existing strategies: `OldestRemovalStrategy.ts` (removes oldest messages) and `MiddleRemovalStrategy.ts` (attempts to remove messages between the first user message and the latest messages).
    *   Decide which strategy or sequence of strategies is appropriate for your provider/use case. The default sequence used by `ContextManager` is `[MiddleRemovalStrategy, OldestRemovalStrategy]`.
    *   If necessary, implement a custom strategy by creating a class that implements the `ICompressionStrategy` interface from `./types.ts`, defining the `compress(messages: InternalMessage[], maxTokens: number, tokenizer: ITokenizer): InternalMessage[]` method.
    *   You will pass your chosen strategy instance(s) to the `ContextManager` constructor in the next step.

## Step 5: Create `ILLMService` Implementation

This is the core step where you tie everything together.

1.  **Create the Service File:** Create `src/core/llm/services/your-provider.ts`.
2.  **Implement the Class:** The factory (`factory.ts`) typically handles the instantiation of the `ContextManager` and the provider's SDK client, passing them to your service's constructor along with the `MCPManager` and an `EventEmitter`.

```typescript
import YourProviderSDK from '@provider/sdk-library'; // Your provider's SDK
import { MCPManager } from '../../../client/manager.js'; // Use MCPManager
import { ILLMService, LLMServiceConfig } from './types.js';
import { ToolSet } from '../../types.js';
import { logger } from '../../../utils/logger.js';
import { EventEmitter } from 'events';
import { ContextManager } from '../messages/manager.js';
import { getMaxTokens } from '../tokenizer/utils.js';
import { ImageData } from '../messages/types.js'; // For potential image support

export class YourProviderService implements ILLMService {
    private providerClient: YourProviderSDK; // Provider SDK instance (passed in)
    private model: string;                  // Model identifier (passed in)
    private mcpManager: MCPManager; // Passed in from factory
    private contextManager: ContextManager;  // Passed in from factory
    private eventEmitter: EventEmitter;      // Passed in from factory
    private maxIterations: number;           // Max tool call loops

    constructor(
        mcpManager: MCPManager,     // Provided by factory
        providerClient: YourProviderSDK,   // Provided by factory
        agentEventBus: EventEmitter,       // Provided by factory
        contextManager: ContextManager,    // Provided by factory
        model: string,                     // Provided by factory
        maxIterations: number = 10         // Or a default suitable for the provider
    ) {
        this.model = model;
        this.providerClient = providerClient;
        this.mcpManager = mcpManager;
        this.eventEmitter = agentEventBus;   // Use the passed-in emitter
        this.contextManager = contextManager; // Use the passed-in message manager
        this.maxIterations = maxIterations;

        // Initialization logic simplified as ContextManager, etc. are pre-configured
        logger.info(`Initialized YourProviderService with model ${this.model}`);
    }


    getAllTools(): Promise<ToolSet> {
        return this.mcpManager.getAllTools();
    }

    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.contextManager.getMaxTokens();
        return {
            // Use the provider name registered in the factory
            provider: 'your-provider-name', 
            model: this.model,
            configuredMaxTokens: configuredMaxTokens,
            // Ensure getMaxTokens uses the same provider name and model
            modelMaxTokens: getMaxTokens('your-provider-name', this.model)
        };
    }

    async completeTask(userInput: string, imageData?: ImageData): Promise<string> {
        // Add user message (potentially with image data) via ContextManager
        this.contextManager.addUserMessage(userInput, imageData);

        const rawTools = await this.mcpManager.getAllTools();
        // Provider-specific formatting is still needed
        const formattedTools = this.formatToolsForProvider(rawTools); 
        
        // Emit standardized event
        this.eventEmitter.emit('llmservice:thinking'); 
        logger.debug('Starting completeTask loop');

        let iterationCount = 0;
        let finalResponseText = ''; // Store final text across iterations if needed

        try {
            while (iterationCount < this.maxIterations) {
                iterationCount++;
                logger.debug(`LLM Iteration ${iterationCount}`);

                // Get formatted messages from ContextManager (handles history, compression, formatting)
                const messages = await this.contextManager.getFormattedMessages({ 
                    mcpManager: this.mcpManager // May be needed for certain formatters
                }); 
                
                // Estimate and log token count (optional but useful)
                const currentTokens = this.contextManager.getTokenCount();
                logger.debug(`Estimated tokens being sent: ${currentTokens}`);

                logger.silly("Messages sent to provider:", messages);
                logger.silly("Formatted tools:", formattedTools);

                // --- Call Provider API ---
                // Adapt based on provider SDK (e.g., chat completions, generateText)
                const response = await this.providerClient.someApiCall({ 
                    model: this.model,
                    messages: messages, // Use messages from ContextManager
                    tools: formattedTools, // Send formatted tools
                    tool_choice: 'auto', // Or provider-specific equivalent
                    // ... other provider options
                });
                logger.silly("Raw response from provider:", response);

                // --- Process Response --- 
                // Provider-specific parsing is required
                const { textContent, toolCalls } = this.parseProviderResponse(response); 
                logger.silly("Parsed response:", { textContent, toolCalls });

                // Add assistant message via ContextManager (handles text and/or tool calls)
                this.contextManager.addAssistantMessage(textContent, toolCalls);

                // --- Handle Tool Calls (if any) --- 
                if (!toolCalls || toolCalls.length === 0) {
                    logger.debug('No tool calls. Task complete.');
                    finalResponseText = textContent || ''; 
                    this.eventEmitter.emit('llmservice:response', finalResponseText); // Emit final response
                    return finalResponseText; // Exit loop and return
                }
                
                // Optional: Accumulate intermediate text if needed
                // if (textContent) { finalResponseText += textContent + '\\n'; }

                logger.debug(`Processing ${toolCalls.length} tool calls.`);
                for (const toolCall of toolCalls) { 
                    // Extract provider-specific details (ID, function name, arguments)
                    const toolName = toolCall.function.name; 
                    const toolCallId = toolCall.id; // Provider-specific ID
                    let args: any = {};
                    
                    try {
                        // Arguments might already be objects or need parsing
                        args = typeof toolCall.function.arguments === 'string' 
                            ? JSON.parse(toolCall.function.arguments) 
                            : toolCall.function.arguments;
                    } catch (e) {
                        const errorMsg = `Invalid arguments format: ${e instanceof Error ? e.message : String(e)}`;
                        logger.error(`Failed to parse arguments for tool ${toolName}: ${toolCall.function.arguments}`, e);
                        // Add error result via ContextManager
                        this.contextManager.addToolResult(toolCallId, toolName, { error: errorMsg });
                        this.eventEmitter.emit('llmservice:toolResult', toolName, { error: errorMsg });
                        continue; // Skip execution
                    }

                    this.eventEmitter.emit('llmservice:toolCall', toolName, args);
                    let result: any;
                    try {
                        result = await this.mcpManager.executeTool(toolName, args);
                        logger.debug(`Tool ${toolName} executed successfully.`);
                        // Add success result via ContextManager
                        this.contextManager.addToolResult(toolCallId, toolName, result);
                        this.eventEmitter.emit('llmservice:toolResult', toolName, result);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);
                        result = { error: errorMessage }; 
                        // Add error result via ContextManager
                        this.contextManager.addToolResult(toolCallId, toolName, result);
                        this.eventEmitter.emit('llmservice:toolResult', toolName, result);
                    }
                }
                
                // Prepare for next iteration
                this.eventEmitter.emit('llmservice:thinking'); 

            } // End while loop

            // Max iterations reached
            logger.warn(`Reached maximum iterations (${this.maxIterations}).`);
            const maxIterResponse = finalResponseText || 'Reached maximum tool call iterations without a final answer.';
            // Add final assistant message if loop ended due to iterations
            if (!finalResponseText) {
                 this.contextManager.addAssistantMessage(maxIterResponse);
            }
            this.eventEmitter.emit('llmservice:response', maxIterResponse);
            return maxIterResponse;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error during completeTask execution: ${errorMessage}`, { error });
            this.eventEmitter.emit('llmservice:error', error instanceof Error ? error : new Error(errorMessage));
            // Optionally add an error message to history via ContextManager if desired
            // this.contextManager.addAssistantMessage(`Error processing request: ${errorMessage}`);
            return `Error processing request: ${errorMessage}`;
        }
    }

    // --- Private Helper Methods (Still Provider-Specific) --- 

    // Translates Dexto's internal ToolSet into the provider's specific format
    private formatToolsForProvider(tools: ToolSet): any[] { // Return type depends on provider SDK
        logger.debug(`Formatting ${Object.keys(tools).length} tools for provider.`);
        // *** Provider-Specific Transformation Logic Here ***
        // Example (adapt based on provider's requirements, e.g., OpenAI, Vercel AI SDK):
        return Object.entries(tools).map(([toolName, toolDefinition]) => ({
            type: 'function', // Or appropriate type for the provider
            function: {
                name: toolName,
                description: toolDefinition.description,
                parameters: toolDefinition.parameters || { type: 'object', properties: {} } 
            }
        }));
    }

    // Parses the raw response from the provider's API 
    private parseProviderResponse(response: any): { textContent: string | null; toolCalls: any[] | null } {
         // *** Provider-Specific Parsing Logic Here ***
         // Needs to extract:
         // 1. The main textual response content.
         // 2. Tool call requests, formatted into the structure ContextManager expects:
         //    { id: string, type: 'function', function: { name: string, arguments: string | object } }[]
         //    (Note: ContextManager's addAssistantMessage handles the internal conversion)
         
         // Example structure (adapt heavily based on provider response structure):
         const message = response?.choices?.[0]?.message; // Example for OpenAI-like structure
         let textContent: string | null = message?.content || null;
         let toolCalls: any[] | null = message?.tool_calls || null; 

         // Handle providers that might mix text and tool calls differently (e.g., Anthropic).
         // Ensure tool call 'arguments' are accessible (stringified JSON or object).

         return { textContent, toolCalls };
       }
   }
   ```

## Step 6: Update the Factory (`factory.ts`)

The factory (`src/core/llm/services/factory.ts`) creates the correct LLM service based on the configuration.

1.  **Import Your Service:** Add `import { YourProviderService } from './your-provider.js';` at the top.
2.  **Add to `_createLLMService`:** Add a `case` for your provider name in the `switch` statement within the `_createLLMService` function:
    ```typescript
    case 'your-provider-name':
        return new YourProviderService(mcpManager, config.systemPrompt, apiKey, config.model);
    ```
3.  **Update API Key Env Var (If Needed):** If your provider uses a standard environment variable name different from `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, update the `switch` statement within the `extractApiKey` function (or the `getApiKeyEnvVarName` helper if used) to include your provider's key name.
    ```typescript
    case 'your-provider-name': apiKeyEnvVar = 'YOUR_PROVIDER_API_KEY'; break;
    ```
4.  **Update `createContextManager`:** Modify the `createContextManager` function in `factory.ts` to handle your provider:
    *   Ensure `getMaxTokens` is updated for your model(s).
    *   Import and instantiate your `YourProviderMessageFormatter`.
    *   Select appropriate `ICompressionStrategy` instances (or use defaults).
    *   Create the `ITokenizer` for your provider (often via `createTokenizer`).
    *   Add a `case` for your provider name to return a correctly configured `ContextManager`.
        ```typescript
         case 'your-provider-name': {
             const tokenizer = createTokenizer('your-provider-name', config.model);
             const formatter = new YourProviderMessageFormatter(); // Your formatter
             const rawMaxTokens = getMaxTokens('your-provider-name', config.model);
             // Calculate margin, potentially based on provider specifics
             const maxTokensWithMargin = Math.floor(rawMaxTokens * 0.9); 
             // Choose compression strategies
             const compressionStrategies: ICompressionStrategy[] = [
                 new MiddleRemovalStrategy(), // Example default
                 new OldestRemovalStrategy()
             ]; 
             return new ContextManager(
                 formatter,
                 config.systemPrompt,
                 maxTokensWithMargin,
                 tokenizer,
                 compressionStrategies
             );
         }
        ```
5.  **Optional: Add Vercel AI SDK Support:** If your provider is supported by `@ai-sdk` and you want to enable Vercel mode:
    *   Import its SDK model creation function (e.g., `import { yourProvider } from '@ai-sdk/your-provider';`).
    *   Add a `case` to the `switch` statement in `_createVercelModel` within `factory.ts`:
        ```typescript
         case 'your-provider-name': 
              modelInstance = yourProvider(modelId, { apiKey }); // Pass API key if needed
              provider = 'your-provider-name'; // Set provider name for ContextManager lookup
              break; // Don't forget break!
        ```
    *   Ensure `createContextManager` can handle the Vercel provider name derived (e.g., using `getProviderFromModel`).

## Step 7: Test Your Implementation

1.  **Configure `agent.yml`:** Update your configuration file to use your new provider:
   ```yaml
   systemPrompt: |
     You are a helpful AI assistant.

   llm:
     provider: your-provider-name
     model: your-model-name
     # you can update the system prompt to change the behavior of the llm
     apiKey: $YOUR_PROVIDER_API_KEY
   ```
2.  **Set API Key:** Ensure the API key is available either directly in the config (not recommended for production) or in your environment variables (e.g., in a `.env` file loaded by your application).
3.  **Run Dexto:** Start the application (`npm start` or similar).
4.  **Test Thoroughly:**
    *   Send simple prompts.
    *   Send prompts designed to trigger tool usage.
    *   Send long conversations to test context window limits and compression.
    *   Monitor the logs (set log level to `debug` or `silly` for detailed info during development).
    *   Check for expected events from the `EventEmitter` if applicable.

By following these steps, you should be able to successfully integrate a new LLM provider into Dexto's extensible architecture. Remember to adapt the provider-specific logic (`formatToolsForProvider`, `parseProviderResponse`, API calls) based on the chosen provider's SDK and API documentation. 

## Related Modules

- [`llm`](../README.md) - Core LLM system
- [`config`](../config/README.md) - Configuration
- [`tools`](../../tools/README.md) - Tool management 