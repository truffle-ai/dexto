#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    {
        name: 'elicitation-test-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
            elicitation: {}  // Enable elicitation capability
        },
    }
);

// Tool that collects user information via elicitation  
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'collect_user_profile') {
        // Request user profile information
        const profileResult = await server.elicitInput({
            message: 'Please provide your profile information to personalize your experience',
            requestedSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Your full name'
                    },
                    email: {
                        type: 'string',
                        description: 'Your email address'
                    },
                    role: {
                        type: 'string',
                        enum: ['developer', 'designer', 'manager', 'student', 'other'],
                        description: 'Your professional role'
                    },
                    experience_level: {
                        type: 'string',
                        enum: ['beginner', 'intermediate', 'advanced', 'expert'],
                        description: 'Your experience level'
                    },
                    interests: {
                        type: 'string',
                        description: 'Tell us about your interests (optional)'
                    }
                },
                required: ['name', 'email', 'role']
            }
        });

        if (profileResult.action === 'accept' && profileResult.content) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Profile created successfully!\n\n` +
                              `Name: ${profileResult.content.name}\n` +
                              `Email: ${profileResult.content.email}\n` +
                              `Role: ${profileResult.content.role}\n` +
                              `Experience: ${profileResult.content.experience_level || 'Not specified'}\n` +
                              `Interests: ${profileResult.content.interests || 'Not specified'}\n\n` +
                              `Your profile has been saved and will be used to customize your experience.`
                    }
                ]
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Profile setup was ${profileResult.action}ed. You can try again later if you change your mind.`
                    }
                ]
            };
        }
    }

    if (name === 'setup_api_credentials') {
        // Request API credentials securely
        const credentialsResult = await server.elicitInput({
            message: 'Please provide API credentials for external service integrations. These will be stored securely.',
            requestedSchema: {
                type: 'object',
                properties: {
                    service_name: {
                        type: 'string',
                        enum: ['github', 'openai', 'anthropic', 'google', 'custom'],
                        description: 'Which service to configure'
                    },
                    api_key: {
                        type: 'string',
                        description: 'Your API key for the selected service'
                    },
                    environment: {
                        type: 'string',
                        enum: ['development', 'staging', 'production'],
                        description: 'Environment to configure'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional description for this credential'
                    }
                },
                required: ['service_name', 'api_key', 'environment']
            }
        });

        if (credentialsResult.action === 'accept' && credentialsResult.content) {
            // Mask the API key for display
            const apiKey = credentialsResult.content.api_key;
            const maskedKey = apiKey.length <= 8
                ? '*'.repeat(apiKey.length)
                : apiKey.substring(0, 4) + '...' + apiKey.slice(-4);

            return {
                content: [
                    {
                        type: 'text',
                        text: `🔑 API credentials configured successfully!\n\n` +
                              `Service: ${credentialsResult.content.service_name}\n` +
                              `Environment: ${credentialsResult.content.environment}\n` +
                              `API Key: ${maskedKey}\n` +
                              `Description: ${credentialsResult.content.description || 'None'}\n\n` +
                              `Your credentials have been securely stored and are ready to use.`
                    }
                ]
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `🔒 Credential setup was ${credentialsResult.action}ed. Your security is important to us.`
                    }
                ]
            };
        }
    }

    if (name === 'feedback_survey') {
        // Multi-step feedback collection
        const feedbackResult = await server.elicitInput({
            message: 'Help us improve by sharing your feedback about your experience',
            requestedSchema: {
                type: 'object',
                properties: {
                    overall_rating: {
                        type: 'integer',
                        description: 'Overall rating (1-5 stars)',
                        minimum: 1,
                        maximum: 5
                    },
                    features_used: {
                        type: 'string',
                        enum: ['file_operations', 'web_browsing', 'api_calls', 'data_analysis', 'all_features'],
                        description: 'Which features did you primarily use?'
                    },
                    satisfaction: {
                        type: 'string',
                        enum: ['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'],
                        description: 'How satisfied are you with the experience?'
                    },
                    would_recommend: {
                        type: 'boolean',
                        description: 'Would you recommend this to others?'
                    },
                    comments: {
                        type: 'string',
                        description: 'Additional comments or suggestions (optional)'
                    }
                },
                required: ['overall_rating', 'features_used', 'satisfaction', 'would_recommend']
            }
        });

        if (feedbackResult.action === 'accept' && feedbackResult.content) {
            const stars = '⭐'.repeat(feedbackResult.content.overall_rating);
            return {
                content: [
                    {
                        type: 'text',
                        text: `📝 Thank you for your feedback!\n\n` +
                              `Rating: ${stars} (${feedbackResult.content.overall_rating}/5)\n` +
                              `Features used: ${feedbackResult.content.features_used}\n` +
                              `Satisfaction: ${feedbackResult.content.satisfaction}\n` +
                              `Would recommend: ${feedbackResult.content.would_recommend ? 'Yes' : 'No'}\n` +
                              `Comments: ${feedbackResult.content.comments || 'None provided'}\n\n` +
                              `Your feedback helps us make the experience better for everyone!`
                    }
                ]
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `📋 Feedback collection was ${feedbackResult.action}ed. Thank you for considering it!`
                    }
                ]
            };
        }
    }

    throw new Error(`Unknown tool: ${name}`);
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'collect_user_profile',
                description: 'Collect user profile information through an interactive form to personalize the experience',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            },
            {
                name: 'setup_api_credentials',
                description: 'Securely collect and store API credentials for external service integrations',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            },
            {
                name: 'feedback_survey',
                description: 'Collect user feedback through a structured survey form to improve the experience',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            }
        ]
    };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(console.error);