#!/bin/sh
# Installs the Dexto CLI for the current user, without sudo.
#
#   curl -fsSL https://dexto.ai/install | sh
#   curl -fsSL https://dexto.ai/install | sh -s -- --version 2.0.0
#
# It needs Node.js 20 or later with npm. It installs the `dexto` npm package into
# ~/.dexto/cli/<version>, after checking the downloaded tarball against the registry's sha512
# integrity, then links it as ~/.local/bin/dexto (or $DEXTO_INSTALL_DIR/dexto) and records the
# install in ~/.dexto/install.json, which `dexto upgrade` and `dexto uninstall` read.
#
# It never prompts and never reads credentials. Progress goes to stderr; the last line on stdout
# is one JSON object, in the CLI's --json shape:
#   {"installed":{"action":"installed","version":"2.0.0",...}}
#   {"error":{"code":"node_missing","message":"...","fix":"..."}}
# Exit codes follow the CLI: 0 done, 1 failed, 2 invalid input, 5 version not found.
#
# Re-running it is safe: the installed version is left alone, any other version is replaced.

set -u

DEXTO_PACKAGE="dexto"
MIN_NODE_MAJOR=20

usage() {
    cat <<'EOF'
Install the Dexto CLI for the current user.

Usage: curl -fsSL https://dexto.ai/install | sh -s -- [options]

Options:
  --version <version>      An exact version or an npm dist-tag (default: latest)
  --install-dir <dir>      Where to link the dexto command (default: ~/.local/bin)
  --force                  Reinstall even when this version is already installed
  --dry-run                Resolve the version and report what would change, without writing
  -y, --yes                Accepted for scripts; the installer never prompts
  --non-interactive        Same as --yes
  --json                   Accepted for scripts; the last stdout line is always JSON
  -h, --help               Show this help

Environment:
  DEXTO_VERSION            Same as --version
  DEXTO_INSTALL_DIR        Same as --install-dir
  DEXTO_INSTALL_FORCE=1    Same as --force

Examples:
  curl -fsSL https://dexto.ai/install | sh
  curl -fsSL https://dexto.ai/install | DEXTO_VERSION=next sh
  curl -fsSL https://dexto.ai/install | sh -s -- --version 2.0.0 --yes
EOF
}

say() {
    printf '%s\n' "$*" >&2
}

json_string() {
    printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t\r\n' '   ' | LC_ALL=C tr -d '\000-\037\177')"
}

json_string_or_null() {
    if [ -n "$1" ]; then
        json_string "$1"
    else
        printf 'null'
    fi
}

# Removes this run's temporary directories, and puts back a version directory moved aside for a
# reinstall if the new one never made it into place.
clean_up() {
    if [ -n "${staging_dir:-}" ] && [ -d "${staging_dir}" ]; then
        rm -rf "${staging_dir}"
    fi
    if [ -n "${work_dir:-}" ] && [ -d "${work_dir}" ]; then
        rm -rf "${work_dir}"
    fi
    if [ -n "${replaced_dir:-}" ] && [ -d "${replaced_dir}" ] && [ ! -e "${version_dir}" ]; then
        mv "${replaced_dir}" "${version_dir}"
    fi
}

# fail <code> <message> <fix>: prints the error on stderr and as the last stdout line, then exits.
fail() {
    fail_code="$1"
    fail_message="$2"
    fail_fix="$3"
    say "error: ${fail_message}"
    if [ -n "${fail_fix}" ]; then
        say "fix: ${fail_fix}"
    fi
    clean_up
    printf '{"error":{"code":%s,"message":%s,"fix":%s}}\n' \
        "$(json_string "${fail_code}")" \
        "$(json_string "${fail_message}")" \
        "$(json_string_or_null "${fail_fix}")"
    case "${fail_code}" in
        invalid_input) exit 2 ;;
        version_not_found) exit 5 ;;
        *) exit 1 ;;
    esac
}

require_value() {
    if [ $# -lt 2 ] || [ -z "$2" ]; then
        fail invalid_input "$1 needs a value." "Pass it as $1 <value>."
    fi
}

# Everything runs from main, so a download cut off midway runs nothing.
main() {
trap 'clean_up; exit 130' INT TERM HUP
requested_version="${DEXTO_VERSION:-}"
install_dir="${DEXTO_INSTALL_DIR:-}"
force=0
case "${DEXTO_INSTALL_FORCE:-}" in
    1 | true | yes) force=1 ;;
esac
dry_run=0

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            require_value "$@"
            requested_version="$2"
            shift 2
            ;;
        --version=*)
            requested_version="${1#--version=}"
            shift
            ;;
        --install-dir)
            require_value "$@"
            install_dir="$2"
            shift 2
            ;;
        --install-dir=*)
            install_dir="${1#--install-dir=}"
            shift
            ;;
        --force)
            force=1
            shift
            ;;
        --dry-run)
            dry_run=1
            shift
            ;;
        -y | --yes | --non-interactive | --json)
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            fail invalid_input "Unknown option: $1" "Run with --help to see the options."
            ;;
    esac
done

if [ -z "${HOME:-}" ]; then
    fail failed "HOME is not set." "Set HOME to your home directory and run the installer again."
fi

dexto_home="${HOME}/.dexto"
cli_root="${dexto_home}/cli"
metadata_path="${dexto_home}/install.json"
if [ -z "${install_dir}" ]; then
    install_dir="${HOME}/.local/bin"
fi
case "${install_dir}" in
    /*) ;;
    *) fail invalid_input "The install directory must be an absolute path: ${install_dir}" "Pass an absolute path, such as --install-dir \"\$HOME/.local/bin\"." ;;
esac
install_dir="${install_dir%/}"
link_path="${install_dir}/dexto"

version_spec="${requested_version:-latest}"
version_spec="${version_spec#dexto@}"
version_spec="${version_spec#v}"
case "${version_spec}" in
    "" | *[!A-Za-z0-9.+-]*)
        fail invalid_input "Not a version or dist-tag: ${requested_version}" "Pass an exact version such as 2.0.0, or a dist-tag such as latest or next."
        ;;
esac

case "$(uname -s 2>/dev/null)" in
    Linux) platform=linux ;;
    Darwin) platform=darwin ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT)
        fail unsupported_platform "This installer is for macOS and Linux." "On Windows, run in PowerShell: irm https://dexto.ai/install.ps1 | iex"
        ;;
    *)
        fail unsupported_platform "Unsupported operating system: $(uname -s 2>/dev/null)." "Install with npm instead: npm install -g ${DEXTO_PACKAGE}"
        ;;
esac
case "$(uname -m 2>/dev/null)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *)
        fail unsupported_platform "Unsupported CPU architecture: $(uname -m 2>/dev/null)." "Install with npm instead: npm install -g ${DEXTO_PACKAGE}"
        ;;
esac

if ! command -v node >/dev/null 2>&1; then
    fail node_missing "Node.js ${MIN_NODE_MAJOR} or later is required, and node is not on PATH." "Install Node.js ${MIN_NODE_MAJOR} or later (https://nodejs.org), then run the installer again."
fi
node_version="$(node -p 'process.versions.node' </dev/null 2>/dev/null)"
node_major="${node_version%%.*}"
case "${node_major}" in
    "" | *[!0-9]*)
        fail node_missing "Could not read the Node.js version from node." "Install Node.js ${MIN_NODE_MAJOR} or later (https://nodejs.org), then run the installer again."
        ;;
esac
if [ "${node_major}" -lt "${MIN_NODE_MAJOR}" ]; then
    fail node_too_old "Node.js ${MIN_NODE_MAJOR} or later is required; found ${node_version}." "Upgrade Node.js to ${MIN_NODE_MAJOR} or later (https://nodejs.org), then run the installer again."
fi
if ! command -v npm >/dev/null 2>&1; then
    fail npm_missing "npm is required and is not on PATH." "Install npm (it ships with Node.js), then run the installer again."
fi

# npm reads .npmrc from the working directory, and fails if it was deleted; a project's settings
# shouldn't change what gets installed.
cd "${HOME}" 2>/dev/null || cd / || fail failed "Could not change to the home directory." ""

say "Resolving ${DEXTO_PACKAGE}@${version_spec}..."
view_errors="$(mktemp "${TMPDIR:-/tmp}/dexto-install.XXXXXX")" ||
    fail failed "Could not create a temporary file." "Set TMPDIR to a writable directory."
if ! view_json="$(npm view "${DEXTO_PACKAGE}@${version_spec}" version dist.integrity dist.tarball --json </dev/null 2>"${view_errors}")"; then
    view_json=""
    if ! grep -q 'E404' "${view_errors}"; then
        say "$(cat "${view_errors}")"
        rm -f "${view_errors}"
        fail registry_unreachable "Could not read ${DEXTO_PACKAGE}@${version_spec} from the npm registry." "Check your network and npm registry settings (npm config get registry), then run the installer again."
    fi
fi
rm -f "${view_errors}"
# npm prints nothing for a version that doesn't exist, and a list for a range: take the newest.
resolved="$(printf '%s' "${view_json}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
    if (input.trim() === "") return;
    let value = JSON.parse(input);
    if (Array.isArray(value)) value = value[value.length - 1];
    if (!value || typeof value !== "object") return;
    const version = value.version;
    const integrity = value["dist.integrity"];
    const tarball = value["dist.tarball"];
    if (typeof version !== "string" || typeof integrity !== "string" || typeof tarball !== "string") return;
    process.stdout.write([version, integrity, tarball].join("\t"));
});
' 2>/dev/null)"
if [ -z "${resolved}" ]; then
    fail version_not_found "No ${DEXTO_PACKAGE} release matches ${version_spec}." "Check the versions with: npm view ${DEXTO_PACKAGE} dist-tags versions"
fi
tab="$(printf '\t')"
version="${resolved%%"${tab}"*}"
rest="${resolved#*"${tab}"}"
integrity="${rest%%"${tab}"*}"
tarball_url="${rest#*"${tab}"}"
case "${integrity}" in
    sha512-*) ;;
    *) fail checksum_unavailable "The registry has no sha512 integrity for ${DEXTO_PACKAGE}@${version}." "" ;;
esac
case "${version}" in
    *[!A-Za-z0-9.+-]*) fail failed "The registry returned an unexpected version: ${version}" "" ;;
esac

version_dir="${cli_root}/${version}"
version_bin="${version_dir}/bin/dexto"

previous_version=""
previous_path=""
if [ -f "${metadata_path}" ]; then
    previous="$(node -e '
const fs = require("fs");
try {
    const meta = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof meta.version === "string" && typeof meta.installedPath === "string") {
        process.stdout.write(meta.version + "\t" + meta.installedPath);
    }
} catch {}
' "${metadata_path}" </dev/null 2>/dev/null)"
    if [ -n "${previous}" ]; then
        previous_version="${previous%%"${tab}"*}"
        previous_path="${previous#*"${tab}"}"
    fi
fi

already_installed=0
if [ "${previous_version}" = "${version}" ] && [ "${previous_path}" = "${link_path}" ] &&
    [ -L "${link_path}" ] && [ "$(readlink "${link_path}")" = "${version_bin}" ] &&
    [ -x "${version_bin}" ]; then
    already_installed=1
fi

if [ "${already_installed}" -eq 1 ] && [ "${force}" -eq 0 ]; then
    action=unchanged
elif [ "${already_installed}" -eq 1 ]; then
    action=reinstalled
elif [ -n "${previous_version}" ] || [ -e "${link_path}" ] || [ -L "${link_path}" ]; then
    action=upgraded
else
    action=installed
fi

if [ -d "${link_path}" ]; then
    fail failed "${link_path} is a directory." "Remove it, or pass another --install-dir."
fi

on_path=false
case ":${PATH}:" in
    *":${install_dir}:"*) on_path=true ;;
esac

print_result() {
    shadowed_by=""
    if [ "${on_path}" = true ] && [ "${dry_run}" -eq 0 ]; then
        active="$(command -v dexto 2>/dev/null || true)"
        if [ -n "${active}" ] && [ "${active}" != "${link_path}" ]; then
            shadowed_by="${active}"
        fi
    fi
    if [ "${on_path}" = false ]; then
        say "${install_dir} is not on your PATH. Add it, for example:"
        say "  export PATH=\"${install_dir}:\$PATH\""
    elif [ -n "${shadowed_by}" ]; then
        say "warning: ${shadowed_by} comes before ${link_path} on your PATH, so \`dexto\` runs that one."
    fi
    dry_run_json=false
    if [ "${dry_run}" -eq 1 ]; then
        dry_run_json=true
    fi
    printf '{"installed":{"action":%s,"version":%s,"previous_version":%s,"path":%s,"on_path":%s,"shadowed_by":%s,"dry_run":%s}}\n' \
        "$(json_string "${action}")" \
        "$(json_string "${version}")" \
        "$(json_string_or_null "${previous_version}")" \
        "$(json_string "${link_path}")" \
        "${on_path}" \
        "$(json_string_or_null "${shadowed_by}")" \
        "${dry_run_json}"
}

if [ "${action}" = unchanged ]; then
    say "${DEXTO_PACKAGE} ${version} is already installed at ${link_path}."
    print_result
    exit 0
fi

if [ "${dry_run}" -eq 1 ]; then
    case "${action}" in
        installed) action=install ;;
        upgraded) action=upgrade ;;
        reinstalled) action=reinstall ;;
    esac
    say "Dry run: would ${action} ${DEXTO_PACKAGE} ${version} at ${link_path}. Nothing was changed."
    print_result
    exit 0
fi

if ! mkdir -p "${cli_root}" "${install_dir}"; then
    fail failed "Could not create ${cli_root} or ${install_dir}." "Check that you can write to them, or pass another --install-dir."
fi
work_dir="$(mktemp -d "${cli_root}/.download.XXXXXX")" ||
    fail failed "Could not create a temporary directory in ${cli_root}." ""

say "Downloading ${DEXTO_PACKAGE}@${version}..."
if ! npm pack "${DEXTO_PACKAGE}@${version}" --pack-destination "${work_dir}" --loglevel=error </dev/null >&2; then
    fail download_failed "Could not download ${DEXTO_PACKAGE}@${version} from the npm registry." "Check your network and npm registry settings, then run the installer again."
fi
tarball_path=""
for candidate in "${work_dir}"/*.tgz; do
    if [ -f "${candidate}" ]; then
        tarball_path="${candidate}"
    fi
done
if [ -z "${tarball_path}" ]; then
    fail download_failed "npm pack did not produce a tarball for ${DEXTO_PACKAGE}@${version}." ""
fi

actual_integrity="$(node -e '
const crypto = require("crypto");
const fs = require("fs");
process.stdout.write("sha512-" + crypto.createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64"));
' "${tarball_path}" </dev/null 2>/dev/null)"
if [ "${actual_integrity}" != "${integrity}" ]; then
    fail checksum_mismatch "The downloaded ${DEXTO_PACKAGE}@${version} tarball does not match the registry's sha512 integrity." "Run the installer again; if it keeps failing, report it at https://github.com/truffle-ai/dexto/issues"
fi
say "Checksum verified (${integrity%"${integrity#sha512-??????????}"}...)."

staging_dir="${cli_root}/.staging-${version}-$$"
rm -rf "${staging_dir}"
say "Installing into ${version_dir}..."
if ! npm install --global --prefix "${staging_dir}" --no-audit --no-fund --loglevel=error "${tarball_path}" </dev/null >&2; then
    fail install_failed "npm could not install ${DEXTO_PACKAGE}@${version}." "See the npm output above, then run the installer again."
fi
if [ ! -x "${staging_dir}/bin/dexto" ]; then
    fail install_failed "The installed package has no dexto command." ""
fi
if ! reported_version="$("${staging_dir}/bin/dexto" --version </dev/null 2>/dev/null)"; then
    reported_version=""
fi
case "${reported_version}" in
    *"${version}"*) ;;
    *) fail verify_failed "The installed dexto did not report version ${version} (got: ${reported_version:-nothing})." "Run the installer again with --force." ;;
esac

# Reinstalling a version moves the current copy aside first, and puts it back if the move fails.
replaced_dir=""
if [ -e "${version_dir}" ]; then
    replaced_dir="${cli_root}/.replaced-${version}-$$"
    rm -rf "${replaced_dir}"
    if ! mv "${version_dir}" "${replaced_dir}"; then
        fail install_failed "Could not replace ${version_dir}." "Check that you can write to ${cli_root}, then run the installer again."
    fi
fi
if ! mv "${staging_dir}" "${version_dir}"; then
    if [ -n "${replaced_dir}" ]; then
        mv "${replaced_dir}" "${version_dir}"
    fi
    fail install_failed "Could not move the install into ${version_dir}." ""
fi
staging_dir=""

# When the install dir is npm's global bin (a ~/.local prefix), a global npm dexto owns that path,
# and 1.x's `dexto upgrade` runs `npm uninstall -g dexto` after this script, which deletes
# whatever is there. Uninstalling it first makes that a no-op.
if npm_prefix="$(npm prefix --global </dev/null 2>/dev/null)" && [ -n "${npm_prefix}" ] &&
    [ -d "${npm_prefix}/lib/node_modules/${DEXTO_PACKAGE}" ] &&
    [ "$(cd "${npm_prefix}/bin" 2>/dev/null && pwd -P)" = "$(cd "${install_dir}" && pwd -P)" ]; then
    say "Removing the global npm ${DEXTO_PACKAGE} at ${npm_prefix}, which uses ${link_path}..."
    if ! npm uninstall --global "${DEXTO_PACKAGE}" --loglevel=error </dev/null >&2; then
        fail install_failed "Could not remove the global npm ${DEXTO_PACKAGE} that owns ${link_path}." "Run: npm uninstall -g ${DEXTO_PACKAGE}, then run the installer again."
    fi
fi

temp_link="${install_dir}/.dexto-link-$$"
rm -f "${temp_link}"
if ! ln -s "${version_bin}" "${temp_link}" || ! mv -f "${temp_link}" "${link_path}"; then
    rm -f "${temp_link}"
    fail failed "Could not link ${link_path}." "Check that you can write to ${install_dir}, or pass another --install-dir."
fi

if ! DEXTO_META_PATH="${metadata_path}" DEXTO_META_LINK="${link_path}" DEXTO_META_VERSION="${version}" \
    DEXTO_META_SOURCE="${tarball_url}" DEXTO_META_PLATFORM="${platform}" DEXTO_META_ARCH="${arch}" \
    node -e '
const fs = require("fs");
const env = process.env;
const meta = {
    schemaVersion: 1,
    method: "native",
    installedPath: env.DEXTO_META_LINK,
    installedAt: new Date().toISOString(),
    version: env.DEXTO_META_VERSION,
    sourceUrl: env.DEXTO_META_SOURCE,
    releaseTag: "dexto@" + env.DEXTO_META_VERSION,
    platform: env.DEXTO_META_PLATFORM,
    arch: env.DEXTO_META_ARCH,
};
const temp = env.DEXTO_META_PATH + ".tmp-" + process.pid;
fs.writeFileSync(temp, JSON.stringify(meta, null, 2) + "\n");
fs.renameSync(temp, env.DEXTO_META_PATH);
' </dev/null; then
    fail failed "Could not write ${metadata_path}." "Check that you can write to ${dexto_home}."
fi

# A link left in another install dir would point at a version removed below.
if [ -n "${previous_path}" ] && [ "${previous_path}" != "${link_path}" ] && [ -L "${previous_path}" ]; then
    case "$(readlink "${previous_path}")" in
        "${cli_root}"/*) rm -f "${previous_path}" ;;
    esac
fi

# The previous version stays until the next install, so a dexto still running it keeps its files.
for old_dir in "${cli_root}"/*; do
    if [ -d "${old_dir}" ] && [ "${old_dir}" != "${version_dir}" ] &&
        { [ -z "${previous_version}" ] || [ "${old_dir}" != "${cli_root}/${previous_version}" ]; }; then
        rm -rf "${old_dir}"
    fi
done
if [ -n "${replaced_dir}" ]; then
    rm -rf "${replaced_dir}"
fi
# Leftovers of runs that were killed before they could clean up.
find "${cli_root}" -mindepth 1 -maxdepth 1 -type d \( -name '.download.*' -o -name '.staging-*' -o -name '.replaced-*' \) \
    -mtime +0 -exec rm -rf {} + 2>/dev/null || true
rm -rf "${work_dir}"
work_dir=""

say "Installed ${DEXTO_PACKAGE} ${version} at ${link_path}."
print_result
}

main "$@"
