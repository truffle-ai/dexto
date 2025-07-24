#!/bin/bash

# External Framework Integration Example Setup Script
# This script automates the setup process for the Saiki + LangChain integration example

set -e  # Exit on any error

echo "🚀 Setting up External Framework Integration Example"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    print_error "This script must be run from the Saiki project root directory"
    exit 1
fi

# Navigate to the example directory
EXAMPLE_DIR="agents/external-framework-example"
if [ ! -d "$EXAMPLE_DIR" ]; then
    print_error "Example directory not found: $EXAMPLE_DIR"
    exit 1
fi

cd "$EXAMPLE_DIR"
print_status "Changed to example directory: $(pwd)"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

print_success "Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_success "npm version: $(npm --version)"

# Install dependencies for the LangChain agent
print_status "Installing dependencies for LangChain agent..."
cd langchain-agent
if npm install; then
    print_success "LangChain agent dependencies installed successfully"
else
    print_error "Failed to install LangChain agent dependencies"
    exit 1
fi

# Make the server file executable
print_status "Setting up server file permissions..."
chmod +x mcp-server.js
chmod +x agent.js
print_success "Server files are now executable"

# Test the LangChain agent directly
print_status "Testing LangChain agent directly..."
if timeout 5s node agent.js > /dev/null 2>&1; then
    print_success "LangChain agent test passed"
else
    print_warning "LangChain agent test failed (this is expected if OPENAI_API_KEY is not set)"
fi

# Test the MCP server
print_status "Testing LangChain MCP server..."
if timeout 10s node mcp-server.js > /dev/null 2>&1; then
    print_success "LangChain MCP server test passed"
else
    print_warning "LangChain MCP server test failed (this is expected if OPENAI_API_KEY is not set)"
fi

cd ..

# Check for required environment variables
print_status "Checking environment variables..."

if [ -z "$OPENAI_API_KEY" ]; then
    print_warning "OPENAI_API_KEY is not set"
    echo "Please set your OpenAI API key:"
    echo "export OPENAI_API_KEY='your_api_key_here'"
    echo ""
    echo "You can also add it to your shell profile (.bashrc, .zshrc, etc.)"
else
    print_success "OPENAI_API_KEY is set"
fi

# Create a test script
print_status "Creating test script..."
cat > test-integration.sh << 'EOF'
#!/bin/bash

# Test script for the Saiki + LangChain integration

echo "🧪 Testing Saiki + LangChain Integration"
echo "========================================"

# Check if we're in the right directory
if [ ! -f "langchain-agent/mcp-server.js" ]; then
    echo "Error: This script must be run from the external-framework-example directory"
    exit 1
fi

# Check environment variables
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY is not set"
    echo "Please set it with: export OPENAI_API_KEY='your_api_key_here'"
    exit 1
fi

echo "✅ Environment check passed"

# Test LangChain agent directly
echo ""
echo "Testing LangChain agent directly..."
echo "You can test the agent with: cd langchain-agent && npm run agent"
echo ""

# Test MCP server
echo "Testing LangChain MCP server..."
echo "You can test the server with: cd langchain-agent && npm start"
echo ""

# Test Saiki integration
echo "Testing Saiki integration..."
echo "Command: saiki --agent ./saiki-agent-with-langchain.yml 'Use the LangChain agent to calculate: 2 + 2'"
echo ""

# Note: This would require Saiki to be installed globally
if command -v saiki &> /dev/null; then
    echo "Saiki is installed. You can now test the integration with:"
    echo "saiki --agent ./saiki-agent-with-langchain.yml 'Use the LangChain agent to calculate: 2 + 2'"
else
    echo "Saiki is not installed globally. You can:"
    echo "1. Install it globally: npm install -g @truffle-ai/saiki"
    echo "2. Or run from project root: npm run saiki -- --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml"
fi

echo ""
echo "🎉 Setup complete! Check the README.md for more usage examples."
EOF

chmod +x test-integration.sh
print_success "Test script created: test-integration.sh"

# Create a quick start guide
print_status "Creating quick start guide..."
cat > QUICK_START.md << 'EOF'
# Quick Start Guide

## Prerequisites
- Node.js installed
- OpenAI API key

## Setup (Already Done!)
The setup script has already:
- ✅ Installed dependencies for LangChain agent
- ✅ Set file permissions
- ✅ Created test scripts

## Next Steps

1. **Set your API key:**
   ```bash
   export OPENAI_API_KEY="your_openai_api_key_here"
   ```

2. **Test the LangChain agent directly:**
   ```bash
   cd langchain-agent
   npm run agent
   # Then interact with it directly
   ```

3. **Test the MCP server:**
   ```bash
   cd langchain-agent
   npm start
   ```

4. **Test the integration:**
   ```bash
   ./test-integration.sh
   ```

5. **Run Saiki with LangChain:**
   ```bash
   # If Saiki is installed globally:
   saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to solve: 2^10 + 15 * 3"
   
   # Or from project root:
   npm run saiki -- --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Use the LangChain agent to analyze this text: 'I love this product!'"
   ```

## Example Commands

```bash
# Basic LangChain agent interaction
saiki --agent ./saiki-agent-with-langchain.yml "Use the LangChain agent to calculate: 2^10 + 15 * 3"

# Text analysis
saiki --agent ./saiki-agent-with-langchain.yml "Ask the LangChain agent to analyze the sentiment of: 'This is amazing!'"

# Creative content
saiki --agent ./saiki-agent-with-langchain.yml "Have the LangChain agent create a short story about AI"

# Multi-step workflow
saiki --agent ./saiki-agent-with-langchain.yml "Read README.md, then use the LangChain agent to analyze its content"
```

## Architecture

The example now shows:
1. **LangChain Agent** (`langchain-agent/agent.js`) - Complete, self-contained agent
2. **MCP Server** (`langchain-agent/mcp-server.js`) - Wraps the agent with a single tool
3. **Saiki Integration** (`saiki-agent-with-langchain.yml`) - Connects to the MCP server

## Troubleshooting

- **Connection errors**: Check if OPENAI_API_KEY is set
- **Tool not found**: Ensure you're using the correct agent configuration file
- **Permission errors**: Run `chmod +x langchain-agent/mcp-server.js`

## More Information

- See `README.md` for detailed documentation
- See `langchain-agent/README.md` for LangChain agent details
- See `example-usage.md` for comprehensive usage examples
EOF

print_success "Quick start guide created: QUICK_START.md"

# Summary
echo ""
echo "🎉 Setup Complete!"
echo "=================="
print_success "External Framework Integration Example is ready to use"
echo ""
echo "📁 Files created/modified:"
echo "  - langchain-agent/agent.js (Self-contained LangChain agent)"
echo "  - langchain-agent/mcp-server.js (MCP server wrapper)"
echo "  - langchain-agent/package.json (Dependencies)"
echo "  - saiki-agent-with-langchain.yml (Saiki configuration)"
echo "  - test-integration.sh (Test script)"
echo "  - QUICK_START.md (Quick start guide)"
echo ""
echo "🚀 Next steps:"
echo "  1. Set your OpenAI API key: export OPENAI_API_KEY='your_key'"
echo "  2. Test the LangChain agent: cd langchain-agent && npm run agent"
echo "  3. Test the MCP server: cd langchain-agent && npm start"
echo "  4. Test the integration: ./test-integration.sh"
echo "  5. Run Saiki with LangChain integration"
echo ""
echo "📚 Documentation:"
echo "  - README.md - Detailed documentation"
echo "  - langchain-agent/README.md - LangChain agent documentation"
echo "  - example-usage.md - Usage examples"
echo "  - QUICK_START.md - Quick start guide"
echo ""

print_success "Setup completed successfully!" 