#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

class ResourcesDemoServer {
  constructor() {
    this.server = new Server(
      {
        name: 'resources-demo-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          prompts: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // Handle resources/list requests
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        console.error(`📋 MCP Resources: Listing available resources`);
        
        const resources = [
          {
            uri: 'mcp-demo://product-metrics',
            name: 'Product Metrics Dashboard',
            description: 'Key performance indicators and product analytics',
            mimeType: 'application/json',
          },
          {
            uri: 'mcp-demo://user-feedback',
            name: 'User Feedback Summary',
            description: 'Customer feedback analysis and insights',
            mimeType: 'text/markdown',
          },
          {
            uri: 'mcp-demo://system-status',
            name: 'System Status Report',
            description: 'Current system health and performance metrics',
            mimeType: 'application/json',
          },
        ];
        
        return {
          resources: resources,
        };
      } catch (error) {
        console.error(`Error listing MCP resources: ${error.message}`);
        return {
          resources: [],
        };
      }
    });

    // Handle resources/read requests
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const { uri } = request.params;
        console.error(`📖 MCP Resources: Reading resource ${uri}`);
        
        const content = await this.getResourceContent(uri);
        
        return {
          contents: [content],
        };
      } catch (error) {
        console.error(`Error reading MCP resource ${request.params.uri}: ${error.message}`);
        throw new Error(`Failed to read resource: ${error.message}`);
      }
    });

    // Handle prompts/list requests
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      try {
        console.error(`📝 MCP Prompts: Listing available prompts`);

        const prompts = [
          {
            name: 'analyze-metrics',
            description: 'Analyze product metrics and provide insights',
            arguments: [
              {
                name: 'metric_type',
                description: 'Type of metric to analyze (users, revenue, features)',
                required: true,
              },
              {
                name: 'time_period',
                description: 'Time period for analysis (e.g., "Q4 2024")',
                required: false,
              },
            ],
          },
          {
            name: 'generate-report',
            description: 'Generate a comprehensive product report',
            arguments: [
              {
                name: 'report_type',
                description: 'Type of report (metrics, feedback, status)',
                required: true,
              },
            ],
          },
        ];

        return {
          prompts: prompts,
        };
      } catch (error) {
        console.error(`Error listing MCP prompts: ${error.message}`);
        return {
          prompts: [],
        };
      }
    });

    // Handle prompts/get requests
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        console.error(`📖 MCP Prompts: Reading prompt ${name}`);

        const promptContent = await this.getPromptContent(name, args);

        return {
          messages: promptContent,
        };
      } catch (error) {
        console.error(`Error reading MCP prompt ${request.params.name}: ${error.message}`);
        throw new Error(`Failed to read prompt: ${error.message}`);
      }
    });

    // Handle tools/list requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        console.error(`🔧 MCP Tools: Listing available tools`);

        const tools = [
          {
            name: 'calculate-growth-rate',
            description: 'Calculate growth rate between two metrics',
            inputSchema: {
              type: 'object',
              properties: {
                current_value: {
                  type: 'number',
                  description: 'Current metric value',
                },
                previous_value: {
                  type: 'number',
                  description: 'Previous metric value',
                },
              },
              required: ['current_value', 'previous_value'],
            },
          },
          {
            name: 'format-metric',
            description: 'Format a metric value with appropriate unit',
            inputSchema: {
              type: 'object',
              properties: {
                value: {
                  type: 'number',
                  description: 'Metric value to format',
                },
                unit: {
                  type: 'string',
                  description: 'Unit type (users, dollars, percentage)',
                  enum: ['users', 'dollars', 'percentage'],
                },
              },
              required: ['value', 'unit'],
            },
          },
        ];

        return {
          tools: tools,
        };
      } catch (error) {
        console.error(`Error listing MCP tools: ${error.message}`);
        return {
          tools: [],
        };
      }
    });

    // Handle tools/call requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        console.error(`⚙️ MCP Tools: Calling tool ${name}`);

        const result = await this.callTool(name, args);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling MCP tool ${request.params.name}: ${error.message}`);
        throw new Error(`Failed to call tool: ${error.message}`);
      }
    });
  }

  async getResourceContent(uri) {
    switch (uri) {
      case 'mcp-demo://product-metrics':
        return {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            "dashboard": "Product Metrics",
            "period": "Q4 2024",
            "metrics": {
              "monthly_active_users": 125000,
              "daily_active_users": 45000,
              "conversion_rate": 3.2,
              "churn_rate": 2.1,
              "customer_satisfaction": 4.6,
              "net_promoter_score": 72
            },
            "growth": {
              "user_growth_rate": 15.3,
              "revenue_growth_rate": 22.1,
              "feature_adoption_rate": 68.4
            },
            "top_features": [
              {
                "name": "Analytics Dashboard",
                "usage_percentage": 89.2,
                "satisfaction": 4.7
              },
              {
                "name": "Mobile App",
                "usage_percentage": 76.5,
                "satisfaction": 4.4
              },
              {
                "name": "API Integration",
                "usage_percentage": 45.8,
                "satisfaction": 4.5
              }
            ],
            "geographic_data": {
              "north_america": 45,
              "europe": 32,
              "asia_pacific": 18,
              "other": 5
            },
            "last_updated": "2024-12-15T10:30:00Z"
          }, null, 2),
        };

      case 'mcp-demo://user-feedback':
        return {
          uri: uri,
          mimeType: 'text/markdown',
          text: `# User Feedback Summary - December 2024

## Overall Sentiment Analysis
- **Positive**: 78% (up from 72% last month)
- **Neutral**: 15% 
- **Negative**: 7% (down from 11% last month)

## Top Positive Feedback Themes

### 1. User Interface Improvements (42% of positive feedback)
> "The new dashboard is so much cleaner and easier to navigate. Finding what I need takes half the time now."

> "Love the dark mode option! Finally my eyes don't hurt during late-night work sessions."

### 2. Performance Enhancements (31% of positive feedback)  
> "The app loads so much faster now. What used to take 10 seconds now happens instantly."

> "Mobile app performance is night and day better. No more freezing or crashes."

### 3. New Feature Adoption (27% of positive feedback)
> "The AI-powered suggestions are spot on. It's like the app reads my mind."

> "Export functionality is exactly what we needed for our quarterly reports."

## Areas for Improvement

### 1. Search Functionality (38% of suggestions)
- Users want more advanced filtering options
- Request for saved search presets
- Need better search result relevance

### 2. Mobile Experience (31% of suggestions)
- Offline mode for key features
- Better handling of poor network conditions
- More gestures and shortcuts

### 3. Integration Capabilities (31% of suggestions)
- More third-party app connections
- Better API documentation
- Webhook support for real-time updates

## Feature Requests by Priority

| Feature | Votes | Priority | Est. Effort |
|---------|-------|----------|-------------|
| Advanced Search Filters | 234 | High | 3 weeks |
| Offline Mobile Mode | 187 | High | 5 weeks |
| Slack Integration | 156 | Medium | 2 weeks |
| Custom Dashboard Widgets | 143 | Medium | 4 weeks |
| Bulk Operations | 98 | Low | 6 weeks |

## Customer Support Insights

- Average response time: 4.2 hours (target: <4 hours) ✅
- First contact resolution: 67% (target: 70%) ⚠️
- Customer satisfaction with support: 4.4/5.0 ✅

## Recommended Actions

1. **Immediate (Next Sprint)**
   - Implement basic search filtering
   - Fix remaining mobile performance issues
   
2. **Short-term (Next Month)**
   - Develop offline mode MVP
   - Begin Slack integration development
   
3. **Medium-term (Q1 2025)**
   - Launch custom dashboard features
   - Expand integration marketplace

## Competitive Analysis Insights

Users comparing us to competitors highlighted:
- **Strengths**: Ease of use, customer support, pricing
- **Gaps**: Advanced analytics, enterprise features, mobile capabilities

*Report generated on December 15, 2024*`,
        };

      case 'mcp-demo://system-status':
        return {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            "status": "operational",
            "last_updated": "2024-12-15T14:45:00Z",
            "uptime_percentage": 99.8,
            "services": {
              "api_gateway": {
                "status": "operational",
                "response_time_ms": 85,
                "error_rate": 0.002,
                "requests_per_minute": 1250
              },
              "database": {
                "status": "operational", 
                "connection_pool_usage": 0.45,
                "query_performance_ms": 12,
                "active_connections": 67
              },
              "cache_layer": {
                "status": "operational",
                "hit_rate": 0.94,
                "memory_usage": 0.72,
                "keys_count": 245000
              },
              "file_storage": {
                "status": "operational",
                "storage_usage": 0.68,
                "upload_speed_mbps": 125,
                "download_speed_mbps": 180
              },
              "background_jobs": {
                "status": "operational",
                "queue_size": 23,
                "processing_rate_per_minute": 450,
                "failed_jobs_last_hour": 2
              }
            },
            "infrastructure": {
              "servers": {
                "web_servers": 4,
                "api_servers": 6,
                "database_servers": 2,
                "cache_servers": 3
              },
              "load_balancer": {
                "status": "healthy",
                "active_connections": 1850,
                "ssl_termination": "enabled"
              },
              "cdn": {
                "status": "operational",
                "cache_hit_ratio": 0.89,
                "global_edge_locations": 45
              }
            },
            "security": {
              "ssl_certificate": {
                "status": "valid",
                "expires": "2025-03-15T00:00:00Z"
              },
              "firewall": {
                "status": "active",
                "blocked_requests_last_hour": 127
              },
              "ddos_protection": {
                "status": "active",
                "threats_mitigated": 5
              }
            },
            "recent_incidents": [],
            "scheduled_maintenance": {
              "next_window": "2024-12-22T02:00:00Z",
              "duration_hours": 2,
              "description": "Database optimization and index rebuilding"
            }
          }, null, 2),
        };

      default:
        throw new Error(`Unknown resource URI: ${uri}`);
    }
  }

  async getPromptContent(name, args = {}) {
    switch (name) {
      case 'analyze-metrics': {
        const metricType = args.metric_type || 'users';
        const timePeriod = args.time_period || 'Q4 2024';
        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please analyze the ${metricType} metrics for ${timePeriod}.

Consider:
1. Current trends and patterns
2. Growth or decline rates
3. Key insights and recommendations
4. Areas of concern or opportunity

Use the product-metrics resource (mcp-demo://product-metrics) for data.`,
            },
          },
        ];
      }

      case 'generate-report': {
        const reportType = args.report_type || 'metrics';
        let resourceUri;
        switch (reportType) {
          case 'metrics':
            resourceUri = 'mcp-demo://product-metrics';
            break;
          case 'feedback':
            resourceUri = 'mcp-demo://user-feedback';
            break;
          case 'status':
            resourceUri = 'mcp-demo://system-status';
            break;
          default:
            resourceUri = 'mcp-demo://product-metrics';
        }

        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate a comprehensive ${reportType} report using data from ${resourceUri}.

Include:
- Executive summary
- Key findings
- Data visualization suggestions
- Actionable recommendations`,
            },
          },
        ];
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  }

  async callTool(name, args = {}) {
    switch (name) {
      case 'calculate-growth-rate': {
        const { current_value, previous_value } = args;
        if (previous_value === 0) {
          return {
            growth_rate: null,
            error: 'Cannot calculate growth rate with zero previous value',
          };
        }
        const growthRate = ((current_value - previous_value) / previous_value) * 100;
        return {
          growth_rate: growthRate.toFixed(2) + '%',
          current_value,
          previous_value,
          absolute_change: current_value - previous_value,
        };
      }

      case 'format-metric': {
        const { value, unit } = args;
        let formatted;
        switch (unit) {
          case 'users':
            formatted = value.toLocaleString() + ' users';
            break;
          case 'dollars':
            formatted = '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            break;
          case 'percentage':
            formatted = value.toFixed(1) + '%';
            break;
          default:
            formatted = value.toString();
        }
        return {
          formatted_value: formatted,
          raw_value: value,
          unit: unit,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('🚀 MCP Resources Demo Server started');
    console.error('📋 Capabilities: Resources, Prompts, Tools');
    console.error('🔄 Operations: resources/*, prompts/*, tools/*');
    console.error('💡 Comprehensive demo of MCP protocol features');
  }
}

// Start the server
const server = new ResourcesDemoServer();
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});