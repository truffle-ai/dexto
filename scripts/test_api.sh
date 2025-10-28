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
  # Catalog replaces legacy providers endpoint
  run_test "GET /api/llm/catalog" GET "/api/llm/catalog" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog?provider=openai,anthropic" GET "/api/llm/catalog?provider=openai,anthropic" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog?router=vercel" GET "/api/llm/catalog?router=vercel" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog?fileType=audio" GET "/api/llm/catalog?fileType=audio" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog?defaultOnly=true" GET "/api/llm/catalog?defaultOnly=true" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog?mode=flat" GET "/api/llm/catalog?mode=flat" 200 || failures=$((failures+1))
  run_test "GET /api/llm/catalog" GET "/api/llm/catalog" 200 || failures=$((failures+1))
  run_test "GET /api/llm/current" GET "/api/llm/current" 200 || failures=$((failures+1))

  # LLM switch scenarios
  run_test "POST /api/llm/switch empty" POST "/api/llm/switch" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/llm/switch model wrong type" POST "/api/llm/switch" 400 '{"model":123}' || failures=$((failures+1))
  run_test "POST /api/llm/switch unknown provider" POST "/api/llm/switch" 400 '{"provider":"unknown_vendor"}' || failures=$((failures+1))
  # Router-only tweak should be allowed
  run_test "POST /api/llm/switch router only" POST "/api/llm/switch" 200 '{"router":"vercel"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch valid openai" POST "/api/llm/switch" 200 '{"provider":"openai","model":"gpt-5"}' || failures=$((failures+1))
  run_test "POST /api/llm/switch session not found" POST "/api/llm/switch" 404 '{"model":"gpt-5","sessionId":"does-not-exist-123"}' || failures=$((failures+1))
  # Test missing API key scenario by using empty API key  
  run_test "POST /api/llm/switch missing API key" POST "/api/llm/switch" 400 '{"provider":"cohere","apiKey":""}' || failures=$((failures+1))

  # -------- Advanced LLM switching checks (stateful) --------
  # Utilities: JSON parsing helpers (prefer jq, fallback to node)
  json_get() {
    local json="$1" expr="$2"
    if command -v jq >/dev/null 2>&1; then
      echo "${json}" | jq -r "${expr}" 2>/dev/null || echo ""
    elif command -v node >/dev/null 2>&1; then
      node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const o=JSON.parse(s);const pick=(o,e)=>e.split('.').slice(1).reduce((a,k)=>a?.[k],o);const v=pick(o, process.argv[1]);if(v==null) return console.log('');console.log(typeof v==='object'?JSON.stringify(v):String(v));}catch{console.log('')}});" "${expr}" <<< "${json}"
    else
      echo ""  # No jq/node available; return empty to keep tests running
    fi
  }

  echo "$(yellow '[Stateful]') Router-only update preserves other fields" 
  # Pre-validate catalog content for openai provider structure
  cat_before=$(curl -sS "${BASE_URL}/api/llm/catalog")
  env_var_before=$(json_get "${cat_before}" '.providers.openai.primaryEnvVar')
  supports_base_before=$(json_get "${cat_before}" '.providers.openai.supportsBaseURL')
  routers_before=$(json_get "${cat_before}" '.providers.openai.supportedRouters')
  if [ "${env_var_before}" != "OPENAI_API_KEY" ]; then
    echo "$(red 'FAIL') catalog.openai.primaryEnvVar expected OPENAI_API_KEY, got: ${env_var_before}"; failures=$((failures+1))
  fi

  # Validate provider filter (only openai + anthropic present)
  cat_filtered=$(curl -sS "${BASE_URL}/api/llm/catalog?provider=openai,anthropic")
  if echo "${cat_filtered}" | grep -q '"google"'; then
    echo "$(red 'FAIL') provider filter returned unexpected provider 'google'"; failures=$((failures+1))
  fi

  # Validate router filter (all providers must include router)
  cat_router=$(curl -sS "${BASE_URL}/api/llm/catalog?router=vercel")
  # quick sanity check: ensure each provider advertises vercel
  for p in openai anthropic google groq cohere xai; do
    adv=$(json_get "${cat_router}" ".providers.${p}.supportedRouters")
    if [ -n "${adv}" ] && ! echo "${adv}" | grep -q "vercel"; then
      echo "$(red 'FAIL') provider ${p} missing 'vercel' in router filter"; failures=$((failures+1))
    fi
  done

  # Validate defaultOnly
  cat_defaults=$(curl -sS "${BASE_URL}/api/llm/catalog?defaultOnly=true")
  # verify that for openai (if present) all models are default=true
  if echo "${cat_defaults}" | grep -q '"openai"'; then
    defaults_list=$(json_get "${cat_defaults}" '.providers.openai.models')
    if echo "${defaults_list}" | grep -q '"default": false'; then
      echo "$(red 'FAIL') defaultOnly returned non-default model for openai"; failures=$((failures+1))
    fi
  fi

  # Validate flat mode response shape
  flat_resp=$(curl -sS "${BASE_URL}/api/llm/catalog?mode=flat")
  flat_first=$(json_get "${flat_resp}" '.models[0].provider')
  if [ -z "${flat_first}" ]; then
    echo "$(red 'FAIL') flat mode missing models array or provider field"; failures=$((failures+1))
  fi
  if [ "${supports_base_before}" != "false" ]; then
    echo "$(red 'FAIL') catalog.openai.supportsBaseURL expected false, got: ${supports_base_before}"; failures=$((failures+1))
  fi
  if ! echo "${routers_before}" | grep -q "vercel"; then
    echo "$(red 'FAIL') catalog.openai.supportedRouters missing 'vercel'"; failures=$((failures+1))
  fi
  # Get baseline config
  base_resp=$(curl -sS "${BASE_URL}/api/llm/current")
  base_provider=$(json_get "${base_resp}" '.config.provider')
  base_model=$(json_get "${base_resp}" '.config.model')
  base_router=$(json_get "${base_resp}" '.config.router')
  base_max_iter=$(json_get "${base_resp}" '.config.maxIterations')
  base_temp=$(json_get "${base_resp}" '.config.temperature')

  # Determine a target router for this provider
  cat_for_router=$(curl -sS "${BASE_URL}/api/llm/catalog")
  routers=$(json_get "${cat_for_router}" ".providers.${base_provider}.supportedRouters")
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

  # -------- New LLM key APIs (only invalid input cases; avoid mutating .env) --------
  run_test "POST /api/llm/key invalid provider" POST "/api/llm/key" 400 '{"provider":"invalid","apiKey":"x"}' || failures=$((failures+1))
  run_test "POST /api/llm/key missing apiKey" POST "/api/llm/key" 400 '{"provider":"openai","apiKey":""}' || failures=$((failures+1))

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

  # Agent configuration endpoints
  run_test "GET /api/agent/path" GET "/api/agent/path" 200 || failures=$((failures+1))
  run_test "GET /api/agent/config" GET "/api/agent/config" 200 || failures=$((failures+1))
  run_test "GET /api/agent/config/export" GET "/api/agent/config/export" 200 || failures=$((failures+1))

  # Agent validation tests
  run_test "POST /api/agent/validate missing yaml" POST "/api/agent/validate" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/agent/validate invalid YAML syntax" POST "/api/agent/validate" 200 '{"yaml":"invalid: yaml: content: ["}' || failures=$((failures+1))
  run_test "POST /api/agent/validate invalid schema" POST "/api/agent/validate" 200 '{"yaml":"greeting: hello\nllm:\n  provider: invalid_provider"}' || failures=$((failures+1))
  run_test "POST /api/agent/validate valid YAML" POST "/api/agent/validate" 200 '{"yaml":"greeting: \"Test Agent\"\nllm:\n  provider: openai\n  model: gpt-5\n  apiKey: $OPENAI_API_KEY"}' || failures=$((failures+1))

  # Agent config save tests (validation only - avoid mutating actual config)
  run_test "POST /api/agent/config missing yaml" POST "/api/agent/config" 400 '{}' || failures=$((failures+1))
  run_test "POST /api/agent/config invalid YAML syntax" POST "/api/agent/config" 400 '{"yaml":"invalid: yaml: ["}' || failures=$((failures+1))
  run_test "POST /api/agent/config invalid schema" POST "/api/agent/config" 400 '{"yaml":"llm:\n  provider: invalid_provider"}' || failures=$((failures+1))

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
