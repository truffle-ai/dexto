#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/.artifacts/standalone"
VERSION=""
SKIP_CHECKSUMS=0
SEA_SENTINEL_FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

usage() {
  cat <<'EOF'
Build a standalone dexto binary for the current platform using Node SEA.

Usage:
  scripts/build-standalone-binaries.sh [--version <version>] [--output-dir <path>] [--skip-checksums]

Options:
  --version     CLI version to encode in artifact names (default: packages/cli/package.json version)
  --output-dir  Destination directory for artifacts (default: .artifacts/standalone)
  --skip-checksums  Skip generating checksums file (useful for matrix builds)
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

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but was not found in PATH." >&2
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

build_windows_zip() {
  local stage_dir="$1"
  local artifact_path="$2"

  if command -v zip >/dev/null 2>&1; then
    (
      cd "${stage_dir}"
      zip -q -r "${artifact_path}" dexto.exe package.json dist node_modules
    )
    return
  fi

  local stage_dir_win
  local artifact_path_win
  stage_dir_win="$(cygpath -w "${stage_dir}")"
  artifact_path_win="$(cygpath -w "${artifact_path}")"
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path '${stage_dir_win}\\dexto.exe','${stage_dir_win}\\package.json','${stage_dir_win}\\dist','${stage_dir_win}\\node_modules' -DestinationPath '${artifact_path_win}' -Force"
}

PLATFORM_NAME="$(detect_platform)"
ARCH_NAME="$(detect_arch)"

echo "Building standalone binary for dexto ${VERSION} (${PLATFORM_NAME}-${ARCH_NAME})"
echo "Output directory: ${OUTPUT_DIR}"

stage_dir="$(mktemp -d "${OUTPUT_DIR}/.stage-${PLATFORM_NAME}-${ARCH_NAME}-XXXX")"
blob_path="${stage_dir}/sea-prep.blob"
bootstrap_path="${stage_dir}/sea-bootstrap.cjs"
sea_config_path="${stage_dir}/sea-config.json"
binary_name="dexto"

if [[ "${PLATFORM_NAME}" == "windows" ]]; then
  binary_name="dexto.exe"
fi

echo "Creating portable CLI package"
pnpm --filter dexto deploy --prod --legacy "${stage_dir}" >/dev/null

cat > "${bootstrap_path}" <<'EOF'
const { existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

if (!process.env.DEXTO_PACKAGE_ROOT) {
    const executableDir = dirname(process.execPath);
    if (existsSync(join(executableDir, 'dist'))) {
        process.env.DEXTO_PACKAGE_ROOT = executableDir;
    }
}

const entrypointPath = resolve(dirname(process.execPath), 'dist', 'index.js');

(async () => {
    await import(pathToFileURL(entrypointPath).href);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
EOF

node -e "
const fs = require('node:fs');
const configPath = process.argv[1];
const mainPath = process.argv[2];
const outputPath = process.argv[3];
const config = {
  main: mainPath,
  output: outputPath,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
" "${sea_config_path}" "${bootstrap_path}" "${blob_path}"

echo "Creating SEA blob"
node --experimental-sea-config "${sea_config_path}"

node_path="$(command -v node)"
binary_path="${stage_dir}/${binary_name}"

cp "${node_path}" "${binary_path}"

if [[ "${PLATFORM_NAME}" == "darwin" ]]; then
  codesign --remove-signature "${binary_path}" >/dev/null 2>&1 || true
fi

echo "Injecting SEA blob"
if [[ "${PLATFORM_NAME}" == "darwin" ]]; then
  pnpm dlx postject "${binary_path}" NODE_SEA_BLOB "${blob_path}" \
    --sentinel-fuse "${SEA_SENTINEL_FUSE}" \
    --macho-segment-name NODE_SEA
else
  pnpm dlx postject "${binary_path}" NODE_SEA_BLOB "${blob_path}" \
    --sentinel-fuse "${SEA_SENTINEL_FUSE}"
fi

if [[ "${PLATFORM_NAME}" == "darwin" ]]; then
  codesign --sign - "${binary_path}" >/dev/null 2>&1
fi

if [[ "${PLATFORM_NAME}" != "windows" ]]; then
  chmod +x "${binary_path}"
fi

artifact_base="dexto-${VERSION}-${PLATFORM_NAME}-${ARCH_NAME}"
if [[ "${PLATFORM_NAME}" == "windows" ]]; then
  artifact_path="${OUTPUT_DIR}/${artifact_base}.zip"
  build_windows_zip "${stage_dir}" "${artifact_path}"
else
  artifact_path="${OUTPUT_DIR}/${artifact_base}.tar.gz"
  LC_ALL=C tar -C "${stage_dir}" -czf "${artifact_path}" "${binary_name}" package.json dist node_modules
fi

rm -rf "${stage_dir}"
echo "Created ${artifact_path}"

if [[ "${SKIP_CHECKSUMS}" -eq 0 ]]; then
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
fi
