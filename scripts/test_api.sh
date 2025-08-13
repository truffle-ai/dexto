#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-"http://localhost:3001"}

cyan() { printf "\033[36m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red() { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }

run_test() {
  local name="$1" method="$2" path="$3" expected_code="$4" data="${5:-}"
  local url="${BASE_URL}${path}"

  local resp http_code resp_body
  if [[ -n "${data}" ]]; then
    resp=$(curl -sS -H 'Content-Type: application/json' -d "${data}" -X "${method}" "${url}" -w "\n%{http_code}")
  else
    resp=$(curl -sS -X "${method}" "${url}" -w "\n%{http_code}")
  fi

  http_code=${resp##*$'\n'}
  resp_body=${resp%$'\n'*}

  local status
  if [[ "${http_code}" == "${expected_code}" ]]; then
    status=$(green "PASS")
  else
    status=$(red "FAIL")
  fi

  echo "$(cyan "[${status}]") ${name}"
  echo "  Method: ${method}  URL: ${url}"
  if [[ -n "${data}" ]]; then
    echo "  Payload: ${data}"
  fi
  echo "  Expected: ${expected_code}  Got: ${http_code}"
  echo "  Body: ${resp_body}" | sed 's/^/  /'
  echo
  if [[ "${http_code}" != "${expected_code}" ]]; then
    return 1
  fi
}

main() {
  echo "Running API tests against ${BASE_URL}"; echo
  local failures=0

  run_test "GET /health" GET "/health" 200 || failures=$((failures+1))
  run_test "GET /api/llm/providers" GET "/api/llm/providers" 200 || failures=$((failures+1))
  run_test "GET /api/llm/current" GET "/api/llm/current" 200 || failures=$((failures+1))

  # LLM switch scenarios
  run_test "POST /api/llm/switch empty" POST "/api/llm/switch" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/llm/switch model wrong type" POST "/api/llm/switch" 400 '{"model":123}' || failures=$((failures+1))
  run_test "POST /api/llm/switch unknown provider" POST "/api/llm/switch" 400 '{"provider":"unknown_vendor"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch valid openai" POST "/api/llm/switch" 200 '{"provider":"openai","model":"gpt-4o"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch session not found" POST "/api/llm/switch" 404 '{"model":"gpt-4o","sessionId":"does-not-exist-123"}' || failures=$((failures+1))
  # Test missing API key scenario by using empty API key  
  run_test "POST /api/llm/switch missing API key" POST "/api/llm/switch" 400 '{"provider":"cohere","apiKey":""}' || failures=$((failures+1))

  # Message endpoints (basic validation)
  run_test "POST /api/message no data" POST "/api/message" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/message-sync no data" POST "/api/message-sync" 400 '{}' || failures=$((failures+1))

  # Reset endpoint
  run_test "POST /api/reset valid" POST "/api/reset" 200 '{}' || failures=$((failures+1))

  # Config endpoint
  run_test "GET /api/config.yaml" GET "/api/config.yaml" 200 || failures=$((failures+1))

  # Session endpoints
  run_test "GET /api/sessions" GET "/api/sessions" 200 || failures=$((failures+1))
  run_test "POST /api/sessions create" POST "/api/sessions" 201 '{"sessionId":"test-session-123"}' || failures=$((failures+1))
  run_test "GET /api/sessions/test-session-123" GET "/api/sessions/test-session-123" 200 || failures=$((failures+1))
  run_test "POST /api/sessions/test-session-123/load" POST "/api/sessions/test-session-123/load" 200 '{}' || failures=$((failures+1))
  run_test "GET /api/sessions/current" GET "/api/sessions/current" 200 || failures=$((failures+1))
  run_test "GET /api/sessions/test-session-123/history" GET "/api/sessions/test-session-123/history" 200 || failures=$((failures+1))

  # Search endpoints validation
  run_test "GET /api/search/messages no query" GET "/api/search/messages" 400 || failures=$((failures+1))
  run_test "GET /api/search/sessions no query" GET "/api/search/sessions" 400 || failures=$((failures+1))
  run_test "GET /api/search/messages with query" GET "/api/search/messages?q=test" 200 || failures=$((failures+1))
  run_test "GET /api/search/sessions with query" GET "/api/search/sessions?q=test" 200 || failures=$((failures+1))

  # MCP endpoints validation
  run_test "GET /api/mcp/servers" GET "/api/mcp/servers" 200 || failures=$((failures+1))
  run_test "POST /api/mcp/servers no data" POST "/api/mcp/servers" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/connect-server no data" POST "/api/connect-server" 400 '{}' || failures=$((failures+1))

  # Webhook endpoints validation
  run_test "POST /api/webhooks no data" POST "/api/webhooks" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/webhooks invalid URL" POST "/api/webhooks" 400 '{"url":"not-a-url"}' || failures=$((failures+1))
  run_test "POST /api/webhooks valid" POST "/api/webhooks" 201 '{"url":"https://example.com/webhook"}' || failures=$((failures+1))
  run_test "GET /api/webhooks" GET "/api/webhooks" 200 || failures=$((failures+1))

  # Cleanup test data
  run_test "DELETE /api/sessions/test-session-123" DELETE "/api/sessions/test-session-123" 200 || failures=$((failures+1))

  if [[ ${failures} -eq 0 ]]; then
    echo "$(green "All tests passed")"
    exit 0
  else
    echo "$(red "${failures} test(s) failed")"
    exit 1
  fi
}

main "$@"

