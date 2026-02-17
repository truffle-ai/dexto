#!/bin/bash

# Quality Checks Script
# Runs individual or all quality checks with minimal output on success
#
# Usage:
#   ./quality-checks.sh build              - Run build, show last 200 lines on failure (default)
#   ./quality-checks.sh build 100          - Run build, show last 100 lines on failure
#   ./quality-checks.sh build all          - Run build, show all output on failure
#   ./quality-checks.sh test               - Run tests, show last 200 lines on failure (default)
#   ./quality-checks.sh test 50            - Run tests, show last 50 lines on failure
#   ./quality-checks.sh test all           - Run tests, show all output on failure
#   ./quality-checks.sh lint               - Run lint, show last 200 lines on failure (default)
#   ./quality-checks.sh lint all           - Run lint, show all output on failure
#   ./quality-checks.sh typecheck          - Run typecheck, show last 200 lines on failure (default)
#   ./quality-checks.sh typecheck 150      - Run typecheck, show last 150 lines on failure
#   ./quality-checks.sh typecheck all      - Run typecheck, show all output on failure
#   ./quality-checks.sh all                - Run all checks in order (default: 200 lines)
#   ./quality-checks.sh all 100            - Run all checks, show last 100 lines on failure
#   ./quality-checks.sh all all            - Run all checks, show all output on failure

set -e

# Helper function to run a check with output captured
run_check() {
  local cmd="$1"
  local name="$2"
  local output_lines="$3"
  local tmpdir="/tmp/build"
  local tmpfile="${tmpdir}/dexto-${name}-$$.log"

  # Ensure temp directory exists
  mkdir -p "$tmpdir"

  # Run once, capture all output
  if $cmd > "$tmpfile" 2>&1; then
    # Success - clean up and report
    rm -f "$tmpfile"
    echo "✅ ${name} passed"
    return 0
  else
    # Failure - show output and clean up
    echo "❌ ${name} failed:"
    echo ""

    if [ "$output_lines" = "all" ]; then
      cat "$tmpfile"
    else
      tail -n "$output_lines" "$tmpfile"
    fi

    rm -f "$tmpfile"
    exit 1
  fi
}

# Parse command arguments
CHECK_TYPE="${1:-all}"
OUTPUT_LINES="${2:-200}"

# Validate OUTPUT_LINES is either "all" or numeric
if [ "$OUTPUT_LINES" != "all" ] && ! [[ "$OUTPUT_LINES" =~ ^[0-9]+$ ]]; then
  echo "Error: OUTPUT_LINES must be a number or 'all', got '$OUTPUT_LINES'" >&2
  exit 1
fi

case "$CHECK_TYPE" in
  build)
    run_check "bun run build" "Build" "$OUTPUT_LINES"
    ;;
  test)
    run_check "bun run test" "Tests" "$OUTPUT_LINES"
    ;;
  lint)
    run_check "bun run lint" "Lint" "$OUTPUT_LINES"
    ;;
  typecheck)
    run_check "bun run typecheck" "Typecheck" "$OUTPUT_LINES"
    ;;
  openapi-docs)
    run_check "bun run sync-openapi-docs:check" "OpenAPI Docs" "$OUTPUT_LINES"
    ;;
  all)
    run_check "bun run build" "Build" "$OUTPUT_LINES"
    run_check "bun run sync-openapi-docs:check" "OpenAPI Docs" "$OUTPUT_LINES"
    run_check "bun run test" "Tests" "$OUTPUT_LINES"
    run_check "bun run lint" "Lint" "$OUTPUT_LINES"
    run_check "bun run typecheck" "Typecheck" "$OUTPUT_LINES"
    echo ""
    echo "All quality checks passed! ✨"
    ;;
  *)
    echo "Error: Unknown check type '$CHECK_TYPE'"
    echo ""
    echo "Usage: $0 {build|test|lint|typecheck|openapi-docs|all} [lines|all]"
    echo "Examples:"
    echo "  $0 build          - Show last 200 lines on failure (default)"
    echo "  $0 build 100      - Show last 100 lines on failure"
    echo "  $0 build all      - Show all output on failure"
    exit 1
    ;;
esac
