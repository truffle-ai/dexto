#!/bin/bash

# Exit immediately on errors, unset variables, or pipeline failures
set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Setup script for Database Interaction Agent
# This script creates the data directory and initializes the database with sample data

echo "🚀 Setting up Database Interaction Agent..."

# Create data directory if it doesn't exist
echo "📁 Creating data directory..."
mkdir -p "${SCRIPT_DIR}/data"

# Check if SQLite is available
if ! command -v sqlite3 &> /dev/null; then
    echo "❌ SQLite3 is not installed. Please install SQLite3 first:"
    echo "   macOS: brew install sqlite3"
    echo "   Ubuntu/Debian: sudo apt-get install sqlite3"
    echo "   Windows: Download from https://www.sqlite.org/download.html"
    exit 1
fi

# Initialize database with sample data
echo "🗄️  Initializing database with sample data..."

# Remove existing database if it exists to avoid constraint violations
if [ -f "${SCRIPT_DIR}/data/example.db" ]; then
    echo "🗑️  Removing existing database..."
    rm "${SCRIPT_DIR}/data/example.db"
fi

sqlite3 "${SCRIPT_DIR}/data/example.db" < "${SCRIPT_DIR}/database-agent-example.sql"

# Verify the database was created successfully
if [ -f "${SCRIPT_DIR}/data/example.db" ]; then
    echo "✅ Database created successfully!"
    
    # Show some basic stats
    echo "📊 Database statistics:"
    echo "   Tables: $(sqlite3 "${SCRIPT_DIR}/data/example.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")"
    echo "   Users: $(sqlite3 "${SCRIPT_DIR}/data/example.db" "SELECT COUNT(*) FROM users;")"
    echo "   Products: $(sqlite3 "${SCRIPT_DIR}/data/example.db" "SELECT COUNT(*) FROM products;")"
    echo "   Orders: $(sqlite3 "${SCRIPT_DIR}/data/example.db" "SELECT COUNT(*) FROM orders;")"
    
    echo ""
    echo "🎉 Database setup complete!"
    echo ""
    echo "You can now run the Database Interaction Agent with:"
    echo "  dexto --agent agents/database-agent.yml"
    echo ""
    echo "Example interactions you can try:"
    echo "  - 'Show me all users'"
    echo "  - 'List products under \$100'"
    echo "  - 'Create a new user named Test User with email test@example.com'"
    echo "  - 'Show me total sales by category'"
    echo "  - 'Find users who haven't logged in for more than 5 days'"
else
    echo "❌ Failed to create database. Please check the SQL file and try again."
    exit 1
fi 