#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/.artifacts/standalone"
VERSION=""

usage() {
  cat <<'EOF'
Build standalone dexto binaries and package them for GitHub Releases.

Usage:
  scripts/build-standalone-binaries.sh [--version <version>] [--output-dir <path>]

Options:
  --version     CLI version to encode in artifact names (default: packages/cli/package.json version)
  --output-dir  Destination directory for artifacts (default: .artifacts/standalone)
  -h, --help    Show this help text
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
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
    node -e "const fs=require('node:fs'); const p='${ROOT_DIR}/packages/cli/package.json'; process.stdout.write(JSON.parse(fs.readFileSync(p,'utf8')).version);"
  )"
fi

if [[ -z "${VERSION}" ]]; then
  echo "Could not determine CLI version." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required but was not found in PATH." >&2
  exit 1
fi

CLI_DIST_DIR="${ROOT_DIR}/packages/cli/dist"
CLI_ENTRYPOINT="${CLI_DIST_DIR}/index.js"
CLI_PACKAGE_JSON="${ROOT_DIR}/packages/cli/package.json"

if [[ ! -f "${CLI_ENTRYPOINT}" ]]; then
  echo "Missing CLI entrypoint at ${CLI_ENTRYPOINT}" >&2
  echo "Run: pnpm run build:all" >&2
  exit 1
fi

if [[ ! -f "${CLI_PACKAGE_JSON}" ]]; then
  echo "Missing CLI package metadata at ${CLI_PACKAGE_JSON}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/dexto-${VERSION}-"*.tar.gz
rm -f "${OUTPUT_DIR}/dexto-${VERSION}-"*.zip
rm -f "${OUTPUT_DIR}/dexto-${VERSION}-checksums.txt"

TARGETS=(
  "bun-darwin-arm64:darwin:arm64"
  "bun-darwin-x64:darwin:x64"
  "bun-linux-arm64:linux:arm64"
  "bun-linux-x64:linux:x64"
  "bun-windows-x64:windows:x64"
)

echo "Building standalone binaries for dexto ${VERSION}"
echo "Output directory: ${OUTPUT_DIR}"

for target in "${TARGETS[@]}"; do
  IFS=':' read -r bun_target platform_name arch_name <<<"${target}"

  stage_dir="$(mktemp -d "${OUTPUT_DIR}/.stage-${platform_name}-${arch_name}-XXXX")"
  binary_name="dexto"
  if [[ "${platform_name}" == "windows" ]]; then
    binary_name="dexto.exe"
  fi

  cp -R "${CLI_DIST_DIR}" "${stage_dir}/dist"
  cp "${CLI_PACKAGE_JSON}" "${stage_dir}/package.json"

  echo "Compiling ${bun_target}"
  bun build \
    --compile \
    --target="${bun_target}" \
    --outfile "${stage_dir}/${binary_name}" \
    "${CLI_ENTRYPOINT}"

  if [[ "${platform_name}" != "windows" ]]; then
    chmod +x "${stage_dir}/${binary_name}"
  fi

  artifact_base="dexto-${VERSION}-${platform_name}-${arch_name}"
  if [[ "${platform_name}" == "windows" ]]; then
    artifact_path="${OUTPUT_DIR}/${artifact_base}.zip"
    (
      cd "${stage_dir}"
      zip -q -r "${artifact_path}" "${binary_name}" package.json dist
    )
  else
    artifact_path="${OUTPUT_DIR}/${artifact_base}.tar.gz"
    LC_ALL=C tar -C "${stage_dir}" -czf "${artifact_path}" "${binary_name}" package.json dist
  fi

  rm -rf "${stage_dir}"
  echo "Created ${artifact_path}"
done

checksum_file="${OUTPUT_DIR}/dexto-${VERSION}-checksums.txt"
{
  shopt -s nullglob
  assets=("${OUTPUT_DIR}/dexto-${VERSION}-"*.tar.gz "${OUTPUT_DIR}/dexto-${VERSION}-"*.zip)
  for asset in "${assets[@]}"; do
    hash="$(hash_file "${asset}")"
    echo "${hash}  $(basename "${asset}")"
  done
} | sort > "${checksum_file}"

echo "Created ${checksum_file}"
