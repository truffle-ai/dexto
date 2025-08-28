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
  # Router-only tweak should be allowed
  run_test "POST /api/llm/switch router only" POST "/api/llm/switch" 200 '{"router":"vercel"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch valid openai" POST "/api/llm/switch" 200 '{"provider":"openai","model":"gpt-4o"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch session not found" POST "/api/llm/switch" 404 '{"model":"gpt-4o","sessionId":"does-not-exist-123"}' || failures=$((failures+1))
  # Test missing API key scenario by using empty API key  
  run_test "POST /api/llm/switch missing API key" POST "/api/llm/switch" 400 '{"provider":"cohere","apiKey":""}' || failures=$((failures+1))

  # -------- Advanced LLM switching checks (stateful) --------
  # Utilities: JSON parsing helpers (prefer jq, fallback to node)
  json_get() {
    local json="$1" expr="$2"
    if command -v jq >/dev/null 2>&1; then
      echo "${json}" | jq -r "${expr}"
    else
      node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const o=JSON.parse(s);function pick(o,expr){return expr.split('.').slice(1).reduce((a,k)=>a?.[k],o)};const v=pick(o,'${expr}');if (v===undefined||v===null) { console.log(''); } else if (typeof v==='object'){ console.log(JSON.stringify(v)); } else { console.log(String(v)); }});" <<< "${json}"
    fi
  }

  echo "$(yellow '[Stateful]') Router-only update preserves other fields" 
  # Get baseline config
  base_resp=$(curl -sS "${BASE_URL}/api/llm/current")
  base_provider=$(json_get "${base_resp}" '.config.provider')
  base_model=$(json_get "${base_resp}" '.config.model')
  base_router=$(json_get "${base_resp}" '.config.router')
  base_max_iter=$(json_get "${base_resp}" '.config.maxIterations')
  base_temp=$(json_get "${base_resp}" '.config.temperature')

  # Determine a target router for this provider
  prov_resp=$(curl -sS "${BASE_URL}/api/llm/providers")
  routers=$(json_get "${prov_resp}" ".providers.${base_provider}.supportedRouters")
  # Pick the other router if available; otherwise reuse current
  target_router="${base_router}"
  if echo "${routers}" | grep -q "in-built" && [ "${base_router}" != "in-built" ]; then
    target_router="in-built"
  elif echo "${routers}" | grep -q "vercel" && [ "${base_router}" != "vercel" ]; then
    target_router="vercel"
  fi

  # Perform router-only switch
  switch_payload=$(printf '{"router":"%s"}' "${target_router}")
  run_test "POST /api/llm/switch router-only -> ${target_router}" POST "/api/llm/switch" 200 "${switch_payload}" || failures=$((failures+1))

  # Verify post-switch config
  after_resp=$(curl -sS "${BASE_URL}/api/llm/current")
  after_provider=$(json_get "${after_resp}" '.config.provider')
  after_model=$(json_get "${after_resp}" '.config.model')
  after_router=$(json_get "${after_resp}" '.config.router')
  after_max_iter=$(json_get "${after_resp}" '.config.maxIterations')
  after_temp=$(json_get "${after_resp}" '.config.temperature')

  if [ "${after_provider}" != "${base_provider}" ] || [ "${after_model}" != "${base_model}" ]; then
    echo "$(red 'FAIL') provider/model changed unexpectedly on router-only switch"; failures=$((failures+1))
  fi
  if [ "${after_router}" != "${target_router}" ]; then
    echo "$(red 'FAIL') router not updated to target (${target_router}); actual: ${after_router}"; failures=$((failures+1))
  fi
  if [ "${after_max_iter}" != "${base_max_iter}" ]; then
    echo "$(red 'FAIL') maxIterations changed unexpectedly (${base_max_iter} -> ${after_max_iter})"; failures=$((failures+1))
  fi
  if [ "${after_temp}" != "${base_temp}" ]; then
    echo "$(red 'FAIL') temperature changed unexpectedly (${base_temp} -> ${after_temp})"; failures=$((failures+1))
  fi

  # Revert router to baseline for isolation
  if [ "${after_router}" != "${base_router}" ]; then
    revert_payload=$(printf '{"router":"%s"}' "${base_router}")
    run_test "POST /api/llm/switch revert router -> ${base_router}" POST "/api/llm/switch" 200 "${revert_payload}" || failures=$((failures+1))
  fi

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
