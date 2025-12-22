// Dexto Chat - Frontend for Example 04
// This demonstrates how to build a simple webapp using Dexto's REST API

// Use relative URL so it works regardless of hostname/port
const API_BASE = '/api';

let sessionId = null;
let isProcessing = false;

// DOM elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const sessionStatus = document.getElementById('session-status');

// Initialize the app
async function init() {
    try {
        sessionStatus.textContent = 'Creating session...';

        // Create a new session
        const response = await fetch(`${API_BASE}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.statusText}`);
        }

        const data = await response.json();
        sessionId = data.session.id;

        sessionStatus.textContent = `Session: ${sessionId.substring(0, 12)}...`;

        // Enable input
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();

        // Add welcome message
        addMessage('assistant', "Hello! I'm your Dexto assistant. How can I help you today?");
    } catch (error) {
        console.error('Initialization error:', error);
        const errorMsg = error.message || String(error);
        showError(`Failed to initialize: ${errorMsg}`);
        sessionStatus.textContent = `Error: ${errorMsg}`;

        // Log more details for debugging
        console.error('Full error details:', {
            error,
            apiBase: API_BASE,
            url: `${API_BASE}/sessions`,
        });
    }
}

// Send a message to the agent
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isProcessing) return;

    // Add user message to UI
    addMessage('user', text);
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    isProcessing = true;

    // Add loading indicator
    const loadingId = addMessage('assistant', 'Thinking...', true);

    try {
        const response = await fetch(`${API_BASE}/message-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: text,
                sessionId: sessionId,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || response.statusText);
        }

        const data = await response.json();

        // Remove loading indicator
        removeMessage(loadingId);

        // Add agent response
        addMessage('assistant', data.response);

        // Show token usage in console
        if (data.tokenUsage) {
            console.log('Token usage:', data.tokenUsage);
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeMessage(loadingId);
        showError(`Failed to send message: ${error.message}`);
    } finally {
        isProcessing = false;
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// Add a message to the chat UI
function addMessage(role, content, isLoading = false) {
    const messageId = `msg-${Date.now()}-${Math.random()}`;
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.id = messageId;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const contentEl = document.createElement('div');
    contentEl.className = `message-content ${isLoading ? 'loading' : ''}`;
    contentEl.textContent = content;

    messageEl.appendChild(avatar);
    messageEl.appendChild(contentEl);

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageId;
}

// Remove a message from the UI
function removeMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

// Show an error message
function showError(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = `Error: ${message}`;
    messagesContainer.appendChild(errorEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Auto-remove after 5 seconds
    setTimeout(() => errorEl.remove(), 5000);
}

// Event listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);
