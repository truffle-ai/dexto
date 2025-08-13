#!/usr/bin/env bash
set -euo pipefail

WS_URL=${1:-"ws://localhost:3001"}

cyan() { printf "\033[36m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red() { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }

# WebSocket test function using websocat (install with: cargo install websocat)
run_ws_test() {
  local name="$1" message="$2" expected_pattern="$3"
  
  echo "$(cyan "[TEST]") ${name}"
  echo "  Message: ${message}"
  echo "  Expected: ${expected_pattern}"
  
  # Check if websocat is available
  if ! command -v websocat &> /dev/null; then
    echo "  $(red "SKIP: websocat not found. Install with: cargo install websocat")"
    echo
    return 0
  fi
  
  # Send message and capture response with timeout
  local response
  response=$(echo "${message}" | timeout 5s websocat "${WS_URL}" 2>/dev/null || echo "TIMEOUT")
  
  if [[ "${response}" == "TIMEOUT" ]]; then
    echo "  $(red "FAIL: Connection timeout")"
    echo
    return 1
  fi
  
  # Check if response matches expected pattern
  if echo "${response}" | grep -q "${expected_pattern}"; then
    echo "  $(green "PASS")"
  else
    echo "  $(red "FAIL")"
    echo "  Got: ${response}"
    echo
    return 1
  fi
  echo "  Response: ${response}" | sed 's/^/  /'
  echo
  return 0
}

main() {
  echo "Running WebSocket tests against ${WS_URL}"; echo
  local failures=0

  # Test basic message functionality
  run_ws_test "Valid message" \
    '{"type":"message","content":"Hello","sessionId":"ws-test"}' \
    '"event":"' || failures=$((failures+1))

  # Test validation errors  
  run_ws_test "Empty message (should fail)" \
    '{"type":"message","content":""}' \
    '"event":"error"' || failures=$((failures+1))

  run_ws_test "No content field (should fail)" \
    '{"type":"message","sessionId":"test"}' \
    '"event":"error"' || failures=$((failures+1))

  run_ws_test "Unknown message type" \
    '{"type":"unknown","data":"test"}' \
    '"event":"error"' || failures=$((failures+1))

  # Test reset functionality
  run_ws_test "Reset conversation" \
    '{"type":"reset","sessionId":"ws-test"}' \
    '"event":"' || failures=$((failures+1))

  # Test tool confirmation response
  run_ws_test "Tool confirmation response" \
    '{"type":"toolConfirmationResponse","data":{"confirmed":true}}' \
    '' || failures=$((failures+1))  # No response expected

  # Test with image data
  run_ws_test "Message with image data" \
    '{"type":"message","content":"What is this?","imageData":{"base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==","mimeType":"image/png"}}' \
    '"event":"' || failures=$((failures+1))

  # Test malformed JSON (should close connection)
  run_ws_test "Malformed JSON" \
    '{"type":"message","content":' \
    'TIMEOUT' || failures=$((failures+1))

  if [[ ${failures} -eq 0 ]]; then
    echo "$(green "All WebSocket tests passed or skipped")"
    exit 0
  else
    echo "$(red "${failures} WebSocket test(s) failed")"
    exit 1
  fi
}

main "$@"