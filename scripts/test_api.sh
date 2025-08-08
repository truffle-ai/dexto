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
  if [[ "${status}" == "$(red FAIL)" ]]; then
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
  run_test "POST /api/llm/switch missing anthropic key" POST "/api/llm/switch" 400 '{"model":"claude-4-sonnet-20250514"}' || failures=$((failures+1))

  if [[ ${failures} -eq 0 ]]; then
    echo "$(green "All tests passed")"
    exit 0
  else
    echo "$(red "${failures} test(s) failed")"
    exit 1
  fi
}

main "$@"

