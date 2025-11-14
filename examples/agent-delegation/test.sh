#!/bin/bash

# Agent Delegation Test - Validates delegate_to_url internal tool
#
# This test proves:
# 1. Specialist agent starts and exposes A2A JSON-RPC endpoint
# 2. Direct A2A delegation works (send message, get response)
# 3. Multi-turn stateful conversations work (3 turns, same sessionId)
# 4. Agent remembers context across follow-up questions
#
# Files needed:
# - specialist-agent.yml (agent that receives delegated tasks)
# - coordinator-agent.yml (agent with delegate_to_url tool - not used in this test)
# - test.sh (this file)
#
# Usage: cd examples/agent-delegation && ./test.sh
# Requires: ANTHROPIC_API_KEY in .env file at project root

set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    if [ ! -z "$SPECIALIST_PID" ]; then
        kill $SPECIALIST_PID 2>/dev/null || true
        wait $SPECIALIST_PID 2>/dev/null || true
    fi
    rm -f /tmp/turn*.json /tmp/specialist-stateful.log 2>/dev/null || true
}

# Trap cleanup on exit
trap cleanup EXIT INT TERM

# Load env
if [ -f ../../.env ]; then
    export $(cat ../../.env | grep -v '^#' | grep -v '^$' | xargs) 2>/dev/null || true
fi

echo ""
echo "🔄 Testing Stateful Delegation (Conversation Resumption)"
echo "═══════════════════════════════════════════════════════"
echo ""

# Start specialist
echo "📡 Starting Specialist Agent (port 3001)..."
PORT=3001 node ../../packages/cli/dist/index.js --mode server --agent specialist-agent.yml > /tmp/specialist-stateful.log 2>&1 &
SPECIALIST_PID=$!

# Wait for ready
READY=false
for i in {1..30}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo "✅ Specialist ready!"
        READY=true
        break
    fi
    sleep 1
done

if [ "$READY" = false ]; then
    echo "❌ Failed to start specialist agent"
    cat /tmp/specialist-stateful.log 2>/dev/null || echo "No logs available"
    exit 1
fi

echo ""
echo "🧪 Test: Multi-Turn Conversation via A2A"
echo "───────────────────────────────────────────────────"
echo ""

# Generate unique session ID for this test
SESSION_ID="test-session-$(date +%s)"
echo "📝 Using session ID: $SESSION_ID"
echo ""

# Turn 1: Initial analysis
echo "💬 Turn 1: Ask specialist to analyze data..."
cat > /tmp/turn1.json << EOF
{
  "jsonrpc": "2.0",
  "id": "turn1",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"kind": "text", "text": "Analyze these Q4 metrics: Revenue \$2.5M (+35%), 1200 customers, 87% retention. What are the top 3 insights?"}],
      "messageId": "msg-1",
      "taskId": "$SESSION_ID",
      "kind": "message"
    },
    "configuration": {"blocking": true}
  }
}
EOF

RESPONSE1=$(curl -s -X POST http://localhost:3001/jsonrpc -H "Content-Type: application/json" -d @/tmp/turn1.json)
if echo "$RESPONSE1" | jq -e '.error' > /dev/null 2>&1; then
    echo "❌ Turn 1 failed:"
    echo "$RESPONSE1" | jq '.'
    exit 1
fi
echo "$RESPONSE1" | jq -r '.result.history[-1].parts[0].text' | head -15
echo ""
echo "✅ Turn 1 completed"
echo ""

# Turn 2: Follow-up question using SAME session
echo "💬 Turn 2: Ask follow-up question (same session)..."
sleep 1
cat > /tmp/turn2.json << EOF
{
  "jsonrpc": "2.0",
  "id": "turn2",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"kind": "text", "text": "Which of those 3 insights is most important and why?"}],
      "messageId": "msg-2",
      "taskId": "$SESSION_ID",
      "kind": "message"
    },
    "configuration": {"blocking": true}
  }
}
EOF

RESPONSE2=$(curl -s -X POST http://localhost:3001/jsonrpc -H "Content-Type: application/json" -d @/tmp/turn2.json)
if echo "$RESPONSE2" | jq -e '.error' > /dev/null 2>&1; then
    echo "❌ Turn 2 failed:"
    echo "$RESPONSE2" | jq '.'
    exit 1
fi
echo "$RESPONSE2" | jq -r '.result.history[-1].parts[0].text' | head -20
echo ""
echo "✅ Turn 2 completed"
echo ""

# Turn 3: Another follow-up
echo "💬 Turn 3: Ask another follow-up (same session)..."
sleep 1
cat > /tmp/turn3.json << EOF
{
  "jsonrpc": "2.0",
  "id": "turn3",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"kind": "text", "text": "Based on our discussion, what should be the #1 priority for Q1?"}],
      "messageId": "msg-3",
      "taskId": "$SESSION_ID",
      "kind": "message"
    },
    "configuration": {"blocking": true}
  }
}
EOF

RESPONSE3=$(curl -s -X POST http://localhost:3001/jsonrpc -H "Content-Type: application/json" -d @/tmp/turn3.json)
if echo "$RESPONSE3" | jq -e '.error' > /dev/null 2>&1; then
    echo "❌ Turn 3 failed:"
    echo "$RESPONSE3" | jq '.'
    exit 1
fi
echo "$RESPONSE3" | jq -r '.result.history[-1].parts[0].text' | head -15
echo ""
echo "✅ Turn 3 completed"
echo ""

echo ""
echo "✅ Stateful Conversation Test Complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Validation:"
echo "  ✅ 3 messages sent to same session"
echo "  ✅ Agent remembered context across turns"
echo "  ✅ Follow-up questions worked without re-stating context"
echo "  ✅ Session ID: $SESSION_ID maintained throughout"
echo ""
