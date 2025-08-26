---
sidebar_position: 3
---

# Database Agent Tutorial

Learn how to build an AI agent that provides natural language access to database operations and analytics. This tutorial shows how to create an agent that can query databases, manage data, and generate insights through conversation.

## What You'll Build

A database agent that can:
- Execute natural language queries
- Create and manage database records
- Generate reports and analytics
- Handle data validation and errors
- Provide context-aware responses

## Prerequisites

- Node.js 18+ installed
- SQLite3 installed on your system
- OpenAI API key (or other LLM provider)
- Basic understanding of SQL and databases

> **Note**: This tutorial uses the [MCP Database Server](https://github.com/executeautomation/mcp-database-server) for database connectivity. This MCP server provides database access capabilities supporting SQLite, SQL Server, PostgreSQL, and MySQL databases.

## Step 1: Setup the Database Agent

First, let's set up the database agent with sample data:

```bash
# Navigate to the database agent directory
cd agents/database-agent

# Run the setup script to initialize the database
./setup-database.sh
```

This creates a sample database with:
- Users table (id, name, email, created_at, last_login, is_active)
- Products table (id, name, description, price, category, stock_quantity)
- Orders table (id, user_id, total_amount, status, created_at)
- Order items table (id, order_id, product_id, quantity, unit_price)

## Step 2: Configure the Agent

The database agent uses this configuration:

```yaml
# database-agent.yml
mcpServers:
  sqlite:
    type: stdio
    command: npx
    args:
      - -y
      - "@executeautomation/database-server"
      - "./agents/database-agent/data/example.db"
    timeout: 30000
    connectionMode: strict

systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a Database Interaction Agent that provides natural language access to database operations
        and analytics. You orchestrate database operations through intelligent conversation and tool usage.

        ## Your Core Capabilities

        **Database Operations:**
        - Execute SQL queries and return formatted results
        - Create, modify, and drop database tables
        - Insert, update, and delete records
        - Analyze database schema and structure
        - Generate reports and data insights
        - Perform data validation and integrity checks

        **Intelligent Orchestration:**
        - Understand user intent from natural language
        - Break down complex requests into sequential operations
        - Validate data before operations
        - Provide clear explanations of what you're doing
        - Handle errors gracefully with helpful suggestions

        ## Best Practices

        - Always explain what you're doing before doing it
        - Show sample data when creating tables
        - Validate user input before database operations
        - Provide helpful error messages and suggestions
        - Use transactions for multi-step operations
        - Keep responses concise but informative

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.1  # Lower temperature for more consistent database operations
```

## Step 3: Start the Agent

```bash
# Set your OpenAI API key
export OPENAI_API_KEY="your-openai-api-key"

# Start the database agent
dexto --agent database-agent.yml
```

## Step 4: Basic Database Operations

### Querying Data

Start with simple queries:

```
User: Show me all users
Agent: I'll query the users table to show you all the user records...

User: Find products under $100
Agent: I'll search for products with prices below $100...
```

### Creating Records

Add new data to the database:

```
User: Create a new user named Sarah Johnson with email sarah@example.com
Agent: I'll insert a new user record for Sarah Johnson...

User: Add a new product called "Wireless Headphones" for $89.99
Agent: I'll add the new product to the database...
```

### Complex Queries

Ask for insights and analytics:

```
User: Show me total sales by category
Agent: I'll aggregate the sales data by product category...

User: Find users who haven't logged in for more than 5 days
Agent: I'll query for users whose last_login is older than 5 days...
```

## Step 5: Advanced Features

### Data Analysis

The agent can perform complex analysis:

```
User: Generate a monthly sales report for the last 6 months
User: Find products with declining sales trends
User: Calculate customer lifetime value for each user
User: Identify the most popular product categories
```

### Data Management

Handle data operations:

```
User: Update the price of the Laptop to $849.99
User: Mark all orders older than 30 days as completed
User: Delete all inactive users who haven't logged in for 90 days
```

### Schema Operations

Manage database structure:

```
User: Show me the current database schema
User: Add a new column to the products table
User: Create an index on the email field for better performance
```

## Next Steps

Now that you have a working database agent, you can:

1. **Extend the Schema**: Add more tables and relationships
2. **Add Business Logic**: Implement domain-specific operations
3. **Integrate with APIs**: Connect to external services
4. **Build Web Interface**: Create a web UI for your agent
5. **Scale Up**: Move to production databases like PostgreSQL

The database agent demonstrates how AI can make data operations accessible through natural conversation, changing how we think about database interaction and business intelligence. 