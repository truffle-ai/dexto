#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="${ROOT_DIR}/.artifacts/standalone"
VERSION=""
ARTIFACT_PATH=""
SKIP_CHECKSUMS=0

usage() {
  cat <<'EOF'
Smoke test standalone dexto binaries built by scripts/build-standalone-binaries.sh.

Usage:
  scripts/test-standalone-binaries.sh [--input-dir <path>] [--version <version>] [--artifact <path>] [--skip-checksums]

Options:
  --input-dir       Directory containing standalone artifacts (default: .artifacts/standalone)
  --version         Version to test (default: packages/cli/package.json version)
  --artifact        Explicit path to artifact (.tar.gz or .zip). Overrides platform auto-detection.
  --skip-checksums  Skip checksum validation
  -h, --help        Show this help text
EOF
}

hash_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
  else
    shasum -a 256 "${file_path}" | awk '{print $1}'
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Darwin*) echo "darwin" ;;
    Linux*) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)
      echo "Unsupported platform: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

extract_zip() {
  local archive_path="$1"
  local output_dir="$2"

  if command -v 7z >/dev/null 2>&1; then
    7z x -y "-o${output_dir}" "${archive_path}" >/dev/null
    return
  fi

  if command -v powershell.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
    local archive_path_win
    local output_dir_win
    archive_path_win="$(cygpath -w "${archive_path}")"
    output_dir_win="$(cygpath -w "${output_dir}")"
    powershell.exe -NoProfile -Command \
      "Expand-Archive -Path '${archive_path_win}' -DestinationPath '${output_dir_win}' -Force" >/dev/null
    return
  fi

  if command -v unzip >/dev/null 2>&1; then
    unzip -q "${archive_path}" -d "${output_dir}"
    return
  fi

  echo "Could not extract zip artifact: unzip (or powershell + cygpath) is required." >&2
  exit 1
}

run_with_timeout() {
  local timeout_secs="$1"
  shift

  if command -v timeout >/dev/null 2>&1 && timeout --version >/dev/null 2>&1; then
    timeout "${timeout_secs}" "$@"
    return
  fi

  node -e "
const { spawn } = require('node:child_process');
const timeoutMs = Number(process.argv[1]);
const cmd = process.argv[2];
const args = process.argv.slice(3);
const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
const timer = setTimeout(() => {
  child.kill();
  process.exit(124);
}, timeoutMs);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) process.exit(124);
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exit(1);
});
" "$((timeout_secs * 1000))" "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-dir)
      if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
        echo "Error: --input-dir requires a value" >&2
        usage
        exit 1
      fi
      INPUT_DIR="${2:-}"
      shift 2
      ;;
    --version)
      if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
        echo "Error: --version requires a value" >&2
        usage
        exit 1
      fi
      VERSION="${2:-}"
      shift 2
      ;;
    --artifact)
      if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
        echo "Error: --artifact requires a value" >&2
        usage
        exit 1
      fi
      ARTIFACT_PATH="${2:-}"
      shift 2
      ;;
    --skip-checksums)
      SKIP_CHECKSUMS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${VERSION}" ]]; then
  VERSION="$(
    cd "${ROOT_DIR}"
    node -e "const fs=require('node:fs'); const p='packages/cli/package.json'; process.stdout.write(JSON.parse(fs.readFileSync(p,'utf8')).version);"
  )"
fi

if [[ -z "${VERSION}" ]]; then
  echo "Could not determine CLI version." >&2
  exit 1
fi

if [[ -z "${ARTIFACT_PATH}" ]]; then
  PLATFORM_NAME="$(detect_platform)"
  ARCH_NAME="$(detect_arch)"
  EXT="tar.gz"
  if [[ "${PLATFORM_NAME}" == "windows" ]]; then
    EXT="zip"
  fi
  ARTIFACT_PATH="${INPUT_DIR}/dexto-${VERSION}-${PLATFORM_NAME}-${ARCH_NAME}.${EXT}"
fi

if [[ ! -f "${ARTIFACT_PATH}" ]]; then
  echo "Artifact not found: ${ARTIFACT_PATH}" >&2
  echo "Available files in ${INPUT_DIR}:" >&2
  ls -1 "${INPUT_DIR}" >&2 || true
  exit 1
fi

artifact_name="$(basename "${ARTIFACT_PATH}")"
echo "Testing artifact: ${artifact_name}"

if [[ "${SKIP_CHECKSUMS}" -eq 0 ]]; then
  checksum_file="${INPUT_DIR}/dexto-${VERSION}-checksums.txt"
  if [[ -f "${checksum_file}" ]]; then
    expected_hash="$(awk -v target="${artifact_name}" '$2 == target { print $1 }' "${checksum_file}")"
    if [[ -z "${expected_hash}" ]]; then
      echo "No checksum entry for ${artifact_name} in ${checksum_file}" >&2
      exit 1
    fi

    actual_hash="$(hash_file "${ARTIFACT_PATH}")"
    if [[ "${expected_hash}" != "${actual_hash}" ]]; then
      echo "Checksum mismatch for ${artifact_name}" >&2
      echo "Expected: ${expected_hash}" >&2
      echo "Actual:   ${actual_hash}" >&2
      exit 1
    fi
    echo "Checksum verified"
  else
    echo "Checksums file not found at ${checksum_file}; continuing without checksum validation."
  fi
fi

run_dir="$(mktemp -d "${INPUT_DIR}/.run-XXXX")"
cleanup() {
  rm -rf "${run_dir}"
}
trap cleanup EXIT

case "${ARTIFACT_PATH}" in
  *.tar.gz)
    tar -xzf "${ARTIFACT_PATH}" -C "${run_dir}"
    ;;
  *.zip)
    extract_zip "${ARTIFACT_PATH}" "${run_dir}"
    ;;
  *)
    echo "Unsupported artifact extension: ${ARTIFACT_PATH}" >&2
    exit 1
    ;;
esac

binary_path="${run_dir}/dexto"
if [[ -f "${run_dir}/dexto.exe" ]]; then
  binary_path="${run_dir}/dexto.exe"
fi

if [[ ! -f "${binary_path}" ]]; then
  echo "Binary not found after extraction: ${binary_path}" >&2
  exit 1
fi

if [[ "${binary_path}" != *.exe ]]; then
  chmod +x "${binary_path}"
fi

version_output="$("${binary_path}" --version | tr -d '\r')"
if [[ "${version_output}" != "${VERSION}" ]]; then
  echo "Version mismatch: expected ${VERSION}, got ${version_output}" >&2
  exit 1
fi
echo "Version check passed (${version_output})"

DEXTO_API_KEY=dummy run_with_timeout 120 "${binary_path}" --no-interactive --help >/dev/null
echo "CLI execution smoke test passed"

echo "Standalone artifact smoke test passed: ${artifact_name}"
