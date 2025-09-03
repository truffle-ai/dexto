import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'; // Use CDN for simplicity

// --- Global Variables ---
let ws;
let currentAiMessageElement = null;
let thinkingIndicatorElement = null;
let currentImageData = null; // Store { base64: string, mimeType: string } for user uploads
let lastToolImageSrc = null; // Store image source from the last tool result

// Configure marked with sanitization (IMPORTANT!)
marked.use({ sanitize: true });

// --- Wait for DOMContentLoaded before initializing UI and listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // --- Get DOM Elements --- 
    const chatLog = document.getElementById('message-list');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const resetButton = document.getElementById('reset-button');
    const statusIndicator = document.getElementById('status-indicator');
    const connectServerButton = document.getElementById('connect-server-button');
    const modal = document.getElementById('connect-server-modal');
    const closeModalButton = modal?.querySelector('.close-button');
    const connectServerForm = document.getElementById('connect-server-form');
    const serverTypeSelect = document.getElementById('server-type');
    const stdioOptionsDiv = document.getElementById('stdio-options');
    const sseOptionsDiv = document.getElementById('sse-options');
    const imageUpload = document.getElementById('image-upload');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const imagePreview = document.getElementById('image-preview');
    const removeImageBtn = document.getElementById('remove-image-btn');
    const voiceBtn = document.getElementById('voice-button');
    
   

    // --- Check if critical elements exist ---
    if (!chatLog || !messageInput || !sendButton || !resetButton || !statusIndicator || !connectServerButton || !modal || !connectServerForm || !serverTypeSelect || !stdioOptionsDiv || !sseOptionsDiv || !imageUpload || !imagePreviewContainer || !imagePreview || !removeImageBtn || !voiceBtn) {
        console.error("Initialization failed: One or more required DOM elements not found.");
        // Display error to user if possible
        if (chatLog) {
             const errorElement = document.createElement('div');
             errorElement.classList.add('message', 'system-error'); // Use existing class
             errorElement.textContent = '[System: Critical UI elements failed to load. Please refresh.]';
             chatLog.appendChild(errorElement);
        }
        return; // Stop further execution
    }

    function scrollToBottom() {
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function displaySystemMessage(text, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `system-${type}`);
        messageElement.textContent = `[System: ${text}]`;
        chatLog.appendChild(messageElement);
        scrollToBottom();
    }
    
    function appendMessage(sender, text, imageBase64 = null) {
        const messageElement = document.createElement('div');
        // Use the classes targeted by style.css: 'message' and 'user' or 'ai'
        const senderClass = sender === 'user' ? 'user' : 'ai'; // Map 'assistant' or others to 'ai' for styling
        messageElement.classList.add('message', senderClass);
        // messageElement.classList.add('chat-message', `${sender}-message`); // REMOVE old class logic

        const textElement = document.createElement('p');
        textElement.textContent = text;
        messageElement.appendChild(textElement);

        // If it's a user message with an image, display the image
        if (sender === 'user' && imageBase64) {
            const imgElement = document.createElement('img');
            imgElement.src = imageBase64;
            imgElement.alt = "User uploaded image";
            imgElement.classList.add('message-image'); 
            messageElement.appendChild(imgElement); // Add image below text
        }

        chatLog.appendChild(messageElement);
        scrollToBottom();
    }

    function appendExpandableMessage(headerHtml, contentHtml, type) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        messageElement.innerHTML = headerHtml + contentHtml; 

        messageElement.addEventListener('click', () => {
            messageElement.classList.toggle('expanded');
        });

        chatLog.appendChild(messageElement);
        let shouldScroll = isScrolledToBottom();
        if (shouldScroll) {
            scrollToBottom();
        }
        return messageElement;
    }

    function showThinkingIndicator() {
        let shouldScroll = isScrolledToBottom();
        if (!thinkingIndicatorElement) {
            thinkingIndicatorElement = document.createElement('div');
            thinkingIndicatorElement.classList.add('message', 'ai', 'thinking');
            const innerSpan = document.createElement('span'); 
            thinkingIndicatorElement.appendChild(innerSpan);
            thinkingIndicatorElement.setAttribute('role', 'status');
            thinkingIndicatorElement.setAttribute('aria-live', 'polite');
            chatLog.appendChild(thinkingIndicatorElement);
            if (shouldScroll) {
                scrollToBottom();
            }
        }
    }

    function removeThinkingIndicator() {
        if (thinkingIndicatorElement) {
            thinkingIndicatorElement.remove();
            thinkingIndicatorElement = null;
        }
    }

    function isScrolledToBottom() {
        const threshold = 5;
        return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight <= threshold;
    }

    function adjustTextareaHeight() {
        messageInput.style.height = 'auto';
        messageInput.style.height = `${messageInput.scrollHeight}px`;

        // Adjust chat log padding based on input area height
        const inputAreaHeight = document.getElementById('input-area').offsetHeight;
        const previewHeight = imagePreviewContainer.style.display === 'none' ? 0 : imagePreviewContainer.offsetHeight + 10; // + margin/padding
        chatLog.style.paddingBottom = `${inputAreaHeight + previewHeight}px`;
    }

    // Modify sendMessage to include image data
    async function sendMessage() {
        const messageText = messageInput.value.trim();

        // Require text input even if image is present
        if (!messageText) {
            // Optionally show a message to the user
            console.log("User input text is required.")
            return;
        } 

        appendMessage('user', messageText, currentImageData ? currentImageData.base64 : null);
        messageInput.value = '';
        messageInput.style.height = 'auto'; // Reset height before sending
        const imageDataToSend = currentImageData; 
        removeImage(); // Clear image after grabbing data for sending

        // Send via WebSocket instead of fetch
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = { type: 'message', content: messageText, imageData: imageDataToSend };
            ws.send(JSON.stringify(payload));
            lastToolImageSrc = null; // Clear any stored tool image when user sends a new message
        } else {
            displaySystemMessage('Cannot send message: Not connected to server.', 'error');
        }
    }

    function resetConversation() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending reset request...');
            ws.send(JSON.stringify({ type: 'reset' }));
            // UI clear is handled by 'conversationReset' event from server
        } else {
            displaySystemMessage('Cannot reset: Not connected to server.', 'error');
        }
    }

    // --- WebSocket Handling (Needs access to DOM helpers defined above) ---
    function handleWebSocketMessage(message) {
        removeThinkingIndicator();
        let shouldScroll = isScrolledToBottom();

        switch (message.event) {
            case 'thinking':
                showThinkingIndicator();
                break;
            case 'chunk': {
                if (!currentAiMessageElement) {
                    // Create the container div directly for streaming AI messages
                    currentAiMessageElement = document.createElement('div');
                    // Use the correct base classes targeted by CSS: 'message' and 'ai'
                    currentAiMessageElement.classList.add('message', 'ai'); 
                    currentAiMessageElement.classList.add('streaming'); // Add streaming class if needed
                    chatLog.appendChild(currentAiMessageElement);
                }
                if (currentAiMessageElement) {
                   let currentHtml = currentAiMessageElement.innerHTML || '';
                   // Append the raw chunk text (or parsed text if needed, depends on source)
                   // Assuming message.data.text is the raw delta
                   // We need to parse the *accumulated* text at the end, not each chunk
                   let accumulatedText = (currentAiMessageElement.dataset.rawText || '') + message.data.text;
                   currentAiMessageElement.dataset.rawText = accumulatedText; // Store raw text
                   
                   // Render the parsed version of the *accumulated* text
                   try {
                        currentAiMessageElement.innerHTML = marked.parse(accumulatedText);
                   } catch(e) {
                        console.error("Streaming Markdown parsing error:", e);
                        // Fallback: display escaped text
                        currentAiMessageElement.innerHTML = escapeHtml(accumulatedText).replace(/\n/g, '<br>');
                   }
                }
                break;
            }
            case 'response': {
                 let finalHtmlContent = '';
                 let finalText = message.data.text || ''; // Get the final text
                 
                 // Use the final text if currentAiMessageElement exists (meaning it was streamed)
                 if (currentAiMessageElement && currentAiMessageElement.dataset.rawText) {
                     finalText = currentAiMessageElement.dataset.rawText; // Use accumulated raw text
                 }

                 // --- Add image if available from last tool result ---
                 let imageHtml = '';
                 if (lastToolImageSrc) {
                     imageHtml = `<img src="${escapeHtml(lastToolImageSrc)}" class="message-image" alt="AI generated image"/>`;
                     lastToolImageSrc = null; // Clear after use
                 }
                 // --- End image addition ---

                 try {
                     // Combine parsed text and image HTML
                     finalHtmlContent = marked.parse(finalText) + imageHtml;
                 } catch(e) {
                     console.error("Markdown parsing error:", e);
                     // Fallback: display escaped text and image HTML
                     finalHtmlContent = escapeHtml(finalText).replace(/\n/g, '<br>') + imageHtml;
                 }

                 if (currentAiMessageElement) {
                    currentAiMessageElement.innerHTML = finalHtmlContent; // Set final parsed content
                    currentAiMessageElement.classList.remove('streaming');
                    delete currentAiMessageElement.dataset.rawText; // Clean up dataset
                    currentAiMessageElement = null;
                } else {
                    // If it's a non-streaming response, create the element directly
                    const messageElement = document.createElement('div');
                    messageElement.classList.add('message', 'ai');
                    messageElement.innerHTML = finalHtmlContent; // Set the combined HTML content
                    chatLog.appendChild(messageElement);
                }
                break;
            }
            case 'toolCall': {
                const argsString = JSON.stringify(message.data.args, null, 2);
                const headerHtml = `<strong>Tool Call:</strong> ${escapeHtml(message.data.toolName)}`;
                const contentHtml = `<pre><code>${escapeHtml(argsString)}</code></pre>`;
                appendExpandableMessage(headerHtml, contentHtml, 'tool-call');
                currentAiMessageElement = null;
                break;
            }
            case 'toolResult': {
                let resultString;
                const result = message.data.result; // Store result for easier access
                try {
                    resultString = JSON.stringify(result, null, 2);
                } catch {
                    resultString = String(result);
                }
                const headerHtml = `<strong>Tool Result:</strong> ${escapeHtml(message.data.toolName)}`;
                const contentHtml = `<pre><code>${escapeHtml(resultString)}</code></pre>`;
                appendExpandableMessage(headerHtml, contentHtml, 'tool-result');

                // --- Check for image data and store it ---
                // Clear previous image source first
                lastToolImageSrc = null;

                if (result && Array.isArray(result.content)) {
                    // Prioritize structured image data with mimeType
                    const imagePartWithData = result.content.find(item => item.type === 'image' && item.data && item.mimeType);
                    if (imagePartWithData) {
                        lastToolImageSrc = `data:${imagePartWithData.mimeType};base64,${imagePartWithData.data}`;
                    } else {
                        // Fallback: Check for image part with direct url/image source
                        const imagePartWithSrc = result.content.find(item => item.type === 'image' && (item.url || item.image));
                        if (imagePartWithSrc) {
                            lastToolImageSrc = imagePartWithSrc.url || imagePartWithSrc.image;
                        }
                    }
                } 
                // Fallback 1: Direct data URI string?
                else if (typeof result === 'string' && result.startsWith('data:image')) {
                    lastToolImageSrc = result;
                } 
                // Fallback 2: Object with known image properties?
                else if (result && typeof result === 'object') {
                    if (result.screenshot) { // Prioritize screenshot as it's often specific
                        lastToolImageSrc = result.screenshot;
                    } else if (result.image) {
                        lastToolImageSrc = result.image;
                    } else if (result.url && typeof result.url === 'string' && (result.url.startsWith('data:image') || result.url.startsWith('http'))) { 
                        // Ensure URL is likely an image source
                        lastToolImageSrc = result.url;
                    } else if (Array.isArray(result.images) && result.images.length > 0 && typeof result.images[0] === 'string') {
                         // Handle HF-style { images: [...] }
                        lastToolImageSrc = result.images[0];
                    }
                }
                // --- End image check ---

                currentAiMessageElement = null;
                break;
            }
            case 'error': {
                displaySystemMessage(`Error: ${message.data.message}`, 'error');
                currentAiMessageElement = null;
                break;
            }
            case 'conversationReset': {
                chatLog.innerHTML = '';
                displaySystemMessage('Conversation history cleared.', 'status');
                currentAiMessageElement = null;
                shouldScroll = true;
                break;
            }
            default: {
                console.warn('Received unknown event type:', message.event);
                break;
            }
        }
        if (shouldScroll) {
            scrollToBottom();
        }
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;

        console.log(`Attempting to connect WebSocket to: ${wsUrl}`);
        statusIndicator.classList.add('connecting');
        statusIndicator.setAttribute('data-tooltip', 'Connecting...');

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connection established');
            // Connection status indicator
            statusIndicator.classList.remove('error', 'connecting');
            statusIndicator.classList.add('connected');
            statusIndicator.setAttribute('data-tooltip', 'Connected');
            messageInput.disabled = false;
            sendButton.disabled = false;
            voiceBtn.disabled = false
            resetButton.disabled = false;
        };

        ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message); // Call helper defined above
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
                displaySystemMessage('Received invalid data from server.', 'error');
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            statusIndicator.classList.remove('connected');
            statusIndicator.classList.add('error');
            statusIndicator.setAttribute('data-tooltip', 'Connection Error');
            displaySystemMessage('WebSocket connection error. Please try refreshing.', 'error');
            messageInput.disabled = true;
            sendButton.disabled = true;
            resetButton.disabled = true;
        };

        ws.onclose = (event) => {
            console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            statusIndicator.classList.remove('connected');
            statusIndicator.classList.add('error');
            statusIndicator.setAttribute('data-tooltip', `Disconnected: ${event.reason || 'Connection closed'}`);
            messageInput.disabled = true;
            sendButton.disabled = true;
            resetButton.disabled = true;
            setTimeout(connectWebSocket, 5000);
        };
    }

    // --- Attach Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    resetButton.addEventListener('click', resetConversation);
    voiceBtn.addEventListener('click',voiceConv)
  
  
function voiceConv(){
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      voiceBtn.disabled = true;
      voiceBtn.title = "Speech Recognition not supported in this browser";
      displaySystemMessage('Speech recognition is not supported in this browser. Try Chrome or Edge.', 'error');
    } else {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = true;
  
      // Start on press
      voiceBtn.addEventListener('mousedown', () => {
        recognition.start();
        voiceBtn.textContent = "🎙️ Listening...";
        voiceBtn.classList.add('recording');
       
      });
  
      // Stop on release
      voiceBtn.addEventListener('mouseup', () => {
        recognition.stop();
        voiceBtn.textContent = "🎤";
        voiceBtn.classList.remove('recording');
      });
  
      // Optional: also stop if user drags away from button
      voiceBtn.addEventListener('mouseleave', () => {
        recognition.stop();
        voiceBtn.textContent = "🎤";
        voiceBtn.classList.remove('recording');
        
      });
  
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        messageInput.value = transcript;
        
      };
  
      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        voiceBtn.textContent = "🎤";
+   voiceBtn.classList.remove('recording');
+   displaySystemMessage(`Speech recognition error: ${event.error}`, 'error');
      };
    }
}

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
    messageInput.addEventListener('input', adjustTextareaHeight);

    // Connect Server Modal Listeners
    connectServerButton.addEventListener('click', () => {
        modal.style.display = 'block';
    });

    if (closeModalButton) {
        closeModalButton.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });

    serverTypeSelect.addEventListener('change', (event) => {
        const selectedType = event.target.value;
        stdioOptionsDiv.style.display = selectedType === 'stdio' ? 'block' : 'none';
        sseOptionsDiv.style.display = selectedType === 'sse' ? 'block' : 'none';
    });
    // eslint-disable-next-line no-undef
    serverTypeSelect.dispatchEvent(new Event('change')); // Set initial visibility

    connectServerForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default form submission behavior

        const serverNameInput = document.getElementById('server-name');
        const serverCommandInput = document.getElementById('server-command');
        const serverArgsInput = document.getElementById('server-args');
        const serverUrlInput = document.getElementById('server-url');

        const serverName = serverNameInput ? serverNameInput.value.trim() : '';
        const serverType = serverTypeSelect.value;

        if (!serverName) {
            displaySystemMessage('Server Name is required.', 'error');
            return;
        }

        let config = { type: serverType };
        let isValid = true;

        if (serverType === 'stdio') {
            const command = serverCommandInput ? serverCommandInput.value.trim() : '';
            const argsString = serverArgsInput ? serverArgsInput.value.trim() : '';
            if (!command) {
                displaySystemMessage('Command is required for stdio server type.', 'error');
                isValid = false;
            }
            config.command = command;
            config.args = argsString ? argsString.split(',').map(arg => arg.trim()) : [];
        } else if (serverType === 'sse') {
            const url = serverUrlInput ? serverUrlInput.value.trim() : '';
            if (!url) {
                displaySystemMessage('URL is required for sse server type.', 'error');
                isValid = false;
            }
            try {
                new URL(url); // eslint-disable-line no-undef
            } catch (_) { // eslint-disable-line no-unused-vars
                displaySystemMessage('Invalid URL format.', 'error');
                isValid = false;
            }
            config.url = url;
        }

        if (!isValid) return;

        displaySystemMessage(`Attempting to connect to server '${serverName}'...`, 'info');
        modal.style.display = 'none';

        try {
            const response = await fetch('/api/connect-server', { // eslint-disable-line no-undef
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: serverName, config: config }),
            });

            if (response.ok) {
                const result = await response.json();
                displaySystemMessage(`Successfully connected to server '${result.name}'.`, 'success');
                connectServerForm.reset();
            } else {
                const errorData = await response.json();
                displaySystemMessage(`Error connecting to server: ${errorData.error || response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Failed to send connect server request:', error);
            displaySystemMessage(`Failed to send connection request: ${error.message}`, 'error');
        }
    });

    // --- Image Handling --- 
    imageUpload.addEventListener('change', handleImageUpload);
    removeImageBtn.addEventListener('click', removeImage);

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();

            reader.onload = function(e) {
                currentImageData = {
                    base64: e.target.result, // base64 data URL
                    mimeType: file.type
                };
                imagePreview.src = e.target.result;
                imagePreviewContainer.style.display = 'flex'; // Show preview
                adjustTextareaHeight(); // Adjust height after preview shown
            }
            reader.onerror = function(e) {
                console.error("FileReader error: ", e);
                displaySystemMessage('Error reading image file.', 'error');
                removeImage();
            }
            reader.readAsDataURL(file);
        } else if (file) {
            displaySystemMessage('Please select a valid image file.', 'error');
            removeImage(); // Clear any previous selection
        }
    }

    function removeImage() {
        imagePreview.src = '#';
        imagePreviewContainer.style.display = 'none';
        imageUpload.value = ''; // Reset file input
        currentImageData = null;
        adjustTextareaHeight(); // Adjust height after preview hidden
    }

    // --- Initial UI State Setup ---
    messageInput.disabled = true;
    sendButton.disabled = true;
    resetButton.disabled = true;
    adjustTextareaHeight(); // Adjust initial height
    connectWebSocket(); // Start WebSocket connection

}); // End of DOMContentLoaded

// --- Non-DOM Helper functions (Can stay global) ---
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }