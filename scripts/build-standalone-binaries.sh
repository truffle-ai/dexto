#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/.artifacts/standalone"
VERSION=""
SKIP_CHECKSUMS=0
SEA_SENTINEL_FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
PAYLOAD_ASSET_NAME="dexto-runtime-payload"

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

is_windows_shell() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

to_node_path() {
  local path_value="$1"
  if is_windows_shell && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "${path_value}"
    return
  fi
  printf '%s' "${path_value}"
}

to_bash_path() {
  local path_value="$1"
  if is_windows_shell && command -v cygpath >/dev/null 2>&1; then
    cygpath -u "${path_value}"
    return
  fi
  printf '%s' "${path_value}"
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

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but was not found in PATH." >&2
  exit 1
fi

CLI_PACKAGE_JSON="${ROOT_DIR}/packages/cli/package.json"
CLI_PACKAGE_JSON_NODE_PATH="$(to_node_path "${CLI_PACKAGE_JSON}")"

if [[ -z "${VERSION}" ]]; then
  VERSION="$(
    node -e "const fs=require('node:fs'); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version);" "${CLI_PACKAGE_JSON_NODE_PATH}"
  )"
fi

if [[ -z "${VERSION}" ]]; then
  echo "Could not determine CLI version." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but was not found in PATH." >&2
  exit 1
fi

CLI_DIST_DIR="${ROOT_DIR}/packages/cli/dist"
CLI_ENTRYPOINT="${CLI_DIST_DIR}/index.js"
if [[ ! -f "${CLI_ENTRYPOINT}" ]]; then
  echo "Missing CLI entrypoint at ${CLI_ENTRYPOINT}" >&2
  echo "Run: pnpm run build:all" >&2
  exit 1
fi

if [[ ! -f "${CLI_PACKAGE_JSON}" ]]; then
  echo "Missing CLI package metadata at ${CLI_PACKAGE_JSON}" >&2
  exit 1
fi

OUTPUT_DIR="$(to_bash_path "${OUTPUT_DIR}")"
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
  local compression_mode="${3:-fast}"
  shift 3
  local -a entries=("$@")

  if [[ "${#entries[@]}" -eq 0 ]]; then
    echo "build_windows_zip requires at least one entry" >&2
    exit 1
  fi

  if [[ "${compression_mode}" != "fast" && "${compression_mode}" != "balanced" && "${compression_mode}" != "max" ]]; then
    echo "build_windows_zip compression_mode must be 'fast', 'balanced', or 'max' (got: ${compression_mode})" >&2
    exit 1
  fi

  local zip_7z_level="-mx=1"
  local zip_level="-1"
  if [[ "${compression_mode}" == "balanced" ]]; then
    zip_7z_level="-mx=3"
    zip_level="-3"
  elif [[ "${compression_mode}" == "max" ]]; then
    zip_7z_level="-mx=9"
    zip_level="-9"
  fi

  rm -f "${artifact_path}"

  if command -v 7z >/dev/null 2>&1; then
    echo "Creating Windows zip archive with 7z (${compression_mode} mode)"
    (
      cd "${stage_dir}"
      7z a -tzip "${zip_7z_level}" "${artifact_path}" "${entries[@]}" >/dev/null
    )
    echo "Windows zip archive created"
    return
  fi

  if command -v zip >/dev/null 2>&1; then
    echo "Creating Windows zip archive with zip (${compression_mode} mode)"
    (
      cd "${stage_dir}"
      zip "${zip_level}" -q -r "${artifact_path}" "${entries[@]}"
    )
    echo "Windows zip archive created"
    return
  fi

  local stage_dir_win
  local artifact_path_win
  local stage_dir_win_escaped
  local artifact_path_win_escaped
  local powershell_entries=""
  local entry_escaped
  stage_dir_win="$(cygpath -w "${stage_dir}")"
  artifact_path_win="$(cygpath -w "${artifact_path}")"
  stage_dir_win_escaped="${stage_dir_win//\'/''}"
  artifact_path_win_escaped="${artifact_path_win//\'/''}"

  for entry in "${entries[@]}"; do
    entry_escaped="${entry//\'/''}"
    if [[ -n "${powershell_entries}" ]]; then
      powershell_entries+=","
    fi
    powershell_entries+="'${entry_escaped}'"
  done

  powershell.exe -NoProfile -Command \
    "\$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath '${stage_dir_win_escaped}'; Compress-Archive -Path ${powershell_entries} -DestinationPath '${artifact_path_win_escaped}' -Force"
  echo "Windows zip archive created via PowerShell"
}

PLATFORM_NAME="$(detect_platform)"
ARCH_NAME="$(detect_arch)"

echo "Building standalone binary for dexto ${VERSION} (${PLATFORM_NAME}-${ARCH_NAME})"
echo "Output directory: ${OUTPUT_DIR}"

stage_dir="$(mktemp -d "${OUTPUT_DIR}/.stage-${PLATFORM_NAME}-${ARCH_NAME}-XXXX")"
runtime_dir="${stage_dir}/runtime"
blob_path="${stage_dir}/sea-prep.blob"
bootstrap_path="${stage_dir}/sea-bootstrap.cjs"
sea_config_path="${stage_dir}/sea-config.json"
payload_archive_path=""
payload_archive_extension=""
binary_name="dexto"

if [[ "${PLATFORM_NAME}" == "windows" ]]; then
  binary_name="dexto.exe"
fi

echo "Creating portable CLI package"
mkdir -p "${runtime_dir}"
pnpm --filter dexto deploy --prod --legacy "${runtime_dir}" >/dev/null

payload_archive_extension="tar.gz"
payload_archive_path="${stage_dir}/runtime-payload.tar.gz"
env -u LC_ALL tar -C "${runtime_dir}" -czf "${payload_archive_path}" package.json dist node_modules

payload_size_bytes="$(wc -c < "${payload_archive_path}" | tr -d '[:space:]')"
echo "Runtime payload archive size: ${payload_size_bytes} bytes"

# Node SEA blob generation on Windows fails with opaque errors for very large payloads.
# Keep a guardrail so the failure mode is deterministic and actionable.
if [[ "${payload_size_bytes}" -ge 1900000000 ]]; then
  echo "Runtime payload archive is too large (${payload_size_bytes} bytes)." >&2
  echo "Reduce bundled runtime size before building SEA artifacts." >&2
  exit 1
fi

payload_hash="$(hash_file "${payload_archive_path}")"

cat > "${bootstrap_path}" <<'EOF'
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, closeSync, openSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { tmpdir, homedir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { getAsset, isSea } = require('node:sea');

const RUNTIME_VERSION = '__DEXTO_VERSION__';
const RUNTIME_PAYLOAD_HASH = '__DEXTO_PAYLOAD_HASH__';
const RUNTIME_PAYLOAD_EXTENSION = '__DEXTO_PAYLOAD_EXTENSION__';
const RUNTIME_PAYLOAD_ASSET = '__DEXTO_PAYLOAD_ASSET__';
const MARKER_FILE = '.dexto-runtime-marker';

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function escapePowerShellLiteral(value) {
    return String(value).replace(/'/g, "''");
}

function toMsysPath(value) {
    const normalized = String(value);
    const match = /^([A-Za-z]):\\(.*)$/.exec(normalized);
    if (!match) {
        return normalized.replace(/\\/g, '/');
    }
    const drive = match[1].toLowerCase();
    const tail = match[2].replace(/\\/g, '/');
    return `/${drive}/${tail}`;
}

function readMarker(markerPath) {
    try {
        return readFileSync(markerPath, 'utf8');
    } catch {
        return null;
    }
}

function validateRuntimeDir(runtimeDir, expectedMarker) {
    const markerPath = join(runtimeDir, MARKER_FILE);
    return (
        readMarker(markerPath) === expectedMarker &&
        existsSync(join(runtimeDir, 'dist', 'index.js')) &&
        existsSync(join(runtimeDir, 'package.json'))
    );
}

function extractPayload(archivePath, destinationDir) {
    if (RUNTIME_PAYLOAD_EXTENSION === 'zip') {
        const command = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '${escapePowerShellLiteral(archivePath)}' -DestinationPath '${escapePowerShellLiteral(destinationDir)}' -Force`;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
            stdio: 'inherit',
        });
        if (result.status !== 0) {
            throw new Error(`Failed to expand runtime payload archive (exit ${result.status ?? 'unknown'})`);
        }
        return;
    }

    const childEnv = { ...process.env };
    delete childEnv.LC_ALL;
    const archiveArg = process.platform === 'win32' ? toMsysPath(archivePath) : archivePath;
    const destinationArg = process.platform === 'win32' ? toMsysPath(destinationDir) : destinationDir;
    const result = spawnSync('tar', ['-xzf', archiveArg, '-C', destinationArg], {
        stdio: 'inherit',
        env: childEnv,
    });
    if (result.status !== 0) {
        throw new Error(`Failed to extract runtime payload archive (exit ${result.status ?? 'unknown'})`);
    }
}

function ensureRuntimeExtracted() {
    const expectedMarker = `${RUNTIME_VERSION}:${RUNTIME_PAYLOAD_HASH}`;
    const runtimeDir =
        process.env.DEXTO_RUNTIME_DIR ||
        join(homedir(), '.dexto', 'standalone-runtime', `${RUNTIME_VERSION}-${process.platform}-${process.arch}`);

    if (validateRuntimeDir(runtimeDir, expectedMarker)) {
        return runtimeDir;
    }

    mkdirSync(dirname(runtimeDir), { recursive: true });
    const lockPath = `${runtimeDir}.lock`;
    let lockFd = null;
    const lockDeadline = Date.now() + 5 * 60 * 1000;

    while (lockFd === null) {
        try {
            lockFd = openSync(lockPath, 'wx');
        } catch (error) {
            if (error && error.code === 'EEXIST') {
                if (validateRuntimeDir(runtimeDir, expectedMarker)) {
                    return runtimeDir;
                }
                if (Date.now() > lockDeadline) {
                    throw new Error(`Timed out waiting for runtime extraction lock at ${lockPath}`);
                }
                sleep(200);
                continue;
            }
            throw error;
        }
    }

    try {
        if (validateRuntimeDir(runtimeDir, expectedMarker)) {
            return runtimeDir;
        }

        rmSync(runtimeDir, { recursive: true, force: true });
        mkdirSync(runtimeDir, { recursive: true });

        const archivePath = join(tmpdir(), `dexto-runtime-${process.pid}-${Date.now()}.${RUNTIME_PAYLOAD_EXTENSION}`);
        const payload = Buffer.from(getAsset(RUNTIME_PAYLOAD_ASSET));
        writeFileSync(archivePath, payload);

        try {
            extractPayload(archivePath, runtimeDir);
        } finally {
            rmSync(archivePath, { force: true });
        }

        if (!existsSync(join(runtimeDir, 'dist', 'index.js'))) {
            throw new Error(`Extracted runtime payload is missing dist/index.js at ${runtimeDir}`);
        }

        writeFileSync(join(runtimeDir, MARKER_FILE), expectedMarker, 'utf8');
        return runtimeDir;
    } finally {
        if (lockFd !== null) {
            closeSync(lockFd);
        }
        try {
            unlinkSync(lockPath);
        } catch {}
    }
}

function resolvePackageRoot() {
    if (!isSea()) {
        const executableDir = dirname(process.execPath);
        if (existsSync(join(executableDir, 'dist'))) {
            return executableDir;
        }
        return null;
    }
    return ensureRuntimeExtracted();
}

const packageRoot = resolvePackageRoot();
if (packageRoot) {
    process.env.DEXTO_PACKAGE_ROOT = packageRoot;
}

if (!process.env.DEXTO_CLI_VERSION) {
    process.env.DEXTO_CLI_VERSION = RUNTIME_VERSION;
}

const entrypointPath = resolve(process.env.DEXTO_PACKAGE_ROOT || dirname(process.execPath), 'dist', 'index.js');

(async () => {
    await import(pathToFileURL(entrypointPath).href);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
EOF

node -e "
const fs = require('node:fs');
const filePath = process.argv[1];
const replacements = {
  '__DEXTO_VERSION__': process.argv[2],
  '__DEXTO_PAYLOAD_HASH__': process.argv[3],
  '__DEXTO_PAYLOAD_EXTENSION__': process.argv[4],
  '__DEXTO_PAYLOAD_ASSET__': process.argv[5]
};
let content = fs.readFileSync(filePath, 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  content = content.replaceAll(key, value);
}
fs.writeFileSync(filePath, content);
" "$(to_node_path "${bootstrap_path}")" "${VERSION}" "${payload_hash}" "${payload_archive_extension}" "${PAYLOAD_ASSET_NAME}"

node -e "
const fs = require('node:fs');
const configPath = process.argv[1];
const mainPath = process.argv[2];
const outputPath = process.argv[3];
const assetName = process.argv[4];
const assetPath = process.argv[5];
const config = {
  main: mainPath,
  output: outputPath,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
  assets: {
    [assetName]: assetPath
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
" "${sea_config_path}" "$(basename "${bootstrap_path}")" "$(basename "${blob_path}")" "${PAYLOAD_ASSET_NAME}" "$(basename "${payload_archive_path}")"

echo "Creating SEA blob"
(
  cd "${stage_dir}"
  node --experimental-sea-config "$(basename "${sea_config_path}")"
)

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

# Quick runtime sanity check before archiving.
prearchive_version="$("${binary_path}" --version | tr -d '\r')"
if [[ "${prearchive_version}" != "${VERSION}" ]]; then
  echo "Pre-archive version check failed: expected ${VERSION}, got ${prearchive_version}" >&2
  exit 1
fi

artifact_base="dexto-${VERSION}-${PLATFORM_NAME}-${ARCH_NAME}"
if [[ "${PLATFORM_NAME}" == "windows" ]]; then
  artifact_path="${OUTPUT_DIR}/${artifact_base}.zip"
  build_windows_zip "${stage_dir}" "${artifact_path}" fast "${binary_name}"
else
  artifact_path="${OUTPUT_DIR}/${artifact_base}.tar.gz"
  env -u LC_ALL tar -C "${stage_dir}" -czf "${artifact_path}" "${binary_name}"
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
